import { z } from 'zod';

import { TEXT_LIMITS } from './common';

/**
 * Модель содержимого методики.
 *
 * Идентификаторы вопросов и вариантов стабильны внутри версии: сохранённый ответ
 * всегда сопоставим с исходным вопросом, даже если формулировка позже изменится
 * в новой версии (старая версия при этом остаётся неизменной).
 */

export const itemIdSchema = z
  .string()
  .regex(/^item_[a-z0-9_]{1,40}$/, 'Некорректный идентификатор вопроса');

export const optionIdSchema = z
  .string()
  .regex(/^opt_[a-z0-9_]{1,40}$/, 'Некорректный идентификатор варианта');

const optionSchema = z.object({
  id: optionIdSchema,
  label: z.string().min(1).max(500),
});

const baseItemFields = {
  id: itemIdSchema,
  prompt: z.string().min(1).max(1000),
  hint: z.string().max(500).optional(),
  required: z.boolean().default(true),
};

export const singleChoiceItemSchema = z.object({
  ...baseItemFields,
  type: z.literal('single_choice'),
  options: z.array(optionSchema).min(2).max(12),
});

export const multipleChoiceItemSchema = z.object({
  ...baseItemFields,
  type: z.literal('multiple_choice'),
  options: z.array(optionSchema).min(2).max(20),
  minSelected: z.number().int().min(0).default(1),
  maxSelected: z.number().int().min(1).default(20),
});

/**
 * Шкала с подписанными вариантами. Отображается радиокнопками:
 * слайдер не должен быть единственным способом ответить (ТЗ E05).
 */
export const likertItemSchema = z.object({
  ...baseItemFields,
  type: z.literal('likert'),
  min: z.number().int(),
  max: z.number().int(),
  labels: z.array(z.object({ value: z.number().int(), label: z.string().min(1).max(200) })).min(2),
});

export const numericItemSchema = z.object({
  ...baseItemFields,
  type: z.literal('numeric'),
  min: z.number(),
  max: z.number(),
  step: z.number().positive().default(1),
  unit: z.string().max(40).optional(),
});

export const shortTextItemSchema = z.object({
  ...baseItemFields,
  type: z.literal('short_text'),
  maxLength: z.number().int().min(1).max(TEXT_LIMITS.shortAnswer.max).default(1000),
});

/** Ситуационное задание: описание плюс ответ одного из поддержанных типов. */
export const situationalItemSchema = z.object({
  ...baseItemFields,
  type: z.literal('situational'),
  situation: z.string().min(1).max(2000),
  response: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('single_choice'), options: z.array(optionSchema).min(2).max(12) }),
    z.object({
      kind: z.literal('short_text'),
      maxLength: z.number().int().min(1).max(TEXT_LIMITS.shortAnswer.max).default(1000),
    }),
  ]),
});

export const methodItemSchema = z.discriminatedUnion('type', [
  singleChoiceItemSchema,
  multipleChoiceItemSchema,
  likertItemSchema,
  numericItemSchema,
  shortTextItemSchema,
  situationalItemSchema,
]);

export type MethodItem = z.infer<typeof methodItemSchema>;
export type MethodItemType = MethodItem['type'];

// ——— Ответы участника ———

export const singleChoiceResponseSchema = z.object({
  type: z.literal('single_choice'),
  optionId: optionIdSchema,
});

export const multipleChoiceResponseSchema = z.object({
  type: z.literal('multiple_choice'),
  optionIds: z.array(optionIdSchema).max(20),
});

export const likertResponseSchema = z.object({
  type: z.literal('likert'),
  value: z.number().int(),
});

export const numericResponseSchema = z.object({
  type: z.literal('numeric'),
  value: z.number().finite(),
});

export const shortTextResponseSchema = z.object({
  type: z.literal('short_text'),
  text: z.string().max(TEXT_LIMITS.shortAnswer.max),
});

export const situationalResponseSchema = z.object({
  type: z.literal('situational'),
  optionId: optionIdSchema.optional(),
  text: z.string().max(TEXT_LIMITS.shortAnswer.max).optional(),
});

export const answerResponseSchema = z.discriminatedUnion('type', [
  singleChoiceResponseSchema,
  multipleChoiceResponseSchema,
  likertResponseSchema,
  numericResponseSchema,
  shortTextResponseSchema,
  situationalResponseSchema,
]);

export type AnswerResponse = z.infer<typeof answerResponseSchema>;

// ——— Конфигурация подсчёта ———

/**
 * Операторы из allowlist. Произвольный код в конфигурации не исполняется:
 * сложный алгоритм подключается отдельным проверенным scorer по идентификатору.
 */
export const AGGREGATE_OPERATORS = ['sum', 'mean', 'weighted_sum'] as const;
export type AggregateOperator = (typeof AGGREGATE_OPERATORS)[number];

export const MISSING_POLICIES = ['reject', 'mark_unknown', 'exclude_item'] as const;
export type MissingPolicy = (typeof MISSING_POLICIES)[number];

export const scaleConfigSchema = z.object({
  id: z.string().regex(/^scale_[a-z0-9_]{1,40}$/),
  title: z.string().min(1).max(200),
  /** Что шкала описывает и чего не означает. Попадает в отчёт рядом с числом. */
  description: z.string().min(1).max(1000),
  items: z.array(itemIdSchema).min(1),
  /** Вопросы обратного подсчёта: значение пересчитывается как min + max - ответ. */
  reverseItems: z.array(itemIdSchema).default([]),
  aggregate: z.enum(AGGREGATE_OPERATORS),
  weights: z.record(itemIdSchema, z.number().finite()).optional(),
  /** Допустимый диапазон результата. Выход за него означает ошибку конфигурации. */
  expectedRange: z.object({ min: z.number(), max: z.number() }),
});

export type ScaleConfig = z.infer<typeof scaleConfigSchema>;

export const scoringConfigSchema = z.object({
  scales: z.array(scaleConfigSchema).min(1),
  missingPolicy: z.enum(MISSING_POLICIES).default('reject'),
  /**
   * Баллы вариантов ответа. Живут только в конфигурации подсчёта на сервере:
   * в публичную проекцию методики для участника ключи не попадают (ТЗ 07.4).
   */
  optionScores: z.record(itemIdSchema, z.record(optionIdSchema, z.number().finite())).optional(),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

/**
 * Конфигурация подсчёта в черновике.
 *
 * Шкал может ещё не быть: методику собирают постепенно. Публикация требует
 * хотя бы одной шкалы и сошедшихся контрольных примеров.
 */
export const draftScoringConfigSchema = z.object({
  scales: z.array(scaleConfigSchema).default([]),
  missingPolicy: z.enum(MISSING_POLICIES).default('reject'),
  optionScores: z.record(itemIdSchema, z.record(optionIdSchema, z.number().finite())).optional(),
});

export type DraftScoringConfig = z.infer<typeof draftScoringConfigSchema>;

// ——— Паспорт методики ———

export const methodPassportSchema = z.object({
  title: z.string().min(2).max(200),
  /** Что методика измеряет по утверждению её владельца. */
  purpose: z.string().min(10).max(2000),
  targetPopulation: z.string().min(2).max(500),
  language: z.string().default('ru'),
  /** Ограничения применения. Пустым быть не может и AI его не заполняет. */
  limitations: z.array(z.string().min(5).max(500)).min(1),
  /** Источник содержимого и основание использования. */
  sourceStatement: z.string().min(5).max(1000),
  rightsStatement: z.string().min(5).max(1000),
  /** Ориентир длительности. Отсутствие означает «время пока не измерено». */
  estimatedMinutes: z.number().int().min(1).max(240).nullable().default(null),
  /** Что видит участник до начала. */
  participantIntro: z.string().min(10).max(2000),
});

export type MethodPassport = z.infer<typeof methodPassportSchema>;

/**
 * Паспорт черновика.
 *
 * Черновик по определению неполон: методику заполняют постепенно. Поэтому
 * минимальные длины здесь сняты, но набор полей тот же — забыть про них нельзя.
 * Полноту требует публикация: она проверяет паспорт строгой схемой выше.
 */
export const draftMethodPassportSchema = z.object({
  title: z.string().max(200).default(''),
  purpose: z.string().max(2000).default(''),
  targetPopulation: z.string().max(500).default(''),
  language: z.string().default('ru'),
  limitations: z.array(z.string().max(500)).default([]),
  sourceStatement: z.string().max(1000).default(''),
  rightsStatement: z.string().max(1000).default(''),
  estimatedMinutes: z.number().int().min(1).max(240).nullable().default(null),
  participantIntro: z.string().max(2000).default(''),
});

export type DraftMethodPassport = z.infer<typeof draftMethodPassportSchema>;

/**
 * Чего не хватает паспорту для публикации.
 * Возвращает понятные названия полей, а не пути схемы.
 */
export function missingPassportFields(passport: DraftMethodPassport): string[] {
  const missing: string[] = [];
  if (passport.title.trim().length < 2) {
    missing.push('название методики');
  }
  if (passport.purpose.trim().length < 10) {
    missing.push('что методика измеряет по заявлению владельца');
  }
  if (passport.targetPopulation.trim().length < 2) {
    missing.push('целевая группа');
  }
  if (passport.limitations.length === 0) {
    missing.push('ограничения применения');
  }
  if (passport.sourceStatement.trim().length < 5) {
    missing.push('источник содержимого');
  }
  if (passport.rightsStatement.trim().length < 5) {
    missing.push('основание использования');
  }
  if (passport.participantIntro.trim().length < 10) {
    missing.push('что видит участник перед началом');
  }
  return missing;
}

/** Публичная проекция методики для участника: без ключей и норм. */
export const publicMethodSchema = z.object({
  methodVersionId: z.uuid(),
  code: z.string(),
  title: z.string(),
  participantIntro: z.string(),
  itemCount: z.number().int(),
  estimatedMinutes: z.number().int().nullable(),
  applicabilityMode: z.enum(['demo', 'research', 'validated_use']),
});

export type PublicMethod = z.infer<typeof publicMethodSchema>;
