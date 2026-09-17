import { Injectable } from '@nestjs/common';

import { resolveParticipantSession, resolveUserMemberships } from '@context/database';
import { SESSION_POLICY, type OrgPermission } from '@context/domain';

import { PrismaService } from '../database/prisma.service';
import type { RequestActor } from '../request/request-context';
import { generateSecret, hashSecret } from '../security/hashing';

export interface IssuedSession {
  /** Открытый секрет отдаётся только в cookie и больше нигде не сохраняется. */
  readonly secret: string;
  readonly sessionId: string;
  readonly maxAgeSeconds: number;
}

/** Обновлять last_seen чаще одного раза в 5 минут не нужно: это лишняя запись. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async createUserSession(
    userId: string,
    actorType: 'manager' | 'platform_admin',
    deviceHint?: string,
  ): Promise<IssuedSession> {
    const policy = SESSION_POLICY[actorType];
    const secret = generateSecret();
    const now = new Date();

    const session = await this.prisma.preContext.user_sessions.create({
      data: {
        session_hash: hashSecret(secret),
        user_id: userId,
        actor_type: actorType,
        device_hint: deviceHint?.slice(0, 120) ?? null,
        idle_expires_at: new Date(now.getTime() + policy.idleMinutes * 60_000),
        absolute_expires_at: new Date(now.getTime() + policy.absoluteMinutes * 60_000),
      },
      select: { id: true },
    });

    return {
      secret,
      sessionId: session.id,
      maxAgeSeconds: policy.absoluteMinutes * 60,
    };
  }

  /**
   * Проверяет сессию по секрету из cookie. Истёкшая, отозванная или неизвестная
   * сессия одинаково возвращает null: существование учётной записи не раскрывается.
   */
  async resolveUserSession(secret: string): Promise<RequestActor | null> {
    const session = await this.prisma.preContext.user_sessions.findUnique({
      where: { session_hash: hashSecret(secret) },
      select: {
        id: true,
        user_id: true,
        actor_type: true,
        revoked_at: true,
        idle_expires_at: true,
        absolute_expires_at: true,
        last_seen_at: true,
        users: { select: { status: true, platform_role: true } },
      },
    });

    const now = new Date();
    if (
      !session ||
      session.revoked_at !== null ||
      session.idle_expires_at <= now ||
      session.absolute_expires_at <= now ||
      session.users.status !== 'active'
    ) {
      return null;
    }

    const actorType = session.actor_type === 'platform_admin' ? 'platform_admin' : 'manager';
    if (actorType === 'platform_admin' && session.users.platform_role !== 'platform_admin') {
      // Роль отозвана после выдачи сессии — доступ закрывается сразу.
      return null;
    }

    if (now.getTime() - session.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
      const policy = SESSION_POLICY[actorType];
      await this.prisma.preContext.user_sessions.update({
        where: { id: session.id },
        data: {
          last_seen_at: now,
          idle_expires_at: new Date(now.getTime() + policy.idleMinutes * 60_000),
        },
      });
    }

    return {
      type: actorType,
      userId: session.user_id,
      sessionId: session.id,
      isPlatformAdmin: actorType === 'platform_admin',
    };
  }

  async revokeUserSession(sessionId: string): Promise<void> {
    await this.prisma.preContext.user_sessions.updateMany({
      where: { id: sessionId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  /** Смена пароля и сброс закрывают все прежние сессии пользователя. */
  async revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.prisma.preContext.user_sessions.updateMany({
      where: {
        user_id: userId,
        revoked_at: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revoked_at: new Date() },
    });
    return result.count;
  }

  /**
   * Организации пользователя. Читаются узким SECURITY DEFINER резолвером:
   * до этого момента контекста организации ещё нет, а RLS его требует.
   */
  async listMemberships(userId: string): Promise<
    ReadonlyArray<{
      organizationId: string;
      organizationCode: string;
      organizationName: string;
      organizationMode: 'demo' | 'research' | 'validated_use';
      permissions: readonly OrgPermission[];
    }>
  > {
    const rows = await resolveUserMemberships(this.prisma.preContext, userId);
    return rows.map((row) => ({
      organizationId: row.organization_id,
      organizationCode: row.organization_code,
      organizationName: row.organization_name,
      organizationMode: row.organization_mode,
      permissions: row.permissions as OrgPermission[],
    }));
  }

  async resolveParticipant(secret: string): Promise<RequestActor | null> {
    const session = await resolveParticipantSession(this.prisma.preContext, hashSecret(secret));
    const now = new Date();

    if (
      !session ||
      session.revoked_at !== null ||
      session.idle_expires_at <= now ||
      session.absolute_expires_at <= now
    ) {
      return null;
    }

    return {
      type: 'participant',
      sessionId: session.session_id,
      organizationId: session.organization_id,
      assignmentId: session.assignment_id,
    };
  }
}
