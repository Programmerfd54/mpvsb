import { Body, Controller, Delete, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  activateRequestSchema,
  changePasswordRequestSchema,
  loginRequestSchema,
  passwordResetRequestSchema,
  recoveryRequestSchema,
  type AuthProfile,
  type Envelope,
  type GenericAcknowledgement,
  type SessionSummary,
} from '@context/contracts';
import { SESSION_POLICY } from '@context/domain';

import { Actor } from '../../platform/auth/decorators';
import { ManagerOrAdminGuard } from '../../platform/auth/guards/manager-or-admin.guard';
import { SessionService } from '../../platform/auth/session.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';
import type { RequestActor } from '../../platform/request/request-context';
import { currentRequestId } from '../../platform/request/request-context';
import {
  clearedCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
} from '../../platform/security/cookies';
import { parseInput } from '../../platform/validation/zod.pipe';
import { AuthService } from './auth.service';

function envelope<T>(data: T): Envelope<T> {
  return { data, meta: { requestId: currentRequestId() } };
}

/** Короткая подсказка об устройстве. Полный User-Agent не сохраняем. */
function deviceHintFrom(request: FastifyRequest): string | undefined {
  const agent = request.headers['user-agent'];
  if (typeof agent !== 'string') {
    return undefined;
  }
  const platform = /Windows|Macintosh|Linux|Android|iPhone|iPad/.exec(agent)?.[0];
  const browser = /Firefox|Edg|Chrome|Safari/.exec(agent)?.[0];
  return [platform, browser].filter(Boolean).join(' · ') || undefined;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Envelope<AuthProfile>> {
    const input = parseInput(loginRequestSchema, body);
    const result = await this.auth.login(input.email, input.password, deviceHintFrom(request));

    void reply.setCookie(
      sessionCookieName('app'),
      result.session.secret,
      sessionCookieOptions(result.session.maxAgeSeconds),
    );

    return envelope(result.profile);
  }

  @Post('logout')
  @UseGuards(ManagerOrAdminGuard)
  async logout(
    @Actor() actor: RequestActor,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Envelope<GenericAcknowledgement>> {
    if (actor.sessionId) {
      await this.sessions.revokeUserSession(actor.sessionId);
    }
    void reply.setCookie(sessionCookieName('app'), '', clearedCookieOptions());
    return envelope({ acknowledged: true as const, message: 'Вы вышли из системы' });
  }

  @Get('me')
  @UseGuards(ManagerOrAdminGuard)
  async me(@Actor() actor: RequestActor): Promise<Envelope<AuthProfile>> {
    return envelope(
      await this.auth.profileFor(
        actor.userId!,
        actor.type as 'platform_admin' | 'manager' | 'employee',
      ),
    );
  }

  @Post('activate')
  async activate(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Envelope<AuthProfile>> {
    const input = parseInput(activateRequestSchema, body);
    const result = await this.auth.activate(input.token, input.password);

    void reply.setCookie(
      sessionCookieName('app'),
      result.session.secret,
      sessionCookieOptions(result.session.maxAgeSeconds),
    );

    return envelope(result.profile);
  }

  /**
   * Заявка на восстановление. Ответ одинаков независимо от того,
   * зарегистрирован адрес или нет (ТЗ M01).
   */
  @Post('recovery-requests')
  async requestRecovery(@Body() body: unknown): Promise<Envelope<GenericAcknowledgement>> {
    const input = parseInput(recoveryRequestSchema, body);
    await this.auth.requestRecovery(input.email);
    return envelope({
      acknowledged: true as const,
      message:
        'Заявка принята. Если учётная запись существует, администратор свяжется с вами и выпустит ссылку восстановления.',
    });
  }

  @Post('password-reset')
  async resetPassword(@Body() body: unknown): Promise<Envelope<GenericAcknowledgement>> {
    const input = parseInput(passwordResetRequestSchema, body);
    await this.auth.resetPassword(input.token, input.password);
    return envelope({
      acknowledged: true as const,
      message: 'Пароль изменён. Войдите с новым паролем.',
    });
  }

  @Post('password/change')
  @UseGuards(ManagerOrAdminGuard)
  async changePassword(
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<Envelope<GenericAcknowledgement>> {
    const input = parseInput(changePasswordRequestSchema, body);
    const revoked = await this.auth.changePassword(
      actor.userId!,
      actor.sessionId!,
      input.currentPassword,
      input.newPassword,
    );
    return envelope({
      acknowledged: true as const,
      message:
        revoked > 0 ? `Пароль изменён. Завершено других сессий: ${revoked}.` : 'Пароль изменён.',
    });
  }

  @Get('sessions')
  @UseGuards(ManagerOrAdminGuard)
  async listSessions(@Actor() actor: RequestActor): Promise<Envelope<SessionSummary[]>> {
    const rows = await this.prisma.preContext.user_sessions.findMany({
      where: { user_id: actor.userId!, revoked_at: null },
      select: { id: true, created_at: true, last_seen_at: true, device_hint: true },
      orderBy: { last_seen_at: 'desc' },
      take: 50,
    });

    return envelope(
      rows.map((row) => ({
        id: row.id,
        current: row.id === actor.sessionId,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
        deviceHint: row.device_hint,
      })),
    );
  }

  /** Завершить конкретную свою сессию. Чужую завершить нельзя. */
  @Delete('sessions/:sessionId')
  @UseGuards(ManagerOrAdminGuard)
  async revokeSession(
    @Actor() actor: RequestActor,
    @Req() request: FastifyRequest,
  ): Promise<Envelope<GenericAcknowledgement>> {
    const sessionId = (request.params as Record<string, string>)['sessionId'];
    const result = await this.prisma.preContext.user_sessions.updateMany({
      where: { id: sessionId, user_id: actor.userId!, revoked_at: null },
      data: { revoked_at: new Date() },
    });

    if (result.count === 0) {
      throw AppError.notFound('Сессия не найдена или принадлежит другому пользователю');
    }

    return envelope({ acknowledged: true as const, message: 'Сессия завершена' });
  }

  @Post('sessions/revoke-others')
  @UseGuards(ManagerOrAdminGuard)
  async revokeOtherSessions(
    @Actor() actor: RequestActor,
  ): Promise<Envelope<GenericAcknowledgement>> {
    const revoked = await this.sessions.revokeAllUserSessions(actor.userId!, actor.sessionId);
    return envelope({
      acknowledged: true as const,
      message: `Завершено других сессий: ${revoked}.`,
    });
  }

  /** Максимальный срок сессии показывается в интерфейсе профиля. */
  @Get('session-policy')
  @UseGuards(ManagerOrAdminGuard)
  sessionPolicy(
    @Actor() actor: RequestActor,
  ): Envelope<{ idleMinutes: number; absoluteMinutes: number }> {
    const key =
      actor.type === 'platform_admin'
        ? 'platform_admin'
        : actor.type === 'employee'
          ? 'employee'
          : 'manager';
    return envelope({ ...SESSION_POLICY[key] });
  }
}
