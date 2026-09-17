import { z } from 'zod';

import { uuidSchema } from './common';

/**
 * Временный доступ администратора платформы к данным организации.
 *
 * По умолчанию администратор видит только эксплуатационные метаданные.
 * Доступ к заключению конкретного назначения выдаётся владельцем организации
 * на ограниченный срок и под названную цель, каждое чтение записывается
 * в журнал (ТЗ 10.4, A03, M13).
 */

export const ACCESS_GRANT_PURPOSES = ['report_review', 'incident_support', 'data_request'] as const;

export type AccessGrantPurpose = (typeof ACCESS_GRANT_PURPOSES)[number];

export const ACCESS_GRANT_PURPOSE_LABELS: Readonly<Record<AccessGrantPurpose, string>> = {
  report_review: 'Разбор заключения',
  incident_support: 'Разбор инцидента обработки',
  data_request: 'Исполнение запроса по данным',
};

/**
 * Состояние гранта. `expired` не хранится отдельно: истечение определяется
 * сроком, чтобы доступ закрывался сам, а не ждал фонового задания.
 */
export const ACCESS_GRANT_STATES = [
  'requested',
  'approved',
  'rejected',
  'revoked',
  'expired',
] as const;

export type AccessGrantState = (typeof ACCESS_GRANT_STATES)[number];

export const ACCESS_GRANT_STATE_LABELS: Readonly<Record<AccessGrantState, string>> = {
  requested: 'Ожидает решения',
  approved: 'Выдан',
  rejected: 'Отклонён',
  revoked: 'Отозван',
  expired: 'Срок истёк',
};

/** Максимальный срок доступа к данным поддержки — сутки (ТЗ A03). */
export const ACCESS_GRANT_MAX_HOURS = 24;

/** По умолчанию доступ выдаётся на час: продление оформляется отдельно. */
export const ACCESS_GRANT_DEFAULT_HOURS = 1;

/** Объём доступа. Доступ «ко всей организации» выдать нельзя. */
export const accessGrantScopeSchema = z.object({
  assignmentIds: z.array(uuidSchema).min(1).max(20),
});

export type AccessGrantScope = z.infer<typeof accessGrantScopeSchema>;

export const accessGrantSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  organizationCode: z.string(),
  organizationName: z.string(),
  purpose: z.enum(ACCESS_GRANT_PURPOSES),
  state: z.enum(ACCESS_GRANT_STATES),
  reason: z.string(),
  scope: accessGrantScopeSchema,
  /** Кто просит доступ. Владелец организации должен видеть, кому он его даёт. */
  requestedBy: z.object({ userId: uuidSchema, displayName: z.string() }),
  requestedAt: z.iso.datetime({ offset: true }),
  approvedBy: z.object({ userId: uuidSchema, displayName: z.string() }).nullable(),
  approvedAt: z.iso.datetime({ offset: true }).nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
  decisionNote: z.string().nullable(),
  /**
   * Срок, о котором просил администратор. Выданный срок — `expiresAt`.
   *
   * Сервер заполняет поле всегда; необязательным оно оставлено, чтобы
   * добавление не ломало уже существующий тип `AccessGrant` у потребителей.
   * `null` — «срок не просили», отсутствие — «поле не пришло».
   */
  requestedHours: z.number().int().nullable().optional(),
  /** Продлеваемый грант: продление — отдельная запись, а не новый срок у прежней. */
  extendsGrantId: uuidSchema.nullable(),
  /** Действует ли доступ прямо сейчас. Вычисляется сервером, не хранится. */
  active: z.boolean(),
});

export type AccessGrant = z.infer<typeof accessGrantSchema>;

export const createAccessGrantInputSchema = z.object({
  purpose: z.enum(ACCESS_GRANT_PURPOSES),
  /** Причина обязательна: доступ без объяснения выдавать нечему. */
  reason: z.string().trim().min(10).max(1000),
  assignmentIds: z.array(uuidSchema).min(1).max(20),
  requestedHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(ACCESS_GRANT_MAX_HOURS)
    .default(ACCESS_GRANT_DEFAULT_HOURS),
});

export type CreateAccessGrantInput = z.infer<typeof createAccessGrantInputSchema>;

export const approveAccessGrantInputSchema = z.object({
  /**
   * Выдаваемый срок. Не указан — выдаётся срок по умолчанию: владелец
   * сокращает доступ молчанием, а не расширяет его.
   */
  hours: z.coerce
    .number()
    .int()
    .min(1)
    .max(ACCESS_GRANT_MAX_HOURS)
    .default(ACCESS_GRANT_DEFAULT_HOURS),
  /**
   * Выдать ровно тот срок, о котором просил администратор (`requestedHours`).
   * Отдельным признаком, а не молчанием: согласие со сроком — решение владельца.
   */
  useRequestedHours: z.boolean().optional(),
  note: z.string().trim().max(1000).optional(),
});

export type ApproveAccessGrantInput = z.infer<typeof approveAccessGrantInputSchema>;

export const rejectAccessGrantInputSchema = z.object({
  /** Отказ объясняется: запрашивающий должен понимать, что делать дальше. */
  note: z.string().trim().min(5).max(1000),
});

export type RejectAccessGrantInput = z.infer<typeof rejectAccessGrantInputSchema>;

/**
 * Запрос продления. Объём и цель наследуются от продлеваемого гранта и не
 * расширяются; продление снова решает владелец организации.
 */
export const extendAccessGrantInputSchema = z.object({
  /** Зачем нужен дополнительный срок: прежняя причина его не объясняет. */
  reason: z.string().trim().min(10).max(1000),
  requestedHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(ACCESS_GRANT_MAX_HOURS)
    .default(ACCESS_GRANT_DEFAULT_HOURS),
});

export type ExtendAccessGrantInput = z.infer<typeof extendAccessGrantInputSchema>;

/** Отзыв: пояснение необязательно, но попадает в карточку обращения. */
export const revokeAccessGrantInputSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

export type RevokeAccessGrantInput = z.infer<typeof revokeAccessGrantInputSchema>;

/** Назначение в объёме гранта: код случая вместо сведений о человеке. */
export const grantedCaseSchema = z.object({
  assignmentId: uuidSchema,
  caseCode: z.string(),
  scenarioTitle: z.string(),
  assignmentState: z.string(),
  reportId: uuidSchema.nullable(),
  reportStatus: z.string().nullable(),
});

export type GrantedCase = z.infer<typeof grantedCaseSchema>;

/**
 * Назначение организации в списке администратора платформы.
 *
 * Нужно ровно для одного: составить объём обращения за доступом — без перечня
 * назначений указать объём нечем. Поэтому полей здесь минимум и все они
 * псевдонимные: код случая вместо имени сотрудника, без `external_code`, без
 * содержания ответов и без состояния назначения и заключения — оно к выбору
 * объёма не относится и видно только по выданному гранту (ТЗ 10.4, A03).
 */
export const adminAssignmentSummarySchema = z.object({
  assignmentId: uuidSchema,
  caseCode: z.string(),
  scenarioTitle: z.string(),
  scenarioCode: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});

export type AdminAssignmentSummary = z.infer<typeof adminAssignmentSummarySchema>;
