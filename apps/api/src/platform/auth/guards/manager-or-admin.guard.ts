import { CanActivate, Injectable, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AppError } from '../../errors/app-error';
import { setRequestActor } from '../../request/request-context';
import { sessionCookieName } from '../../security/cookies';
import { SessionService } from '../session.service';

/**
 * Маршруты собственного профиля: годится любая действующая сессия кабинета.
 * Организация здесь не выбирается — доступ к данным tenant проверяет ManagerGuard.
 * Cookie участника не принимается.
 */
@Injectable()
export class ManagerOrAdminGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const secret = request.cookies?.[sessionCookieName('app')];

    if (!secret) {
      throw AppError.unauthenticated('Отсутствует cookie сессии кабинета');
    }

    const actor = await this.sessions.resolveUserSession(secret);
    if (!actor) {
      throw AppError.unauthenticated('Сессия недействительна или истекла');
    }

    setRequestActor(actor);
    return true;
  }
}
