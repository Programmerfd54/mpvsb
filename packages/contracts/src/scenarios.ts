import { z } from 'zod';

import { SCENARIO_CODES } from '@context/domain';

import { TEXT_LIMITS, uuidSchema } from './common';

/**
 * Схема контекста решения. Руководитель заполняет её до назначения,
 * сервер проверяет значения по этой же схеме.
 *
 * Поля о здоровье, политических взглядах и семейных обстоятельствах
 * в схеме отсутствуют и не могут быть добавлены редактором сценария (ТЗ M05).
 */
export const CONTEXT_FIELD_TYPES = [
  'text',
  'textarea',
  'date',
  'select',
  'money',
  'number',
] as const;
export type ContextFieldType = (typeof CONTEXT_FIELD_TYPES)[number];

export const contextFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]{1,48}$/),
  label: z.string().min(1).max(200),
  hint: z.string().max(400).optional(),
  type: z.enum(CONTEXT_FIELD_TYPES),
  required: z.boolean().default(false),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  /**
   * Отмечает поле как мнение руководителя, а не факт. В заключении такие сведения
   * помечаются отдельным типом свидетельства (ТЗ 09.4).
   */
  isOpinion: z.boolean().default(false),
  /**
   * Чем поле является для заключения:
   *   `context` — параметр решения (вопрос, роль, срок). Это условие задачи,
   *               а не наблюдение о человеке, и свидетельством не становится;
   *   `fact`    — наблюдаемый рабочий факт, указанный руководителем;
   *   `opinion` — оценка руководителя.
   * Разделение не даёт выдать формулировку вопроса за доказательство (ТЗ 09.4).
   */
  evidenceRole: z.enum(['context', 'fact', 'opinion']).default('context'),
});

export type ContextField = z.infer<typeof contextFieldSchema>;

export const contextSchemaSchema = z.object({
  fields: z.array(contextFieldSchema).min(1),
});

export type ContextSchema = z.infer<typeof contextSchemaSchema>;

/** Значения контекста: только скаляры и строки, вложенных структур нет. */
export const contextValuesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export type ContextValues = z.infer<typeof contextValuesSchema>;

/** Публичная проекция сценария для руководителя. Ключи подсчёта не входят. */
export const publicScenarioSchema = z.object({
  scenarioVersionId: uuidSchema,
  code: z.enum(SCENARIO_CODES),
  title: z.string(),
  purpose: z.string(),
  /** Что платформа по этому сценарию не обещает. Показывается до выбора. */
  limits: z.string(),
  applicabilityMode: z.enum(['demo', 'research', 'validated_use']),
  semanticVersion: z.string(),
  contextSchema: contextSchemaSchema,
  methods: z.array(
    z.object({
      methodVersionId: uuidSchema,
      code: z.string(),
      title: z.string(),
      itemCount: z.number().int(),
      estimatedMinutes: z.number().int().nullable(),
      required: z.boolean(),
      orderIndex: z.number().int(),
      limitations: z.array(z.string()),
    }),
  ),
  participantVisibility: z.enum(['completion_receipt', 'participant_summary']),
  /** Доступен ли сценарий для реального запуска и почему нет. */
  availability: z.object({
    canAssign: z.boolean(),
    blockedReasons: z.array(z.string()),
  }),
});

export type PublicScenario = z.infer<typeof publicScenarioSchema>;

/** Проверка значений контекста по схеме сценария. Выполняется на сервере. */
export function validateContextValues(
  schema: ContextSchema,
  values: ContextValues,
): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = [];
  const known = new Set(schema.fields.map((field) => field.key));

  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      errors.push({ field: `context.${key}`, message: 'Неизвестное поле контекста' });
    }
  }

  for (const field of schema.fields) {
    const value = values[field.key];
    const isEmpty = value === undefined || value === null || value === '';

    if (field.required && isEmpty) {
      errors.push({ field: `context.${field.key}`, message: 'Заполните это поле' });
      continue;
    }
    if (isEmpty) {
      continue;
    }

    if (field.type === 'money' || field.type === 'number') {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) {
        errors.push({ field: `context.${field.key}`, message: 'Укажите число' });
      } else if (field.type === 'money' && !Number.isInteger(numeric)) {
        errors.push({
          field: `context.${field.key}`,
          message: 'Укажите сумму целым числом в минимальных единицах валюты',
        });
      }
      continue;
    }

    if (field.type === 'select') {
      const allowed = field.options?.map((option) => option.value) ?? [];
      if (!allowed.includes(String(value))) {
        errors.push({ field: `context.${field.key}`, message: 'Выберите значение из списка' });
      }
      continue;
    }

    if (field.type === 'date') {
      if (Number.isNaN(Date.parse(String(value)))) {
        errors.push({ field: `context.${field.key}`, message: 'Укажите корректную дату' });
      }
      continue;
    }

    const text = String(value);
    const min = field.minLength ?? 0;
    const max = field.maxLength ?? TEXT_LIMITS.workFacts.max;
    if (text.trim().length < min) {
      errors.push({
        field: `context.${field.key}`,
        message: `Нужно не меньше ${min} символов`,
      });
    }
    if (text.length > max) {
      errors.push({
        field: `context.${field.key}`,
        message: `Нужно не больше ${max} символов`,
      });
    }
  }

  return errors;
}
