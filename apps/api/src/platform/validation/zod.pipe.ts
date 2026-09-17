import type { ZodType } from 'zod';

import { AppError } from '../errors/app-error';
import { zodFieldErrors } from '../errors/problem.filter';
import { ZodError } from 'zod';

/**
 * Разбор входных данных по схеме из `@context/contracts`.
 * Неизвестные поля не проходят дальше и не попадают в ORM (ТЗ 08.1).
 */
export function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw AppError.validation(zodFieldErrors(result.error));
  }
  return result.data;
}

/** Разбор ответа перед отдачей: защищает от случайной утечки лишних полей. */
export function parseOutput<T>(schema: ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError('INTERNAL_ERROR', {
        internalDetail: `Ответ не соответствует контракту: ${zodFieldErrors(error)
          .map((f) => `${f.field}: ${f.message}`)
          .join('; ')}`,
        cause: error,
      });
    }
    throw error;
  }
}
