import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

import { buildProblem, type FieldError } from '@context/contracts';
import { IllegalTransitionError } from '@context/domain';

import { appLogger } from '../logging/logger';
import { currentRequestId } from '../request/request-context';
import { AppError } from './app-error';

/**
 * Превращает любую ошибку в `application/problem+json`.
 * Наружу уходят только объяснимый текст, код и requestId — без stack trace,
 * SQL, имён таблиц и существования чужих объектов (ТЗ 08.1, 10.9).
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const requestId = currentRequestId();
    const logger = appLogger();

    const problem = toProblem(exception, requestId);

    if (problem.status >= 500) {
      logger.error(
        { requestId, err: exception, code: problem.code },
        'Необработанная ошибка запроса',
      );
    } else {
      logger.info(
        {
          requestId,
          code: problem.code,
          status: problem.status,
          detail: exception instanceof AppError ? exception.internalDetail : undefined,
        },
        'Запрос отклонён',
      );
    }

    if (problem.retryAfterSeconds !== undefined) {
      void reply.header('Retry-After', String(problem.retryAfterSeconds));
    }

    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(problem);
  }
}

function toProblem(exception: unknown, requestId: string) {
  if (exception instanceof AppError) {
    return exception.toProblem(requestId);
  }

  if (exception instanceof ZodError) {
    return buildProblem({
      code: 'VALIDATION_FAILED',
      requestId,
      fieldErrors: zodFieldErrors(exception),
    });
  }

  if (exception instanceof IllegalTransitionError) {
    // Сообщение называет, что доступно сейчас: «действие недоступно» без
    // объяснения оставляет человека гадать, чего не хватает.
    const allowed = exception.allowed.length > 0 ? exception.allowed.join(', ') : 'ничего';
    return buildProblem({
      code: 'STATE_CONFLICT',
      requestId,
      title: `Из состояния «${exception.from}» этот переход невозможен. Доступно: ${allowed}`,
    });
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    // Стандартные ответы Nest (404 маршрута, 429 лимита) переводятся в наш формат.
    const code =
      status === 404
        ? 'NOT_FOUND'
        : status === 429
          ? 'RATE_LIMITED'
          : status === 401
            ? 'UNAUTHENTICATED'
            : status === 403
              ? 'FORBIDDEN'
              : status >= 500
                ? 'INTERNAL_ERROR'
                : 'VALIDATION_FAILED';
    return buildProblem({ code, requestId });
  }

  return buildProblem({ code: 'INTERNAL_ERROR', requestId });
}

export function zodFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join('.') || '(корень)',
    message: issue.message,
  }));
}
