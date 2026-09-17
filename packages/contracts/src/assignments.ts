import { z } from 'zod';

import {
  ASSIGNMENT_STATES,
  BATCH_MAX_EMPLOYEES,
  INVITATION_DEFAULT_DAYS,
  INVITATION_MAX_DAYS,
  INVITATION_MIN_DAYS,
  SCENARIO_CODES,
} from '@context/domain';

import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, uuidSchema } from './common';
import { contextValuesSchema } from './scenarios';

export const assignmentDraftInputSchema = z.object({
  scenarioVersionId: uuidSchema.nullable().optional(),
  context: contextValuesSchema.default({}),
  employeeIds: z.array(uuidSchema).max(BATCH_MAX_EMPLOYEES).default([]),
  dueDays: z.number().int().min(INVITATION_MIN_DAYS).max(INVITATION_MAX_DAYS).nullable().optional(),
  step: z.number().int().min(1).max(4).default(1),
  expectedRevision: z.number().int().min(1).optional(),
});

export type AssignmentDraftInput = z.infer<typeof assignmentDraftInputSchema>;

export const assignmentDraftSchema = z.object({
  id: uuidSchema,
  scenarioVersionId: uuidSchema.nullable(),
  context: contextValuesSchema,
  employeeIds: z.array(uuidSchema),
  dueDays: z.number().int().nullable(),
  step: z.number().int(),
  revision: z.number().int(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type AssignmentDraft = z.infer<typeof assignmentDraftSchema>;

/**
 * Что делать, если у сотрудника уже есть активная оценка той же версии сценария.
 * Молчаливое создание дубликата запрещено: руководитель выбирает явно (ТЗ M05).
 */
export const DUPLICATE_POLICIES = ['reject', 'create_separate'] as const;

export const createAssignmentsRequestSchema = z.object({
  scenarioVersionId: uuidSchema,
  employeeIds: z.array(uuidSchema).min(1).max(BATCH_MAX_EMPLOYEES),
  context: contextValuesSchema,
  /** Поправки к контексту для отдельных сотрудников. */
  perEmployeeContext: z.record(uuidSchema, contextValuesSchema).default({}),
  dueDays: z
    .number()
    .int()
    .min(INVITATION_MIN_DAYS)
    .max(INVITATION_MAX_DAYS)
    .default(INVITATION_DEFAULT_DAYS),
  duplicatePolicy: z.enum(DUPLICATE_POLICIES).default('reject'),
  duplicateReason: z.string().trim().max(500).optional(),
  draftId: uuidSchema.optional(),
});

export type CreateAssignmentsRequest = z.infer<typeof createAssignmentsRequestSchema>;

export const assignmentSummarySchema = z.object({
  id: uuidSchema,
  employeeId: uuidSchema,
  employeeLabel: z.string(),
  scenarioCode: z.enum(SCENARIO_CODES),
  scenarioTitle: z.string(),
  scenarioVersion: z.string(),
  state: z.enum(ASSIGNMENT_STATES),
  stateLabel: z.string(),
  mode: z.enum(['demo', 'research', 'validated_use']),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  attemptsSubmitted: z.number().int(),
  attemptsTotal: z.number().int(),
  reportStatus: z.string().nullable(),
  reportStatusLabel: z.string().nullable(),
  reportId: uuidSchema.nullable(),
});

export type AssignmentSummary = z.infer<typeof assignmentSummarySchema>;

export const assignmentDetailSchema = assignmentSummarySchema.extend({
  context: contextValuesSchema,
  contextFields: z.array(
    z.object({ key: z.string(), label: z.string(), value: z.string(), isOpinion: z.boolean() }),
  ),
  /** Методики назначения без ключей подсчёта и без ответов участника. */
  methods: z.array(
    z.object({
      attemptId: uuidSchema,
      methodVersionId: uuidSchema,
      title: z.string(),
      orderIndex: z.number().int(),
      required: z.boolean(),
      state: z.string(),
      stateLabel: z.string(),
      itemCount: z.number().int(),
      submittedAt: z.iso.datetime({ offset: true }).nullable(),
    }),
  ),
  timeline: z.array(
    z.object({
      at: z.iso.datetime({ offset: true }),
      title: z.string(),
    }),
  ),
  invitation: z
    .object({
      expiresAt: z.iso.datetime({ offset: true }),
      revokedAt: z.iso.datetime({ offset: true }).nullable(),
      lastExchangedAt: z.iso.datetime({ offset: true }).nullable(),
    })
    .nullable(),
  replacesAssignmentId: uuidSchema.nullable(),
  cancelReason: z.string().nullable(),
  /** Какие действия сервер примет в текущем состоянии. */
  availableActions: z.array(
    z.enum([
      'issue_invitation',
      'change_deadline',
      'cancel',
      'open_report',
      'reassign',
      'delete_draft',
    ]),
  ),
});

export type AssignmentDetail = z.infer<typeof assignmentDetailSchema>;

export const ASSIGNMENT_SORT_FIELDS = ['createdAt', 'dueAt', 'updatedAt'] as const;

export const assignmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  scenarioCode: z.enum(SCENARIO_CODES).optional(),
  state: z.enum(ASSIGNMENT_STATES).optional(),
  reportStatus: z.enum(['pending', 'published']).optional(),
  employeeId: uuidSchema.optional(),
  sort: z.enum(ASSIGNMENT_SORT_FIELDS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type AssignmentListQuery = z.infer<typeof assignmentListQuerySchema>;

export const changeDeadlineRequestSchema = z.object({
  dueDays: z.number().int().min(INVITATION_MIN_DAYS).max(INVITATION_MAX_DAYS),
  expectedRevision: z.number().int().min(1).optional(),
});

export type ChangeDeadlineRequest = z.infer<typeof changeDeadlineRequestSchema>;

export const cancelAssignmentRequestSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});

export type CancelAssignmentRequest = z.infer<typeof cancelAssignmentRequestSchema>;

/**
 * Результат создания назначений. Персональные ссылки здесь не возвращаются:
 * их выпускает отдельная операция, и открытое значение выдаётся один раз.
 */
export const createAssignmentsResultSchema = z.object({
  created: z.array(
    z.object({
      assignmentId: uuidSchema,
      employeeId: uuidSchema,
      employeeLabel: z.string(),
    }),
  ),
  rejected: z.array(
    z.object({ employeeId: uuidSchema, employeeLabel: z.string(), reason: z.string() }),
  ),
});

export type CreateAssignmentsResult = z.infer<typeof createAssignmentsResultSchema>;

export const invitationLinkSchema = z.object({
  assignmentId: uuidSchema,
  /** Полный URL с токеном во fragment. Возвращается только при выпуске. */
  url: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
  secretAvailable: z.boolean(),
  replacedPrevious: z.boolean(),
});

export type InvitationLink = z.infer<typeof invitationLinkSchema>;
