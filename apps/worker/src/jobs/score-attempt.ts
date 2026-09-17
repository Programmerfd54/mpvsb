import {
  answerResponseSchema,
  methodItemSchema,
  scoringConfigSchema,
  type AnswerResponse,
} from '@context/contracts';
import { toJson, withTenant, type PrismaClient } from '@context/database';
import { attemptStateMachine, type AttemptState } from '@context/domain';
import { SCORE_OUTPUT_SCHEMA_VERSION, SCORER_VERSION, scoreAttempt } from '@context/scoring';
import { z } from 'zod';

import { workerLogger } from '../logger.js';

const itemsSchema = z.array(methodItemSchema);

export interface ScoreAttemptJob {
  readonly organizationId: string;
  readonly entityId: string;
  readonly dataGeneration: string;
}

export interface ScoreAttemptResult {
  readonly status: 'scored' | 'skipped' | 'already_scored' | 'failed';
  readonly reason?: string;
  /** Стабильный код неудачи для журнала обработки. Текст исключения туда не попадает. */
  readonly failureCode?: string;
}

/**
 * Подсчёт одной отправленной попытки.
 *
 * Идемпотентность обеспечивает уникальный ключ (attempt, scorer_version, input_hash):
 * повторная доставка события не создаёт второй результат и не меняет первый.
 *
 * Перед записью повторно проверяется поколение данных: если назначение отменили
 * или данные удалили, пока задание ждало очереди, результат не сохраняется.
 */
export async function runScoreAttempt(
  prisma: PrismaClient,
  job: ScoreAttemptJob,
): Promise<ScoreAttemptResult> {
  const logger = workerLogger();

  return withTenant(prisma, { organizationId: job.organizationId }, async (tx) => {
    const attempt = await tx.attempts.findFirst({
      where: { id: job.entityId, organization_id: job.organizationId },
      select: {
        id: true,
        state: true,
        assignment_id: true,
        method_versions: {
          select: { id: true, items_json: true, scoring_config_json: true, scorer_version: true },
        },
        submission_snapshots: {
          select: { answers_snapshot_json: true, input_hash: true },
        },
        assignments: {
          select: { state: true, data_generation: true, processing_hold: true },
        },
      },
    });

    if (!attempt) {
      return { status: 'skipped', reason: 'Попытка не найдена: вероятно, данные удалены' };
    }

    // Ограда поколения данных: старое задание не воскрешает удалённое и
    // не считает отменённое (ТЗ 10.8).
    if (attempt.assignments.data_generation.toString() !== job.dataGeneration) {
      return { status: 'skipped', reason: 'Поколение данных изменилось после постановки задачи' };
    }
    if (attempt.assignments.processing_hold) {
      return { status: 'skipped', reason: 'Обработка приостановлена по запросу о данных' };
    }
    if (attempt.assignments.state === 'cancelled') {
      return { status: 'skipped', reason: 'Назначение отменено' };
    }

    const state = attempt.state as AttemptState;
    if (state === 'scored') {
      return { status: 'already_scored' };
    }
    if (state !== 'submitted' && state !== 'scoring_failed') {
      return { status: 'skipped', reason: `Недопустимое состояние попытки: ${state}` };
    }

    const snapshot = attempt.submission_snapshots;
    if (!snapshot) {
      return { status: 'skipped', reason: 'Снимок отправленных ответов отсутствует' };
    }

    const existing = await tx.score_results.findFirst({
      where: {
        organization_id: job.organizationId,
        attempt_id: attempt.id,
        scorer_version: SCORER_VERSION,
        input_hash: snapshot.input_hash,
      },
      select: { id: true },
    });

    if (existing) {
      // Результат уже есть: доводим состояние и выходим без повторного расчёта.
      await tx.attempts.update({ where: { id: attempt.id }, data: { state: 'scored' } });
      return { status: 'already_scored' };
    }

    try {
      const items = itemsSchema.parse(attempt.method_versions.items_json);
      const config = scoringConfigSchema.parse(attempt.method_versions.scoring_config_json);

      const rawAnswers = z
        .record(z.string(), answerResponseSchema)
        .parse(snapshot.answers_snapshot_json);
      const answers = new Map<string, AnswerResponse>(Object.entries(rawAnswers));

      const result = scoreAttempt(items, config, answers);

      await tx.score_results.create({
        data: {
          organization_id: job.organizationId,
          attempt_id: attempt.id,
          scorer_version: SCORER_VERSION,
          input_hash: snapshot.input_hash,
          output_schema_version: SCORE_OUTPUT_SCHEMA_VERSION,
          result_json: toJson(result.scales),
          missing_json: toJson(result.missing),
        },
      });

      attemptStateMachine.assert(state, 'scored');
      await tx.attempts.update({ where: { id: attempt.id }, data: { state: 'scored' } });

      return { status: 'scored' };
    } catch (error) {
      // Ошибка содержимого методики не «исправляется» подстановкой значений:
      // попытка помечается как несчитанная, и проблему решает новая версия.
      logger.error({ err: error, attemptId: attempt.id }, 'Не удалось подсчитать попытку');
      await tx.attempts.update({ where: { id: attempt.id }, data: { state: 'scoring_failed' } });
      return {
        status: 'failed',
        reason: (error as Error).message,
        failureCode: 'scoring_failed',
      };
    }
  });
}

/**
 * Проверяет, готово ли назначение к подготовке заключения, и ставит событие.
 * Возвращает true, если событие поставлено.
 */
export async function requestReportIfReady(
  prisma: PrismaClient,
  organizationId: string,
  assignmentId: string,
): Promise<boolean> {
  return withTenant(prisma, { organizationId }, async (tx) => {
    const assignment = await tx.assignments.findFirst({
      where: { id: assignmentId, organization_id: organizationId },
      select: {
        state: true,
        data_generation: true,
        processing_hold: true,
        attempts: { select: { state: true, required: true } },
        reports: { select: { id: true } },
      },
    });

    if (!assignment || assignment.state !== 'completed' || assignment.processing_hold) {
      return false;
    }

    // Заключение готовится один раз: повторное событие не создаёт второй отчёт.
    if (assignment.reports) {
      return false;
    }

    const requiredScored = assignment.attempts
      .filter((attempt) => attempt.required)
      .every((attempt) => attempt.state === 'scored');

    if (!requiredScored) {
      return false;
    }

    await tx.outbox_events.create({
      data: {
        event_type: 'report.generation_requested',
        organization_id: organizationId,
        entity_type: 'assignment',
        entity_id: assignmentId,
        payload: toJson({}),
        data_generation: assignment.data_generation,
      },
    });

    return true;
  });
}
