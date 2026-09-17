import type {
  AnswerResponse,
  MethodItem,
  MissingPolicy,
  ScaleConfig,
  ScoringConfig,
} from '@context/contracts';

import { ScoringConfigError, ScoringInputError } from './errors';

/**
 * Версия алгоритма подсчёта. Сохраняется вместе с результатом: пересчёт новой
 * версией создаёт новую запись и не переписывает исторический результат.
 */
export const SCORER_VERSION = '1.0.0';
export const SCORE_OUTPUT_SCHEMA_VERSION = '1.0';

export interface ScaleResult {
  readonly scaleId: string;
  readonly title: string;
  readonly description: string;
  /** null означает «результат не определён», а не ноль. */
  readonly value: number | null;
  readonly aggregate: ScaleConfig['aggregate'];
  readonly itemsUsed: number;
  readonly itemsExpected: number;
  readonly expectedRange: { readonly min: number; readonly max: number };
  readonly unresolved: readonly string[];
}

export interface MissingEntry {
  readonly itemId: string;
  readonly reason: 'no_answer' | 'not_scorable';
}

export interface ScoreResult {
  readonly scorerVersion: string;
  readonly outputSchemaVersion: string;
  readonly scales: readonly ScaleResult[];
  readonly missing: readonly MissingEntry[];
}

/** Числовое значение ответа и допустимый диапазон конкретного вопроса. */
interface NumericAnswer {
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Детерминированный подсчёт по закреплённой версии методики.
 *
 * Свойства, на которые опирается остальная система:
 *   * одинаковый вход даёт одинаковый выход;
 *   * отсутствующий ответ никогда не превращается в ноль;
 *   * значение вне объявленного диапазона считается ошибкой конфигурации,
 *     а не «просто необычным результатом».
 */
export function scoreAttempt(
  items: readonly MethodItem[],
  config: ScoringConfig,
  answers: ReadonlyMap<string, AnswerResponse>,
): ScoreResult {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const missing: MissingEntry[] = [];
  const scales: ScaleResult[] = [];

  for (const scale of config.scales) {
    const values: number[] = [];
    const weights: number[] = [];
    const unresolved: string[] = [];

    for (const itemId of scale.items) {
      const item = itemsById.get(itemId);
      if (!item) {
        throw new ScoringConfigError(
          `Шкала ${scale.id} ссылается на несуществующий вопрос ${itemId}.`,
        );
      }

      const answer = answers.get(itemId);
      if (answer === undefined) {
        missing.push({ itemId, reason: 'no_answer' });
        unresolved.push(itemId);
        continue;
      }

      const numeric = toNumericAnswer(item, answer, config);
      if (numeric === null) {
        // Вопрос принципиально не даёт числа: он относится к свидетельствам,
        // а не к шкале. Это ошибка конфигурации, а не данных участника.
        throw new ScoringConfigError(
          `Вопрос ${itemId} типа «${item.type}» не может входить в шкалу ${scale.id}.`,
        );
      }

      const applied = scale.reverseItems.includes(itemId)
        ? numeric.min + numeric.max - numeric.value
        : numeric.value;

      values.push(applied);
      weights.push(scale.weights?.[itemId] ?? 1);
    }

    scales.push(aggregateScale(scale, values, weights, unresolved, config.missingPolicy));
  }

  return {
    scorerVersion: SCORER_VERSION,
    outputSchemaVersion: SCORE_OUTPUT_SCHEMA_VERSION,
    scales,
    missing,
  };
}

function aggregateScale(
  scale: ScaleConfig,
  values: readonly number[],
  weights: readonly number[],
  unresolved: readonly string[],
  missingPolicy: MissingPolicy,
): ScaleResult {
  const base = {
    scaleId: scale.id,
    title: scale.title,
    description: scale.description,
    aggregate: scale.aggregate,
    itemsUsed: values.length,
    itemsExpected: scale.items.length,
    expectedRange: scale.expectedRange,
    unresolved,
  } as const;

  if (unresolved.length > 0) {
    if (missingPolicy === 'reject') {
      throw new ScoringInputError(
        `Шкала ${scale.id}: нет ответов на вопросы ${unresolved.join(', ')}, а политика пропусков — reject.`,
      );
    }
    if (missingPolicy === 'mark_unknown') {
      // Значение не определено. Подстановка среднего или нуля запрещена.
      return { ...base, value: null };
    }
  }

  if (values.length === 0) {
    return { ...base, value: null };
  }

  const value = applyOperator(scale, values, weights);

  if (!Number.isFinite(value)) {
    throw new ScoringConfigError(`Шкала ${scale.id} дала нечисловой результат.`);
  }

  // Диапазон проверяется только при полном наборе ответов: при exclude_item
  // сумма по части вопросов закономерно ниже объявленного минимума.
  if (unresolved.length === 0) {
    const { min, max } = scale.expectedRange;
    if (value < min || value > max) {
      throw new ScoringConfigError(
        `Шкала ${scale.id}: результат ${value} вне объявленного диапазона [${min}; ${max}].`,
      );
    }
  }

  return { ...base, value: round(value) };
}

function applyOperator(
  scale: ScaleConfig,
  values: readonly number[],
  weights: readonly number[],
): number {
  switch (scale.aggregate) {
    case 'sum':
      return values.reduce((acc, value) => acc + value, 0);
    case 'mean':
      return values.reduce((acc, value) => acc + value, 0) / values.length;
    case 'weighted_sum': {
      let total = 0;
      for (const [index, value] of values.entries()) {
        const weight = weights[index] ?? 1;
        if (!Number.isFinite(weight)) {
          throw new ScoringConfigError(`Шкала ${scale.id}: некорректный вес вопроса.`);
        }
        total += value * weight;
      }
      return total;
    }
  }
}

/** Округление до 4 знаков: результат воспроизводим и не зависит от порядка вывода. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function toNumericAnswer(
  item: MethodItem,
  answer: AnswerResponse,
  config: ScoringConfig,
): NumericAnswer | null {
  switch (item.type) {
    case 'likert': {
      if (answer.type !== 'likert') {
        throw new ScoringInputError(`Вопрос ${item.id}: ожидался ответ шкалы.`);
      }
      if (answer.value < item.min || answer.value > item.max) {
        throw new ScoringInputError(
          `Вопрос ${item.id}: значение ${answer.value} вне шкалы [${item.min}; ${item.max}].`,
        );
      }
      return { value: answer.value, min: item.min, max: item.max };
    }

    case 'numeric': {
      if (answer.type !== 'numeric') {
        throw new ScoringInputError(`Вопрос ${item.id}: ожидался числовой ответ.`);
      }
      if (answer.value < item.min || answer.value > item.max) {
        throw new ScoringInputError(
          `Вопрос ${item.id}: значение ${answer.value} вне диапазона [${item.min}; ${item.max}].`,
        );
      }
      return { value: answer.value, min: item.min, max: item.max };
    }

    case 'single_choice': {
      if (answer.type !== 'single_choice') {
        throw new ScoringInputError(`Вопрос ${item.id}: ожидался выбор одного варианта.`);
      }
      if (!item.options.some((option) => option.id === answer.optionId)) {
        throw new ScoringInputError(
          `Вопрос ${item.id}: вариант ${answer.optionId} не принадлежит этой версии методики.`,
        );
      }
      const scores = requireOptionScores(item.id, config);
      return withOptionRange(item.id, scores, requireScore(item.id, scores, answer.optionId));
    }

    case 'multiple_choice': {
      if (answer.type !== 'multiple_choice') {
        throw new ScoringInputError(`Вопрос ${item.id}: ожидался выбор нескольких вариантов.`);
      }
      for (const optionId of answer.optionIds) {
        if (!item.options.some((option) => option.id === optionId)) {
          throw new ScoringInputError(
            `Вопрос ${item.id}: вариант ${optionId} не принадлежит этой версии методики.`,
          );
        }
      }
      const scores = requireOptionScores(item.id, config);
      const total = answer.optionIds.reduce(
        (acc, optionId) => acc + requireScore(item.id, scores, optionId),
        0,
      );
      const all = Object.values(scores);
      const positives = all.filter((value) => value > 0).reduce((a, b) => a + b, 0);
      const negatives = all.filter((value) => value < 0).reduce((a, b) => a + b, 0);
      return { value: total, min: negatives, max: positives };
    }

    case 'situational': {
      if (answer.type !== 'situational') {
        throw new ScoringInputError(`Вопрос ${item.id}: ожидался ответ на ситуацию.`);
      }
      if (item.response.kind !== 'single_choice') {
        // Свободный текст ситуационного задания в шкалу не входит:
        // без утверждённой рубрики балл ему не назначается.
        return null;
      }
      if (answer.optionId === undefined) {
        throw new ScoringInputError(`Вопрос ${item.id}: не выбран вариант.`);
      }
      if (!item.response.options.some((option) => option.id === answer.optionId)) {
        throw new ScoringInputError(
          `Вопрос ${item.id}: вариант ${answer.optionId} не принадлежит этой версии методики.`,
        );
      }
      const scores = requireOptionScores(item.id, config);
      return withOptionRange(item.id, scores, requireScore(item.id, scores, answer.optionId));
    }

    case 'short_text':
      return null;
  }
}

function requireOptionScores(
  itemId: string,
  config: ScoringConfig,
): Readonly<Record<string, number>> {
  const scores = config.optionScores?.[itemId];
  if (!scores || Object.keys(scores).length === 0) {
    throw new ScoringConfigError(`Для вопроса ${itemId} не заданы баллы вариантов.`);
  }
  return scores;
}

function requireScore(
  itemId: string,
  scores: Readonly<Record<string, number>>,
  optionId: string,
): number {
  const value = scores[optionId];
  if (value === undefined || !Number.isFinite(value)) {
    throw new ScoringConfigError(`Для вопроса ${itemId} не задан балл варианта ${optionId}.`);
  }
  return value;
}

function withOptionRange(
  itemId: string,
  scores: Readonly<Record<string, number>>,
  value: number,
): NumericAnswer {
  const all = Object.values(scores);
  if (all.length === 0) {
    throw new ScoringConfigError(`Для вопроса ${itemId} не заданы баллы вариантов.`);
  }
  return { value, min: Math.min(...all), max: Math.max(...all) };
}
