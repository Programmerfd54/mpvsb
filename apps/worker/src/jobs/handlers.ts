import type { PrismaClient } from '@context/database';

import { workerLogger } from '../logger.js';
import { runGenerateReport } from './generate-report.js';
import { recordJobCompleted, recordJobFailed } from './job-outcome.js';
import { requestReportIfReady, runScoreAttempt } from './score-attempt.js';

/**
 * Обработчики заданий очереди.
 *
 * Здесь же фиксируется исход: строка outbox, породившая задание, узнаёт, чем
 * дело кончилось. Без этого экран обработки показывал бы ноль ошибок при любом
 * положении дел (ТЗ A09).
 */

/** Полезная нагрузка задания. Диспетчер кладёт только идентификаторы. */
export interface JobPayload {
  readonly organizationId: string;
  readonly entityId: string;
  readonly dataGeneration: string;
  readonly assignmentId?: string;
  /** Строка outbox, породившая задание: в неё возвращается исход. */
  readonly outboxId?: string;
}

export async function handleScoreAttempt(
  prisma: PrismaClient,
  data: JobPayload,
): Promise<{ status: string; reason?: string }> {
  const logger = workerLogger();

  let result;
  try {
    result = await runScoreAttempt(prisma, data);
  } catch (error) {
    // Неожиданный сбой виден администратору как повторяемая ошибка,
    // после чего задание отдаётся политике повторов очереди.
    await recordJobFailed(prisma, data.outboxId, 'unexpected_error');
    throw error;
  }

  logger.info(
    { attemptId: data.entityId, status: result.status, reason: result.reason },
    'Подсчёт попытки',
  );

  if (result.status === 'failed') {
    await recordJobFailed(prisma, data.outboxId, result.failureCode ?? 'scoring_failed');
  } else {
    await recordJobCompleted(prisma, data.outboxId);
  }

  if ((result.status === 'scored' || result.status === 'already_scored') && data.assignmentId) {
    const requested = await requestReportIfReady(prisma, data.organizationId, data.assignmentId);
    if (requested) {
      logger.info({ assignmentId: data.assignmentId }, 'Запрошена подготовка заключения');
    }
  }

  return result;
}

export async function handleGenerateReport(
  prisma: PrismaClient,
  data: JobPayload,
): Promise<{ status: string; reason?: string }> {
  const logger = workerLogger();

  let result;
  try {
    result = await runGenerateReport(prisma, data);
  } catch (error) {
    await recordJobFailed(prisma, data.outboxId, 'unexpected_error');
    throw error;
  }

  logger.info(
    { assignmentId: data.entityId, status: result.status, reason: result.reason },
    'Подготовка заключения',
  );

  if (result.status === 'failed') {
    await recordJobFailed(prisma, data.outboxId, result.failureCode ?? 'generation_failed');
  } else {
    await recordJobCompleted(prisma, data.outboxId);
  }

  return result;
}
