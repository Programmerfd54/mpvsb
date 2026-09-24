import { z } from 'zod';

import { APPLICABILITY_MODES, READINESS_CHECK_KEYS, READINESS_STATES } from '@context/domain';

import { uuidSchema } from './common';
import { draftMethodPassportSchema, draftScoringConfigSchema, methodItemSchema } from './methods';
import { contextSchemaSchema } from './scenarios';

/**
 * Контракты кабинета администратора платформы.
 *
 * Роль администратора управляет платформой, но не получает автоматического
 * доступа к содержанию клиентских оценок: ответы, evidence и черновики
 * заключений здесь не возвращаются (ТЗ 05).
 */

export const adminOrganizationSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  timezone: z.string(),
  mode: z.enum(APPLICABILITY_MODES),
  status: z.enum(['active', 'suspended']),
  activeEmployeeLimit: z.number().int(),
  /** Эксплуатационные количества, без персональных сведений. */
  counts: z.object({
    managers: z.number().int(),
    employees: z.number().int(),
    activeAssignments: z.number().int(),
    pendingReports: z.number().int(),
  }),
  readinessVerified: z.number().int(),
  readinessTotal: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
});

export type AdminOrganization = z.infer<typeof adminOrganizationSchema>;

export const createOrganizationInputSchema = z.object({
  name: z.string().trim().min(2).max(200),
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,62}$/, 'Код: латиница в нижнем регистре, цифры и подчёркивание'),
  timezone: z.string().trim().min(3).max(64).default('Europe/Moscow'),
  activeEmployeeLimit: z.number().int().min(1).max(5000).default(500),
  /** Владелец организации. Ему выпускается одноразовая ссылка активации. */
  ownerEmail: z.string().trim().toLowerCase().max(320),
  ownerName: z.string().trim().min(1).max(200),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;

export const suspendOrganizationSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
});

export type SuspendOrganizationInput = z.infer<typeof suspendOrganizationSchema>;

export const updateReadinessSchema = z.object({
  key: z.enum(READINESS_CHECK_KEYS),
  state: z.enum(READINESS_STATES),
  note: z.string().trim().max(1000).optional(),
  /** Ссылка на подтверждение вне репозитория, если документ чувствителен. */
  evidenceRef: z.string().trim().max(500).optional(),
});

export type UpdateReadinessInput = z.infer<typeof updateReadinessSchema>;

export const WORKSPACE_SETUP_STEPS = [
  'company',
  'mail',
  'mail_template',
  'departments',
  'users',
  'review',
] as const;

export const adminWorkspaceSchema = z.object({
  organizationId: uuidSchema,
  name: z.string(),
  logoUrl: z.string().nullable(),
  revision: z.number().int().positive(),
  setupCompletedAt: z.iso.datetime({ offset: true }).nullable(),
  steps: z.array(
    z.object({
      key: z.enum(WORKSPACE_SETUP_STEPS),
      status: z.enum(['pending', 'complete']),
    }),
  ),
});

export type AdminWorkspace = z.infer<typeof adminWorkspaceSchema>;

export const updateAdminWorkspaceSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    logoUrl: z.string().trim().url().max(500).nullable().optional(),
    expectedRevision: z.number().int().positive(),
  })
  .refine((value) => value.name !== undefined || value.logoUrl !== undefined, {
    message: 'Укажите хотя бы одно изменение',
  });

export type UpdateAdminWorkspace = z.infer<typeof updateAdminWorkspaceSchema>;

export const adminMailSettingsSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  secure: z.boolean(),
  username: z.string().nullable(),
  passwordConfigured: z.boolean(),
  fromEmail: z.string(),
  fromName: z.string(),
  revision: z.number().int().positive(),
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
  lastTestErrorCode: z.string().nullable(),
});
export type AdminMailSettings = z.infer<typeof adminMailSettingsSchema>;

export const saveAdminMailSettingsSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().max(320).nullable(),
  password: z.string().min(1).max(1000).nullable().optional(),
  fromEmail: z.string().trim().toLowerCase().email().max(320),
  fromName: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().positive().nullable(),
});
export type SaveAdminMailSettings = z.infer<typeof saveAdminMailSettingsSchema>;

export const adminMailTestSchema = z.object({
  connected: z.boolean(),
  testedAt: z.iso.datetime({ offset: true }),
  message: z.string(),
});
export type AdminMailTest = z.infer<typeof adminMailTestSchema>;

export const adminMailTemplateSchema = z.object({
  subject: z.string(),
  greeting: z.string(),
  body: z.string(),
  buttonLabel: z.string(),
  signature: z.string(),
  supportContact: z.string().nullable(),
  status: z.enum(['draft', 'published']),
  revision: z.number().int().positive(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type AdminMailTemplate = z.infer<typeof adminMailTemplateSchema>;

export const saveAdminMailTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  greeting: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(3000),
  buttonLabel: z.string().trim().min(1).max(80),
  signature: z.string().trim().min(1).max(500),
  supportContact: z.string().trim().max(320).nullable(),
  expectedRevision: z.number().int().positive().nullable(),
  publish: z.boolean().default(false),
});
export type SaveAdminMailTemplate = z.infer<typeof saveAdminMailTemplateSchema>;

export const adminDepartmentSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  status: z.enum(['active', 'archived']),
  employeeCount: z.number().int().nonnegative(),
  managerCount: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
});

export type AdminDepartment = z.infer<typeof adminDepartmentSchema>;

export const adminDepartmentDetailSchema = adminDepartmentSchema.extend({
  managers: z.array(
    z.object({
      userId: uuidSchema,
      displayName: z.string(),
      assignedAt: z.iso.datetime({ offset: true }),
    }),
  ),
  employees: z.array(
    z.object({
      employeeId: uuidSchema,
      displayName: z.string().nullable(),
      jobTitle: z.string().nullable(),
      archived: z.boolean(),
      revision: z.number().int().positive(),
    }),
  ),
  availableManagers: z.array(
    z.object({
      userId: uuidSchema,
      displayName: z.string(),
      membershipStatus: z.enum(['invited', 'active']),
    }),
  ),
});

export type AdminDepartmentDetail = z.infer<typeof adminDepartmentDetailSchema>;

export const adminDepartmentListQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

export type AdminDepartmentListQuery = z.infer<typeof adminDepartmentListQuerySchema>;

export const createAdminDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export type CreateAdminDepartment = z.infer<typeof createAdminDepartmentSchema>;

export const updateAdminDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  expectedRevision: z.number().int().positive(),
});

export type UpdateAdminDepartment = z.infer<typeof updateAdminDepartmentSchema>;

export const archiveAdminDepartmentSchema = z.object({
  expectedRevision: z.number().int().positive(),
});

export type ArchiveAdminDepartment = z.infer<typeof archiveAdminDepartmentSchema>;

export const assignDepartmentManagerSchema = z.object({
  userId: uuidSchema,
});

export type AssignDepartmentManager = z.infer<typeof assignDepartmentManagerSchema>;

export const transferEmployeeSchema = z.object({
  targetDepartmentId: uuidSchema,
  expectedEmployeeRevision: z.number().int().positive(),
  reason: z.string().trim().min(5).max(1000),
  activeAssignmentsAction: z.enum(['keep_current_scope', 'cancel']),
});

export type TransferEmployee = z.infer<typeof transferEmployeeSchema>;

export const transferEmployeeResultSchema = z.object({
  employeeId: uuidSchema,
  sourceDepartmentId: uuidSchema,
  targetDepartmentId: uuidSchema,
  cancelledAssignments: z.number().int().nonnegative(),
  employeeRevision: z.number().int().positive(),
});

export type TransferEmployeeResult = z.infer<typeof transferEmployeeResultSchema>;

export const adminUserSchema = z.object({
  userId: uuidSchema.nullable(),
  employeeId: uuidSchema.nullable(),
  displayName: z.string(),
  jobTitle: z.string().nullable(),
  email: z.string().nullable(),
  role: z.enum(['manager', 'reviewer', 'employee']),
  departments: z.array(z.object({ id: uuidSchema, name: z.string() })),
  deliveryStatus: z.enum(['pending', 'sent', 'delivered', 'failed', 'unavailable']),
  activationStatus: z.enum(['pending', 'activated', 'blocked']),
  lastLoginAt: z.iso.datetime({ offset: true }).nullable(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

export const inviteAdminUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    jobTitle: z.string().trim().max(120).nullable().optional(),
    email: z.string().trim().toLowerCase().email().max(320),
    role: z.enum(['manager', 'reviewer', 'employee']),
    departmentIds: z.array(uuidSchema).min(1),
  })
  .superRefine((value, context) => {
    if (value.role === 'employee' && value.departmentIds.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['departmentIds'],
        message: 'Для сотрудника выберите одно подразделение',
      });
    }
  });

export type InviteAdminUser = z.infer<typeof inviteAdminUserSchema>;

export const adminUserInvitationSchema = z.object({
  user: adminUserSchema,
  activation: z.object({
    url: z.string(),
    expiresAt: z.iso.datetime({ offset: true }),
    secretAvailable: z.boolean(),
  }),
  deliveryStatus: z.literal('pending'),
  deliveryMessage: z.string(),
});

export type AdminUserInvitation = z.infer<typeof adminUserInvitationSchema>;

// ——— Методики ———

export const adminMethodSchema = z.object({
  methodId: uuidSchema,
  code: z.string(),
  title: z.string(),
  versions: z.array(
    z.object({
      versionId: uuidSchema,
      semanticVersion: z.string(),
      status: z.enum(['draft', 'review', 'published', 'suspended_for_new_assignments', 'retired']),
      applicabilityMode: z.enum(APPLICABILITY_MODES),
      itemCount: z.number().int(),
      /** Публикация и проверенность применения — разные вещи. */
      validationStatus: z.string(),
      contentHash: z.string().nullable(),
      publishedAt: z.iso.datetime({ offset: true }).nullable(),
      createdAt: z.iso.datetime({ offset: true }),
    }),
  ),
});

export type AdminMethod = z.infer<typeof adminMethodSchema>;

export const adminMethodVersionSchema = z.object({
  versionId: uuidSchema,
  methodId: uuidSchema,
  code: z.string(),
  semanticVersion: z.string(),
  status: z.enum(['draft', 'review', 'published', 'suspended_for_new_assignments', 'retired']),
  applicabilityMode: z.enum(APPLICABILITY_MODES),
  passport: draftMethodPassportSchema,
  items: z.array(methodItemSchema),
  scoring: draftScoringConfigSchema,
  fixtures: z.array(
    z.object({
      name: z.string(),
      answers: z.record(z.string(), z.unknown()),
      expected: z.record(z.string(), z.number().nullable()),
    }),
  ),
  validationMetadata: z.record(z.string(), z.unknown()),
  licenseMetadata: z.record(z.string(), z.unknown()),
  contentHash: z.string().nullable(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Опубликованная версия редактированию не подлежит. */
  editable: z.boolean(),
});

export type AdminMethodVersion = z.infer<typeof adminMethodVersionSchema>;

/** Результат прогона контрольных примеров методики. */
export const methodCheckResultSchema = z.object({
  ok: z.boolean(),
  fixtures: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      details: z.array(
        z.object({
          scaleId: z.string(),
          expected: z.number().nullable(),
          actual: z.number().nullable(),
          matches: z.boolean(),
        }),
      ),
      error: z.string().nullable(),
    }),
  ),
  /** Проблемы конфигурации, мешающие публикации. */
  blockers: z.array(z.string()),
});

export type MethodCheckResult = z.infer<typeof methodCheckResultSchema>;

// ——— Редактирование содержимого методики ———

export const createMethodInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,62}$/, 'Код: латиница в нижнем регистре, цифры и подчёркивание'),
  title: z.string().trim().min(2).max(200),
  semanticVersion: z
    .string()
    .trim()
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Версия в формате 1.0.0')
    .default('1.0.0'),
});

export type CreateMethodInput = z.infer<typeof createMethodInputSchema>;

/**
 * Новая версия методики. Опубликованная версия не редактируется: изменение
 * оформляется отдельной версией, а старые назначения продолжают считаться
 * по той, с которой создавались (ТЗ 01.5).
 */
export const createMethodVersionInputSchema = z.object({
  semanticVersion: z
    .string()
    .trim()
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Версия в формате 1.0.0'),
  /** Скопировать содержимое из существующей версии. */
  copyFromVersionId: uuidSchema.optional(),
});

export type CreateMethodVersionInput = z.infer<typeof createMethodVersionInputSchema>;

export const methodDraftContentSchema = z.object({
  passport: draftMethodPassportSchema,
  items: z.array(methodItemSchema).max(300),
  scoring: draftScoringConfigSchema,
  fixtures: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        answers: z.record(z.string(), z.unknown()),
        expected: z.record(z.string(), z.number().nullable()),
      }),
    )
    .max(50)
    .default([]),
  applicabilityMode: z.enum(APPLICABILITY_MODES),
});

export type MethodDraftContent = z.infer<typeof methodDraftContentSchema>;

export const updateMethodVersionInputSchema = methodDraftContentSchema.extend({
  /** Оптимистичная блокировка: правка из другого окна не перезаписывается молча. */
  expectedContentHash: z.string().nullable(),
});

export type UpdateMethodVersionInput = z.infer<typeof updateMethodVersionInputSchema>;

/** Результат разбора импортируемого JSON до записи. */
export const methodImportPreviewSchema = z.object({
  accepted: z.boolean(),
  /** Что будет записано, если импорт принять. */
  summary: z
    .object({
      title: z.string(),
      itemCount: z.number().int(),
      scaleCount: z.number().int(),
      fixtureCount: z.number().int(),
    })
    .nullable(),
  /** Ошибки схемы: путь и понятное объяснение. */
  schemaErrors: z.array(z.object({ path: z.string(), message: z.string() })),
  /** Структурные проблемы: ссылки шкал, баллы вариантов, диапазоны. */
  issues: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(['blocker', 'warning']),
      message: z.string(),
      target: z.string(),
    }),
  ),
});

export type MethodImportPreview = z.infer<typeof methodImportPreviewSchema>;

// ——— Сценарии ———

export const adminScenarioSchema = z.object({
  scenarioId: uuidSchema,
  code: z.string(),
  title: z.string(),
  versions: z.array(
    z.object({
      versionId: uuidSchema,
      semanticVersion: z.string(),
      status: z.enum(['draft', 'review', 'published', 'suspended_for_new_assignments', 'retired']),
      applicabilityMode: z.enum(APPLICABILITY_MODES),
      methodCount: z.number().int(),
      contextFieldCount: z.number().int(),
      publishedAt: z.iso.datetime({ offset: true }).nullable(),
    }),
  ),
});

export type AdminScenario = z.infer<typeof adminScenarioSchema>;

export const adminScenarioVersionSchema = z.object({
  versionId: uuidSchema,
  scenarioId: uuidSchema,
  code: z.string(),
  title: z.string(),
  semanticVersion: z.string(),
  status: z.enum(['draft', 'review', 'published', 'suspended_for_new_assignments', 'retired']),
  applicabilityMode: z.enum(APPLICABILITY_MODES),
  contextSchema: contextSchemaSchema,
  methods: z.array(
    z.object({
      /** Идентификатор методики: две её версии в одном сценарии несовместимы. */
      methodId: uuidSchema,
      methodVersionId: uuidSchema,
      code: z.string(),
      title: z.string(),
      semanticVersion: z.string(),
      status: z.string(),
      applicabilityMode: z.enum(APPLICABILITY_MODES),
      orderIndex: z.number().int(),
      required: z.boolean(),
      itemCount: z.number().int(),
    }),
  ),
  reportingPolicyId: uuidSchema.nullable(),
  reportingPolicy: z
    .object({
      code: z.string(),
      semanticVersion: z.string(),
      permittedClaims: z.array(z.string()),
      requiredLimitations: z.array(z.string()),
      forbiddenClaims: z.array(z.string()),
    })
    .nullable(),
  participantVisibility: z.enum(['completion_receipt', 'participant_summary']),
  contentHash: z.string().nullable(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  editable: z.boolean(),
});

export type AdminScenarioVersion = z.infer<typeof adminScenarioVersionSchema>;

// ——— Редактирование сценария ———

export const createScenarioInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,62}$/, 'Код: латиница в нижнем регистре, цифры и подчёркивание'),
  title: z.string().trim().min(2).max(200),
  semanticVersion: z
    .string()
    .trim()
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Версия в формате 1.0.0')
    .default('1.0.0'),
});

export type CreateScenarioInput = z.infer<typeof createScenarioInputSchema>;

export const createScenarioVersionInputSchema = z.object({
  semanticVersion: z
    .string()
    .trim()
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Версия в формате 1.0.0'),
  copyFromVersionId: uuidSchema.optional(),
});

export type CreateScenarioVersionInput = z.infer<typeof createScenarioVersionInputSchema>;

export const updateScenarioVersionInputSchema = z.object({
  applicabilityMode: z.enum(APPLICABILITY_MODES),
  contextSchema: contextSchemaSchema,
  /** Версии методик в порядке прохождения. Порядок задаёт сценарий, не участник. */
  methods: z
    .array(
      z.object({
        methodVersionId: uuidSchema,
        orderIndex: z.number().int().min(0),
        required: z.boolean(),
      }),
    )
    .max(20),
  reportingPolicyId: uuidSchema.nullable(),
  participantVisibility: z.enum(['completion_receipt', 'participant_summary']),
  /** Оптимистичная блокировка по хэшу содержимого. */
  expectedContentHash: z.string().nullable(),
});

export type UpdateScenarioVersionInput = z.infer<typeof updateScenarioVersionInputSchema>;

/** Политика заключения: что допустимо, что обязательно и что запрещено утверждать. */
export const reportingPolicySchema = z.object({
  id: uuidSchema,
  code: z.string(),
  semanticVersion: z.string(),
  permittedClaims: z.array(z.string()),
  requiredLimitations: z.array(z.string()),
  forbiddenClaims: z.array(z.string()),
  participantVisibility: z.enum(['completion_receipt', 'participant_summary']),
});

export type ReportingPolicy = z.infer<typeof reportingPolicySchema>;

export const createReportingPolicyInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,62}$/, 'Код: латиница в нижнем регистре, цифры и подчёркивание'),
  semanticVersion: z
    .string()
    .trim()
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Версия в формате 1.0.0')
    .default('1.0.0'),
  permittedClaims: z.array(z.string().trim().min(3).max(500)).default([]),
  /** Без обязательных ограничений публиковать заключение нельзя. */
  requiredLimitations: z.array(z.string().trim().min(5).max(500)).min(1),
  forbiddenClaims: z.array(z.string().trim().min(3).max(500)).default([]),
});

export type CreateReportingPolicyInput = z.infer<typeof createReportingPolicyInputSchema>;

/** Версия методики, доступная для включения в сценарий. */
export const availableMethodVersionSchema = z.object({
  methodId: uuidSchema,
  methodVersionId: uuidSchema,
  code: z.string(),
  title: z.string(),
  semanticVersion: z.string(),
  status: z.string(),
  applicabilityMode: z.enum(APPLICABILITY_MODES),
  itemCount: z.number().int(),
});

export type AvailableMethodVersion = z.infer<typeof availableMethodVersionSchema>;

// ——— Техническое состояние ———

export const adminOverviewSchema = z.object({
  organizations: z.object({ active: z.number().int(), suspended: z.number().int() }),
  assignmentsInProcessing: z.number().int(),
  reportsPendingReview: z.number().int(),
  failedJobs: z.number().int(),
  attention: z.array(
    z.object({
      kind: z.enum([
        'generation_failed',
        'suspended_method',
        'expiring_grant',
        'pending_recovery',
        'pending_privacy_request',
      ]),
      title: z.string(),
      organizationCode: z.string().nullable(),
      occurredAt: z.iso.datetime({ offset: true }),
    }),
  ),
  generatedAt: z.iso.datetime({ offset: true }),
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;

/**
 * Состояние задания.
 *
 * `queued` — ждёт доставки в очередь; `running` — доставлено, исход ещё
 * не записан; `done` — обработчик завершился; `failed` — записан код ошибки;
 * `stopped` — повторы остановлены администратором.
 */
export const JOB_STATES = ['queued', 'running', 'done', 'failed', 'stopped'] as const;

export type JobState = (typeof JOB_STATES)[number];

export const adminJobSchema = z.object({
  id: uuidSchema,
  eventType: z.string(),
  entityType: z.string(),
  organizationCode: z.string().nullable(),
  /** Код назначения: технический экран обходится им вместо имени сотрудника. */
  assignmentCode: z.string().nullable(),
  state: z.enum(JOB_STATES),
  attempts: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  failedAt: z.iso.datetime({ offset: true }).nullable(),
  lastErrorCode: z.string().nullable(),
  /** Задержка от постановки до завершения, миллисекунды. Измеренная, не расчётная. */
  latencyMs: z.number().int().nullable(),
  retryable: z.boolean(),
});

export type AdminJob = z.infer<typeof adminJobSchema>;

export const adminJobFilterSchema = z.object({
  eventType: z.string().max(100).optional(),
  state: z.enum(JOB_STATES).optional(),
  /** Период в часах от текущего момента. Без него — весь журнал. */
  periodHours: z.coerce.number().int().min(1).max(8760).optional(),
  organizationCode: z.string().max(63).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type AdminJobFilter = z.infer<typeof adminJobFilterSchema>;

/**
 * Технические детали задания.
 *
 * Полезная нагрузка не показывается: перечисляются только имена её полей.
 * Ответы участника, тексты заключений и секреты на этот экран не попадают
 * (ТЗ A09, 10.4).
 */
export const adminJobDetailsSchema = z.object({
  job: adminJobSchema,
  entityId: uuidSchema,
  dataGeneration: z.string(),
  /** Имена полей полезной нагрузки без значений. */
  payloadKeys: z.array(z.string()),
  queueName: z.string().nullable(),
  retriedAt: z.iso.datetime({ offset: true }).nullable(),
  retriesStoppedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Почему повтор сейчас невозможен. Пусто — повтор допустим. */
  retryBlockers: z.array(z.string()),
});

export type AdminJobDetails = z.infer<typeof adminJobDetailsSchema>;

export const adminAuditEventSchema = z.object({
  id: uuidSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  actorType: z.string(),
  actorId: uuidSchema.nullable(),
  action: z.string(),
  resourceType: z.string().nullable(),
  outcome: z.enum(['success', 'denied', 'failed']),
  organizationCode: z.string().nullable(),
  requestId: z.string().nullable(),
});

export type AdminAuditEvent = z.infer<typeof adminAuditEventSchema>;

export const adminAuditFilterSchema = z.object({
  action: z.string().max(100).optional(),
  actorType: z.enum(['manager', 'platform_admin', 'participant', 'service']).optional(),
  actorId: uuidSchema.optional(),
  resourceType: z.string().max(100).optional(),
  organizationCode: z.string().max(63).optional(),
  periodHours: z.coerce.number().int().min(1).max(8760).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type AdminAuditFilter = z.infer<typeof adminAuditFilterSchema>;

/**
 * Развёрнутая запись аудита.
 *
 * Метаданные проходят через allowlist: ответы участника, тексты заключений,
 * токены и адреса в журнал не попадают, а длинные значения обрезаются
 * (ТЗ A11, 10.4).
 */
export const adminAuditDetailsSchema = z.object({
  event: adminAuditEventSchema,
  resourceId: uuidSchema.nullable(),
  purpose: z.string().nullable(),
  metadata: z.array(z.object({ key: z.string(), value: z.string() })),
  /** Поля, скрытые allowlist-ом. Показывается имя, не значение. */
  redactedKeys: z.array(z.string()),
});

export type AdminAuditDetails = z.infer<typeof adminAuditDetailsSchema>;

/** Справочники для фильтров: только значения, которые действительно встречаются. */
export const adminOperationsFacetsSchema = z.object({
  eventTypes: z.array(z.string()),
  actions: z.array(z.string()),
  resourceTypes: z.array(z.string()),
  organizationCodes: z.array(z.string()),
});

export type AdminOperationsFacets = z.infer<typeof adminOperationsFacetsSchema>;
