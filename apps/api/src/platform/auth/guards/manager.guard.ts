import { CanActivate, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { hasPermission, type OrgPermission } from '@context/domain';

import { AppError } from '../../errors/app-error';
import { setRequestActor } from '../../request/request-context';
import { sessionCookieName } from '../../security/cookies';
import { PERMISSIONS_KEY } from '../decorators';
import { SessionService } from '../session.service';

/**
 * Доступ руководителя к ресурсам конкретной организации.
 *
 * Порядок проверок:
 *   1. Действующая сессия типа `manager` (cookie участника здесь не принимается).
 *   2. Организация из URL присутствует среди активных membership пользователя.
 *   3. Набор permissions содержит требуемые маршрутом.
 *
 * Организация никогда не берётся из тела запроса: переданный orgId сам по себе
 * не является авторизацией (ТЗ 06.5).
 */
@Injectable()
export class ManagerGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const secret = request.cookies?.[sessionCookieName('app')];

    if (!secret) {
      throw AppError.unauthenticated('Отсутствует cookie сессии кабинета');
    }

    const actor = await this.sessions.resolveUserSession(secret);
    if (!actor || (actor.type !== 'manager' && actor.type !== 'platform_admin')) {
      throw AppError.unauthenticated('Сессия недействительна или другого типа');
    }

    const orgId = (request.params as Record<string, string> | undefined)?.['orgId'];
    if (!orgId) {
      throw AppError.forbidden('Организация не указана', 'В маршруте отсутствует orgId');
    }

    const memberships = await this.sessions.listMemberships(actor.userId!);
    const membership = memberships.find((item) => item.organizationId === orgId);

    if (!membership) {
      // Чужая организация неотличима от несуществующей.
      throw AppError.notFound(`Нет активного membership в организации ${orgId}`);
    }

    const required = this.reflector.getAllAndOverride<OrgPermission[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (required?.length) {
      const missing = required.filter(
        (permission) => !hasPermission(membership.permissions, permission),
      );
      if (missing.length > 0) {
        throw AppError.forbidden(
          'Недостаточно прав для этого действия',
          `Не хватает разрешений: ${missing.join(', ')}`,
        );
      }
    }

    setRequestActor({
      ...actor,
      type: 'manager',
      organizationId: membership.organizationId,
      permissions: membership.permissions,
    });

    return true;
  }
}
