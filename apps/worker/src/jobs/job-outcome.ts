import type { PrismaClient } from '@context/database';

import { workerLogger } from '../logger.js';

/**
 * Исход задания записывается обратно в строку outbox.
 *
 * До этого строка сообщала только о доставке в очередь, поэтому экран
 * обработки показывал ноль ошибок независимо от того, что происходило на
 * самом деле. Здесь фиксируются момент завершения и код ошибки — без текста
 * исключения, ответов участника и содержания заключения (ТЗ A09).
 */

/**
 * Ошибки, повтор которых имеет смысл: причина внешняя и может пройти сама.
 * Всё остальное — расхождение содержимого или схемы; его исправляют в
 * содержимом, а не повтором задания.
 */
export const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'provider_error',
  'provider_timeout',
  'database_error',
  'unexpected_error',
]);

export function isRetryableErrorCode(code: string | null): boolean {
  return code !== null && RETRYABLE_ERROR_CODES.has(code);
}

/** Задание выполнено: фиксируем момент, чтобы задержка считалась по факту. */
export async function recordJobCompleted(
  prisma: PrismaClient,
  outboxId: string | undefined,
): Promise<void> {
  if (!outboxId) {
    return;
  }
  await update(prisma, outboxId, {
    completed_at: new Date(),
    failed_at: null,
    last_error_code: null,
  });
}

/** Задание не выполнено: код ошибки без текста и без полезной нагрузки. */
export async function recordJobFailed(
  prisma: PrismaClient,
  outboxId: string | undefined,
  errorCode: string,
): Promise<void> {
  if (!outboxId) {
    return;
  }
  await update(prisma, outboxId, {
    completed_at: null,
    failed_at: new Date(),
    last_error_code: errorCode.slice(0, 100),
  });
}

/**
 * Запись исхода не должна ронять обработчик: бизнес-эффект задания уже
 * зафиксирован, и потеря отметки хуже не сделает, но и не повод для повтора.
 */
async function update(
  prisma: PrismaClient,
  outboxId: string,
  data: {
    completed_at: Date | null;
    failed_at: Date | null;
    last_error_code: string | null;
  },
): Promise<void> {
  try {
    await prisma.outbox_events.update({ where: { id: outboxId }, data });
  } catch (error) {
    workerLogger().warn({ err: error, outboxId }, 'Не удалось записать исход задания');
  }
}
