import { Injectable } from '@nestjs/common';

import type { AuthProfile, MembershipSummary } from '@context/contracts';
import type { OrgPermission } from '@context/domain';

import { AppError } from '../../platform/errors/app-error';
import { PrismaService } from '../../platform/database/prisma.service';
import { SessionService, type IssuedSession } from '../../platform/auth/session.service';
import {
  generateSecret,
  hashPassword,
  hashSecret,
  verifyPassword,
} from '../../platform/security/hashing';
import { AuditService } from '../../platform/audit/audit.service';

/** Токены активации и сброса живут ограниченное время. */
const ACTIVATION_TTL_HOURS = 72;
const RESET_TTL_HOURS = 2;

export interface LoginResult {
  readonly session: IssuedSession;
  readonly profile: AuthProfile;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Вход по email и паролю.
   *
   * Ответ при неизвестном адресе и при неверном пароле одинаков: существование
   * учётной записи не раскрывается. Пароль проверяется всегда, даже когда
   * пользователь не найден, чтобы время ответа не выдавало наличие записи.
   */
  async login(email: string, password: string, deviceHint?: string): Promise<LoginResult> {
    const user = await this.prisma.preContext.users.findUnique({
      where: { email_normalized: email },
      select: {
        id: true,
        display_name: true,
        email_display: true,
        password_hash: true,
        platform_role: true,
        status: true,
      },
    });

    const storedHash = user?.password_hash ?? DUMMY_ARGON2_HASH;
    const passwordMatches = await verifyPassword(storedHash, password);

    if (!user || !user.password_hash || user.status !== 'active' || !passwordMatches) {
      await this.audit.record({
        action: 'auth.login',
        outcome: 'denied',
        metadata: { reason: user ? 'invalid_credentials' : 'unknown_account' },
      });
      // Один и тот же текст для неизвестного адреса и неверного пароля:
      // ответ не должен раскрывать, зарегистрирована ли учётная запись.
      throw new AppError('UNAUTHENTICATED', {
        title: 'Неверный адрес электронной почты или пароль',
        internalDetail: user ? 'invalid_password' : 'unknown_account',
      });
    }

    const actorType = user.platform_role === 'platform_admin' ? 'platform_admin' : 'manager';
    const session = await this.sessions.createUserSession(user.id, actorType, deviceHint);
    const profile = await this.buildProfile(
      user.id,
      user.display_name,
      user.email_display,
      actorType === 'platform_admin',
    );

    await this.audit.record({
      action: 'auth.login',
      outcome: 'success',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { actorType },
    });

    return { session, profile };
  }

  async profileFor(userId: string): Promise<AuthProfile> {
    const user = await this.prisma.preContext.users.findUnique({
      where: { id: userId },
      select: { display_name: true, email_display: true, platform_role: true },
    });
    if (!user) {
      throw AppError.unauthenticated('Учётная запись не найдена');
    }
    return this.buildProfile(
      userId,
      user.display_name,
      user.email_display,
      user.platform_role === 'platform_admin',
    );
  }

  private async buildProfile(
    userId: string,
    displayName: string,
    email: string,
    isPlatformAdmin: boolean,
  ): Promise<AuthProfile> {
    const memberships = await this.sessions.listMemberships(userId);
    const list: MembershipSummary[] = memberships.map((item) => ({
      organizationId: item.organizationId,
      organizationCode: item.organizationCode,
      organizationName: item.organizationName,
      organizationMode: item.organizationMode,
      permissions: [...item.permissions] as OrgPermission[],
    }));

    return {
      userId,
      displayName,
      email,
      isPlatformAdmin,
      memberships: list,
      defaultOrganizationId: list.length === 1 ? list[0]!.organizationId : null,
    };
  }

  /**
   * Активация приглашения. Токен одноразовый: повторное использование и
   * истёкший срок дают одинаковую ошибку.
   */
  async activate(token: string, password: string): Promise<LoginResult> {
    const tokenHash = hashSecret(token);
    const now = new Date();

    const record = await this.prisma.preContext.account_tokens.findUnique({
      where: { token_hash: tokenHash },
      select: {
        id: true,
        user_id: true,
        purpose: true,
        expires_at: true,
        used_at: true,
        revoked_at: true,
      },
    });

    if (
      !record ||
      record.purpose !== 'activation' ||
      record.used_at !== null ||
      record.revoked_at !== null ||
      record.expires_at <= now ||
      !record.user_id
    ) {
      throw new AppError('INVITATION_EXPIRED', {
        title: 'Ссылка активации недействительна или срок истёк',
      });
    }

    const passwordHash = await hashPassword(password);

    await this.prisma.preContext.$transaction([
      this.prisma.preContext.users.update({
        where: { id: record.user_id },
        data: { password_hash: passwordHash, status: 'active' },
      }),
      this.prisma.preContext.account_tokens.update({
        where: { id: record.id },
        data: { used_at: now },
      }),
      // Остальные приглашения этого пользователя больше не нужны.
      this.prisma.preContext.account_tokens.updateMany({
        where: { user_id: record.user_id, purpose: 'activation', used_at: null, revoked_at: null },
        data: { revoked_at: now },
      }),
    ]);

    await this.prisma.preContext.memberships.updateMany({
      where: { user_id: record.user_id, status: 'invited' },
      data: { status: 'active' },
    });

    await this.audit.record({
      action: 'auth.activate',
      outcome: 'success',
      resourceType: 'user',
      resourceId: record.user_id,
    });

    const user = await this.prisma.preContext.users.findUniqueOrThrow({
      where: { id: record.user_id },
      select: { display_name: true, email_display: true, platform_role: true },
    });

    const actorType = user.platform_role === 'platform_admin' ? 'platform_admin' : 'manager';
    const session = await this.sessions.createUserSession(record.user_id, actorType);
    const profile = await this.buildProfile(
      record.user_id,
      user.display_name,
      user.email_display,
      actorType === 'platform_admin',
    );

    return { session, profile };
  }

  /**
   * Заявка на восстановление доступа. В P0 ссылку выпускает администратор после
   * проверки личности: система не отправляет письма и не подтверждает адрес.
   */
  async requestRecovery(email: string): Promise<void> {
    const user = await this.prisma.preContext.users.findUnique({
      where: { email_normalized: email },
      select: { id: true },
    });

    await this.prisma.preContext.recovery_requests.create({
      data: {
        user_id: user?.id ?? null,
        // Сохраняем только факт обращения; адрес в открытом виде не дублируем.
        submitted_reference: hashSecret(email).slice(0, 32),
      },
    });

    await this.audit.record({
      action: 'auth.recovery_requested',
      outcome: 'success',
      metadata: { matched: user !== null },
    });
  }

  /** Сброс пароля по одноразовой ссылке. Все прежние сессии закрываются. */
  async resetPassword(token: string, password: string): Promise<void> {
    const tokenHash = hashSecret(token);
    const now = new Date();

    const record = await this.prisma.preContext.account_tokens.findUnique({
      where: { token_hash: tokenHash },
      select: {
        id: true,
        user_id: true,
        purpose: true,
        expires_at: true,
        used_at: true,
        revoked_at: true,
      },
    });

    if (
      !record ||
      record.purpose !== 'password_reset' ||
      record.used_at !== null ||
      record.revoked_at !== null ||
      record.expires_at <= now ||
      !record.user_id
    ) {
      throw new AppError('INVITATION_EXPIRED', {
        title: 'Ссылка восстановления недействительна или срок истёк',
      });
    }

    const passwordHash = await hashPassword(password);

    await this.prisma.preContext.$transaction([
      this.prisma.preContext.users.update({
        where: { id: record.user_id },
        data: { password_hash: passwordHash, status: 'active' },
      }),
      this.prisma.preContext.account_tokens.update({
        where: { id: record.id },
        data: { used_at: now },
      }),
    ]);

    await this.sessions.revokeAllUserSessions(record.user_id);

    await this.audit.record({
      action: 'auth.password_reset',
      outcome: 'success',
      resourceType: 'user',
      resourceId: record.user_id,
    });
  }

  /** Смена пароля из профиля. Требует текущий пароль и закрывает прочие сессии. */
  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<number> {
    const user = await this.prisma.preContext.users.findUniqueOrThrow({
      where: { id: userId },
      select: { password_hash: true },
    });

    if (!user.password_hash || !(await verifyPassword(user.password_hash, currentPassword))) {
      throw AppError.validation(
        [{ field: 'currentPassword', message: 'Текущий пароль указан неверно' }],
        'Не удалось сменить пароль',
      );
    }

    await this.prisma.preContext.users.update({
      where: { id: userId },
      data: { password_hash: await hashPassword(newPassword) },
    });

    const revoked = await this.sessions.revokeAllUserSessions(userId, currentSessionId);

    await this.audit.record({
      action: 'auth.password_changed',
      outcome: 'success',
      resourceType: 'user',
      resourceId: userId,
      metadata: { revokedSessions: revoked },
    });

    return revoked;
  }

  /**
   * Выпуск одноразовой ссылки. Открытое значение возвращается один раз
   * и в БД не сохраняется — восстановить его из таблицы невозможно.
   */
  async issueAccountToken(
    userId: string,
    purpose: 'activation' | 'password_reset',
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = generateSecret();
    const ttlHours = purpose === 'activation' ? ACTIVATION_TTL_HOURS : RESET_TTL_HOURS;
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

    await this.prisma.preContext.$transaction([
      this.prisma.preContext.account_tokens.updateMany({
        where: { user_id: userId, purpose, used_at: null, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
      this.prisma.preContext.account_tokens.create({
        data: { user_id: userId, purpose, token_hash: hashSecret(token), expires_at: expiresAt },
      }),
    ]);

    return { token, expiresAt };
  }
}

/**
 * Хэш-заглушка для несуществующих учётных записей: проверка пароля выполняется
 * всегда, поэтому время ответа не выдаёт, зарегистрирован ли адрес.
 * Значение получено из случайной строки и ни к кому не относится.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c3ludGhldGljc2FsdA$8iSTuHiNHJHRy0nT4zZ7c3E4Vv7hV7ykOVPeVBmyLPM';
