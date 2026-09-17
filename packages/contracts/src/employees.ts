import { z } from 'zod';

import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, TEXT_LIMITS, uuidSchema } from './common';

/**
 * Сотрудник организации. Обязательно хотя бы одно из: отображаемое имя или
 * внутренний код — компания может работать только с кодами (ТЗ M03).
 */
export const employeeInputSchema = z
  .object({
    displayName: z.string().trim().max(TEXT_LIMITS.displayName.max).optional(),
    externalCode: z.string().trim().max(TEXT_LIMITS.externalCode.max).optional(),
    jobTitle: z.string().trim().max(TEXT_LIMITS.jobTitle.max).optional(),
    department: z.string().trim().max(TEXT_LIMITS.department.max).optional(),
    /** В P0 не используется для автоматической отправки: ссылку передаёт руководитель. */
    email: z.string().trim().max(320).optional(),
  })
  .refine((value) => Boolean(value.displayName?.length) || Boolean(value.externalCode?.length), {
    message: 'Укажите имя или внутренний код сотрудника',
    path: ['displayName'],
  });

export type EmployeeInput = z.infer<typeof employeeInputSchema>;

export const employeeSummarySchema = z.object({
  id: uuidSchema,
  displayName: z.string().nullable(),
  externalCode: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  activeAssignments: z.number().int(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type EmployeeSummary = z.infer<typeof employeeSummarySchema>;

export const employeeDetailSchema = employeeSummarySchema.extend({
  email: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  revision: z.number().int(),
});

export type EmployeeDetail = z.infer<typeof employeeDetailSchema>;

export const EMPLOYEE_SORT_FIELDS = ['updatedAt', 'createdAt', 'name'] as const;

export const employeeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  /** Поиск по имени или коду. Строка не попадает в стороннюю аналитику. */
  query: z.string().trim().max(200).optional(),
  department: z.string().trim().max(TEXT_LIMITS.department.max).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  sort: z.enum(EMPLOYEE_SORT_FIELDS).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

/**
 * Архивирование скрывает сотрудника из активного списка. Решение об активных
 * назначениях принимает руководитель явно: тихой отмены не происходит.
 */
export const archiveEmployeeRequestSchema = z.object({
  cancelActiveAssignments: z.boolean().default(false),
});

export type ArchiveEmployeeRequest = z.infer<typeof archiveEmployeeRequestSchema>;

export const bulkArchiveRequestSchema = z.object({
  employeeIds: z.array(uuidSchema).min(1).max(50),
  cancelActiveAssignments: z.boolean().default(false),
});

export type BulkArchiveRequest = z.infer<typeof bulkArchiveRequestSchema>;

export const employeeTimelineEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.iso.datetime({ offset: true }),
  kind: z.enum([
    'assignment_created',
    'assignment_cancelled',
    'assignment_completed',
    'report_published',
    'decision_recorded',
  ]),
  title: z.string(),
  resourceId: uuidSchema.nullable(),
});

export type EmployeeTimelineEntry = z.infer<typeof employeeTimelineEntrySchema>;
