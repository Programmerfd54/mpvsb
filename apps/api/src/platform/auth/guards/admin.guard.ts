import { CanActivate, Injectable, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AppError } from '../../errors/app-error';
import { setRequestActor } from '../../request/request-context';
import { sessionCookieName } from '../../security/cookies';
import { SessionService } from '../session.service';

/**
 * Доступ администратора платформы к эксплуатационным разделам.
 *
 * Роль не даёт автоматического доступа к содержанию оценок: ответы, evidence и
 * черновики заключений открываются только отдельным временным грантом (ТЗ 01.2).
 */
@Injectable()
export class AdminGuard implements CanActivate {
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

    // Действующая сессия обычного руководителя получает отказ по правам, а не
    // сообщение об истёкшей сессии: иначе человек будет безуспешно перевходить.
    // Раздел администратора описан в продукте, поэтому его существование
    // скрывать не от кого.
    if (actor.type !== 'platform_admin') {
      throw AppError.forbidden(
        'Этот раздел доступен только администратору платформы',
        `actor type ${actor.type}`,
      );
    }

    setRequestActor(actor);
    return true;
  }
}
