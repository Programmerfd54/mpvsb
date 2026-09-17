import { CanActivate, Injectable, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AppError } from '../../errors/app-error';
import { setRequestActor } from '../../request/request-context';
import { sessionCookieName } from '../../security/cookies';
import { SessionService } from '../session.service';

/**
 * Доступ участника к своему назначению.
 *
 * Сессия участника — capability на одно назначение: она не даёт ни списка сотрудников,
 * ни доступа к другим назначениям, ни прав руководителя. Cookie кабинета здесь не
 * принимается, даже если он присутствует в том же браузере (ТЗ 10.2).
 */
@Injectable()
export class ParticipantGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const secret = request.cookies?.[sessionCookieName('participant')];

    if (!secret) {
      throw AppError.unauthenticated('Отсутствует cookie сессии участия');
    }

    const actor = await this.sessions.resolveParticipant(secret);
    if (!actor) {
      throw AppError.unauthenticated('Сессия участия недействительна или истекла');
    }

    setRequestActor(actor);
    return true;
  }
}
