import { z } from 'zod';

import {
  EVIDENCE_KINDS,
  FINDING_KINDS,
  REPORT_REVISION_STATES,
  SCENARIO_CODES,
  SUPPORT_LEVELS,
} from '@context/domain';

import { uuidSchema } from './common';

export const evidenceIdSchema = z.string().regex(/^ev_[a-z0-9_]{1,40}$/);

/**
 * Схема аналитического заключения.
 *
 * Ключевые ограничения зашиты в тип:
 *   * каждое утверждение ссылается на существующие evidence ID;
 *   * `prediction` по умолчанию null и заполняется только при отдельно
 *     подтверждённой возможности прогноза для конкретной цели;
 *   * ограничения — обязательный непустой список, их нельзя «забыть».
 */
export const findingSchema = z.object({
  id: z.string().regex(/^finding_[a-z0-9_]{1,40}$/),
  statement: z.string().min(5).max(1000),
  evidenceIds: z.array(evidenceIdSchema).max(20),
  kind: z.enum(FINDING_KINDS),
  limitations: z.array(z.string().min(3).max(500)).max(10).default([]),
});

export type Finding = z.infer<typeof findingSchema>;

export const nextActionSchema = z.object({
  title: z.string().min(3).max(300),
  why: z.string().min(5).max(500),
  evidenceIds: z.array(evidenceIdSchema).max(20).default([]),
  owner: z.enum(['manager', 'employee', 'joint']),
});

export type NextAction = z.infer<typeof nextActionSchema>;

/**
 * Прогноз. Заполняется только когда для этой цели зарегистрирована проверенная
 * возможность: модель сама по себе не вправе выдавать вероятность или порог.
 */
export const predictionSchema = z.object({
  target: z.string().min(3).max(200),
  horizonDays: z.number().int().positive(),
  calibratedProbability: z.number().min(0).max(1).optional(),
  categoricalPrediction: z.string().max(200).optional(),
  threshold: z.number().optional(),
  capabilityId: z.string().min(3).max(120),
  intendedPopulation: z.string().min(3).max(500),
  limitations: z.array(z.string().min(3).max(500)).min(1),
});

export type Prediction = z.infer<typeof predictionSchema>;

export const reportContentSchema = z.object({
  schemaVersion: z.literal('1.0'),
  scenarioCode: z.enum(SCENARIO_CODES),
  /** Код случая вместо имени: в payload провайдера персональных данных нет. */
  caseCode: z.string().min(2).max(64),
  supportLevel: z.enum(SUPPORT_LEVELS),
  summary: z.string().min(10).max(2000),
  decisionNotes: z.array(z.string().min(5).max(1000)).max(6).default([]),
  findings: z.array(findingSchema).max(30),
  contradictions: z
    .array(
      z.object({
        statement: z.string().min(5).max(1000),
        evidenceIds: z.array(evidenceIdSchema).min(2).max(10),
      }),
    )
    .max(10)
    .default([]),
  limitations: z.array(z.string().min(3).max(500)).min(1).max(15),
  nextActions: z.array(nextActionSchema).max(3).default([]),
  reconsiderWhen: z.array(z.string().min(3).max(500)).max(10).default([]),
  prediction: predictionSchema.nullable().default(null),
});

export type ReportContent = z.infer<typeof reportContentSchema>;

export const REPORT_OUTPUT_SCHEMA_VERSION = '1.0';

/** Свидетельство, показываемое рецензенту и в основаниях заключения. */
export const evidenceItemSchema = z.object({
  evidenceCode: evidenceIdSchema,
  kind: z.enum(EVIDENCE_KINDS),
  kindLabel: z.string(),
  kindLimit: z.string(),
  collectedAt: z.iso.datetime({ offset: true }),
  content: z.string(),
  limitations: z.array(z.string()),
});

export type EvidenceItemView = z.infer<typeof evidenceItemSchema>;

export const reportSummarySchema = z.object({
  reportId: uuidSchema,
  assignmentId: uuidSchema,
  employeeLabel: z.string(),
  scenarioCode: z.enum(SCENARIO_CODES),
  scenarioTitle: z.string(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  revisionNo: z.number().int(),
  supportLevel: z.enum(SUPPORT_LEVELS),
  supportLevelLabel: z.string(),
  summary: z.string(),
  generationMode: z.enum(['fake', 'template', 'llm']),
  generationModeLabel: z.string(),
  mode: z.enum(['demo', 'research', 'validated_use']),
  superseded: z.boolean(),
});

export type ReportSummary = z.infer<typeof reportSummarySchema>;

export const reportDetailSchema = reportSummarySchema.extend({
  revisionId: uuidSchema,
  /**
   * Состояние показанной ревизии. Выводить «проверено» из `publishedAt`
   * ненадёжно: опубликованное заключение и черновик на проверке должны
   * различаться явно (ТЗ A08). Поле необязательное — старый клиент его не ждёт.
   */
  revisionState: z.enum(REPORT_REVISION_STATES).optional(),
  content: reportContentSchema,
  evidence: z.array(evidenceItemSchema),
  /** Сведения о подготовке: версии, рецензия, режим. Без цепочки рассуждений модели. */
  preparation: z.object({
    methods: z.array(z.object({ title: z.string(), version: z.string() })),
    scenarioVersion: z.string(),
    scorerVersion: z.string().nullable(),
    promptVersion: z.string().nullable(),
    reviewedAt: z.iso.datetime({ offset: true }).nullable(),
    reviewerName: z.string().nullable(),
    inputHash: z.string().nullable(),
  }),
  currentRevisionId: uuidSchema.nullable(),
  decisions: z.array(
    z.object({
      actionCode: z.string(),
      actionLabel: z.string(),
      comment: z.string().nullable(),
      followUpAt: z.iso.datetime({ offset: true }).nullable(),
      createdAt: z.iso.datetime({ offset: true }),
      actorName: z.string(),
    }),
  ),
});

export type ReportDetail = z.infer<typeof reportDetailSchema>;

export const recordDecisionRequestSchema = z.object({
  actionCode: z.enum([
    'discussed_with_employee',
    'collected_more_information',
    'scheduled_follow_up',
    'approved_next_step',
    'postponed',
    'no_action',
  ]),
  comment: z.string().trim().max(2000).optional(),
  followUpAt: z.iso.datetime({ offset: true }).optional(),
});

export type RecordDecisionRequest = z.infer<typeof recordDecisionRequestSchema>;

/** Блоки заключения, к которым руководитель может заявить неточность. */
export const CORRECTION_BLOCK_KEYS = [
  'summary',
  'findings',
  'limitations',
  'nextActions',
  'other',
] as const;

export type CorrectionBlockKey = (typeof CORRECTION_BLOCK_KEYS)[number];

export const CORRECTION_BLOCK_LABELS: Readonly<Record<CorrectionBlockKey, string>> = {
  summary: 'Краткая записка',
  findings: 'Наблюдения',
  limitations: 'Ограничения',
  nextActions: 'Следующие шаги',
  other: 'Другое',
};

export const correctionRequestInputSchema = z.object({
  blockKey: z.enum(CORRECTION_BLOCK_KEYS),
  description: z.string().trim().min(5).max(2000),
});

export type CorrectionRequestInput = z.infer<typeof correctionRequestInputSchema>;

/** Состояния разбора запроса на исправление (core.correction_requests.state). */
export const CORRECTION_REQUEST_STATES = ['received', 'accepted', 'rejected', 'resolved'] as const;

export type CorrectionRequestState = (typeof CORRECTION_REQUEST_STATES)[number];

export const CORRECTION_REQUEST_STATE_LABELS: Readonly<Record<CorrectionRequestState, string>> = {
  received: 'Получен',
  accepted: 'Принят в работу',
  rejected: 'Отклонён',
  resolved: 'Закрыт исправленной версией',
};

/**
 * Запрос на исправление в проекции для рецензента (ТЗ 01.7, M10, M15).
 *
 * Это тот материал, ради которого создаётся уведомление `revision_requested`:
 * рецензент должен видеть, к какому блоку и что именно заявлено. Свободный
 * текст остаётся здесь, за разрешением `reports.review`, и в само уведомление
 * не переносится. Имени автора запроса в проекции нет: для разбора достаточно
 * того, от кого он — от руководителя или от участника.
 */
export const correctionRequestSchema = z.object({
  id: uuidSchema,
  reportId: uuidSchema,
  requesterType: z.enum(['manager', 'participant']),
  blockKey: z.enum(CORRECTION_BLOCK_KEYS).nullable(),
  blockLabel: z.string().nullable(),
  description: z.string(),
  state: z.enum(CORRECTION_REQUEST_STATES),
  stateLabel: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type CorrectionRequestView = z.infer<typeof correctionRequestSchema>;

/** Пункты обязательного чек-листа рецензента (ТЗ A08). */
export const REVIEW_CHECKLIST_ITEMS = [
  'statements_match_evidence',
  'fact_and_self_report_separated',
  'limitations_present',
  'no_invented_numbers',
  'actions_relate_to_question',
  'scope_applicable',
] as const;

export const REVIEW_CHECKLIST_LABELS: Readonly<
  Record<(typeof REVIEW_CHECKLIST_ITEMS)[number], string>
> = {
  statements_match_evidence: 'Утверждения соответствуют приведённым сведениям',
  fact_and_self_report_separated: 'Факт и самоотчёт различены',
  limitations_present: 'Ограничения сохранены и видны',
  no_invented_numbers: 'Нет выдуманных процентов и норм',
  actions_relate_to_question: 'Предложенные действия относятся к заданному вопросу',
  scope_applicable: 'Область применения методик соблюдена',
};

export const reviewChecklistSchema = z.object(
  Object.fromEntries(REVIEW_CHECKLIST_ITEMS.map((key) => [key, z.literal(true)])) as Record<
    (typeof REVIEW_CHECKLIST_ITEMS)[number],
    z.ZodLiteral<true>
  >,
);

export const publishReportRequestSchema = z.object({
  checklist: reviewChecklistSchema,
  comment: z.string().trim().max(4000).optional(),
});

export type PublishReportRequest = z.infer<typeof publishReportRequestSchema>;

export const requestRevisionSchema = z.object({
  comment: z.string().trim().min(5).max(4000),
});

export type RequestRevisionRequest = z.infer<typeof requestRevisionSchema>;
