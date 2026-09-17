import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { buildProblem } from '@context/contracts';

import { loadConfig } from '../config/env';
import { currentRequestId } from '../request/request-context';
import { csrfCookieName, csrfCookieOptions } from './cookies';
import { generateSecret, secretsEqual } from './hashing';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_HEADER = 'x-csrf-token';
const CSRF_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * Double-submit CSRF: клиент читает значение из cookie и повторяет его в заголовке.
 * SameSite=Lax сам по себе защитой не считается (ТЗ 10.2).
 *
 * Дополнительно проверяется Origin: браузерный запрос с чужого сайта отклоняется
 * до попадания в обработчик.
 */
export function registerCsrf(app: FastifyInstance): void {
  const config = loadConfig();
  const cookieName = csrfCookieName();

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Выдаём токен, если его ещё нет: страница входа тоже защищена.
    if (!request.cookies?.[cookieName]) {
      void reply.setCookie(cookieName, generateSecret(24), csrfCookieOptions(CSRF_MAX_AGE_SECONDS));
    }

    if (!MUTATING_METHODS.has(request.method)) {
      return;
    }

    const origin = request.headers.origin;
    if (origin !== undefined && origin !== config.WEB_ORIGIN) {
      return reject(reply, 'Запрос пришёл с недопустимого источника');
    }

    const cookieValue = request.cookies?.[cookieName];
    const headerValue = request.headers[CSRF_HEADER];

    if (
      typeof cookieValue !== 'string' ||
      typeof headerValue !== 'string' ||
      !secretsEqual(cookieValue, headerValue)
    ) {
      return reject(reply, 'Проверка защиты формы не пройдена. Обновите страницу и повторите');
    }
  });
}

function reject(reply: FastifyReply, title: string): Promise<void> {
  const problem = buildProblem({ code: 'FORBIDDEN', requestId: currentRequestId(), title });
  return reply
    .status(problem.status)
    .header('content-type', 'application/problem+json; charset=utf-8')
    .header('cache-control', 'no-store')
    .send(problem) as unknown as Promise<void>;
}
