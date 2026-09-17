import { z } from 'zod';

import { ORG_PERMISSIONS, READINESS_CHECK_KEYS } from '@context/domain';

import { uuidSchema } from './common';

export const organizationSummarySchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  timezone: z.string(),
  mode: z.enum(['demo', 'research', 'validated_use']),
  status: z.enum(['active', 'suspended']),
  participantContact: z.string().nullable(),
  activeEmployeeLimit: z.number().int(),
});

export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const updateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
  /** Контакт, который видит участник. Не персональные данные руководителя. */
  participantContact: z.string().trim().max(300).nullable().optional(),
});

export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;

export const createOrganizationRequestSchema = z.object({
  name: z.string().trim().min(2).max(200),
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,62}$/, 'Код: латиница, цифры и подчёркивание'),
  timezone: z.string().trim().min(3).max(64).default('Europe/Moscow'),
  activeEmployeeLimit: z.number().int().min(1).max(5000).default(500),
});

export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;

export const memberSummarySchema = z.object({
  membershipId: uuidSchema,
  userId: uuidSchema,
  displayName: z.string(),
  email: z.string(),
  permissions: z.array(z.enum(ORG_PERMISSIONS)),
  status: z.enum(['invited', 'active', 'revoked']),
  invitedAt: z.iso.datetime({ offset: true }),
});

export type MemberSummary = z.infer<typeof memberSummarySchema>;

export const updateMemberRequestSchema = z.object({
  permissions: z.array(z.enum(ORG_PERMISSIONS)).min(1),
});

export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

/**
 * Одноразовая ссылка активации. Открытое значение возвращается только в ответе
 * на выпуск и не сохраняется: повторное получение — только новый выпуск.
 */
export const issuedLinkSchema = z.object({
  url: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
  /** false означает, что ключ идемпотентности уже использован и секрет утрачен. */
  secretAvailable: z.boolean(),
});

export type IssuedLink = z.infer<typeof issuedLinkSchema>;

export const readinessCheckSchema = z.object({
  key: z.enum(READINESS_CHECK_KEYS),
  label: z.string(),
  state: z.enum(['pending', 'verified', 'not_applicable']),
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
  note: z.string().nullable(),
});

export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;

export const readinessSummarySchema = z.object({
  mode: z.enum(['demo', 'research', 'validated_use']),
  canRunRealAssessments: z.boolean(),
  /** Конкретные незакрытые пункты, а не общий отказ. */
  blockedReasons: z.array(z.string()),
  checks: z.array(readinessCheckSchema),
});

export type ReadinessSummary = z.infer<typeof readinessSummarySchema>;

export const dashboardSummarySchema = z.object({
  activeAssignments: z.number().int(),
  awaitingStart: z.number().int(),
  inProcessing: z.number().int(),
  newReports: z.number().int(),
  attention: z.array(
    z.object({
      kind: z.enum(['expiring_soon', 'report_ready', 'generation_failed', 'revision_requested']),
      title: z.string(),
      assignmentId: uuidSchema.nullable(),
      reportId: uuidSchema.nullable(),
      occurredAt: z.iso.datetime({ offset: true }),
    }),
  ),
  recentAssessments: z.array(
    z.object({
      assignmentId: uuidSchema,
      employeeLabel: z.string(),
      scenarioTitle: z.string(),
      state: z.string(),
      stateLabel: z.string(),
      updatedAt: z.iso.datetime({ offset: true }),
    }),
  ),
  generatedAt: z.iso.datetime({ offset: true }),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
