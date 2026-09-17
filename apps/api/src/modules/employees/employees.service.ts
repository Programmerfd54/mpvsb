import { Injectable } from '@nestjs/common';

import type {
  BatchResult,
  EmployeeDetail,
  EmployeeInput,
  EmployeeListQuery,
  EmployeeSummary,
  EmployeeTimelineEntry,
} from '@context/contracts';
import type { TenantTransaction } from '@context/database';
import { ASSIGNMENT_STATE_LABELS, DEFAULT_ACTIVE_EMPLOYEE_LIMIT } from '@context/domain';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';

/** Состояния, в которых назначение считается активным для сотрудника. */
const ACTIVE_ASSIGNMENT_STATES = ['draft', 'invited', 'in_progress'] as const;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    query: EmployeeListQuery,
  ): Promise<{ items: EmployeeSummary[]; total: number }> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const where = buildWhere(organizationId, query);

      const [rows, total] = await Promise.all([
        tx.employees.findMany({
          where,
          orderBy: orderByFor(query),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: employeeSelect,
        }),
        tx.employees.count({ where }),
      ]);

      const counts = await activeAssignmentCounts(
        tx,
        organizationId,
        rows.map((row) => row.id),
      );

      return {
        items: rows.map((row) => toSummary(row, counts.get(row.id) ?? 0)),
        total,
      };
    });
  }

  async get(organizationId: string, employeeId: string): Promise<EmployeeDetail> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const row = await tx.employees.findFirst({
        where: { id: employeeId, organization_id: organizationId },
        select: { ...employeeSelect, email: true, created_at: true, revision: true },
      });

      // Чужой или несуществующий сотрудник отвечает одинаково.
      if (!row) {
        throw AppError.notFound(`Сотрудник ${employeeId} недоступен в организации`);
      }

      const counts = await activeAssignmentCounts(tx, organizationId, [row.id]);

      return {
        ...toSummary(row, counts.get(row.id) ?? 0),
        email: row.email,
        createdAt: row.created_at.toISOString(),
        revision: row.revision,
      };
    });
  }

  async create(organizationId: string, input: EmployeeInput): Promise<EmployeeDetail> {
    const employeeId = await this.prisma.tenant({ organizationId }, async (tx) => {
      await this.assertEmployeeLimit(tx, organizationId);
      await this.assertExternalCodeFree(tx, organizationId, input.externalCode);

      const created = await tx.employees.create({
        data: {
          organization_id: organizationId,
          display_name: emptyToNull(input.displayName),
          external_code: emptyToNull(input.externalCode),
          job_title: emptyToNull(input.jobTitle),
          department: emptyToNull(input.department),
          email: emptyToNull(input.email),
        },
        select: { id: true },
      });

      await this.audit.recordIn(tx, {
        action: 'employee.created',
        outcome: 'success',
        organizationId,
        resourceType: 'employee',
        resourceId: created.id,
        // Имя сотрудника в аудит не пишем: достаточно идентификатора.
        metadata: { hasExternalCode: Boolean(input.externalCode) },
      });

      return created.id;
    });

    return this.get(organizationId, employeeId);
  }

  async update(
    organizationId: string,
    employeeId: string,
    input: EmployeeInput,
  ): Promise<EmployeeDetail> {
    await this.prisma.tenant({ organizationId }, async (tx) => {
      const existing = await tx.employees.findFirst({
        where: { id: employeeId, organization_id: organizationId },
        select: { id: true, external_code: true },
      });
      if (!existing) {
        throw AppError.notFound(`Сотрудник ${employeeId} недоступен в организации`);
      }

      if (input.externalCode && input.externalCode !== existing.external_code) {
        await this.assertExternalCodeFree(tx, organizationId, input.externalCode);
      }

      await tx.employees.update({
        where: { id: employeeId },
        data: {
          display_name: emptyToNull(input.displayName),
          external_code: emptyToNull(input.externalCode),
          job_title: emptyToNull(input.jobTitle),
          department: emptyToNull(input.department),
          email: emptyToNull(input.email),
          revision: { increment: 1 },
        },
      });

      await this.audit.recordIn(tx, {
        action: 'employee.updated',
        outcome: 'success',
        organizationId,
        resourceType: 'employee',
        resourceId: employeeId,
      });
    });

    return this.get(organizationId, employeeId);
  }

  /**
   * Архивирование. Активные назначения не отменяются молча: руководитель
   * выбирает это явно, и отмена записывается отдельным событием (ТЗ M03).
   */
  async archive(
    organizationId: string,
    employeeId: string,
    cancelActiveAssignments: boolean,
  ): Promise<{ archived: boolean; cancelledAssignments: number }> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const employee = await tx.employees.findFirst({
        where: { id: employeeId, organization_id: organizationId },
        select: { id: true, archived_at: true },
      });
      if (!employee) {
        throw AppError.notFound(`Сотрудник ${employeeId} недоступен в организации`);
      }
      if (employee.archived_at !== null) {
        throw AppError.conflict('Сотрудник уже в архиве');
      }

      const activeCount = await tx.assignments.count({
        where: {
          organization_id: organizationId,
          employee_id: employeeId,
          state: { in: [...ACTIVE_ASSIGNMENT_STATES] },
        },
      });

      if (activeCount > 0 && !cancelActiveAssignments) {
        throw AppError.businessRule(
          `У сотрудника ${activeCount} активных оценок. Выберите, отменить их или оставить.`,
        );
      }

      let cancelled = 0;
      if (activeCount > 0) {
        const result = await tx.assignments.updateMany({
          where: {
            organization_id: organizationId,
            employee_id: employeeId,
            state: { in: [...ACTIVE_ASSIGNMENT_STATES] },
          },
          data: {
            state: 'cancelled',
            cancelled_at: new Date(),
            cancel_reason: 'Сотрудник переведён в архив',
            // Поколение данных растёт: фоновые задания старого поколения
            // не смогут сохранить результат после отмены.
            data_generation: { increment: 1 },
          },
        });
        cancelled = result.count;

        await tx.invitations.updateMany({
          where: {
            organization_id: organizationId,
            revoked_at: null,
            assignments: { employee_id: employeeId },
          },
          data: { revoked_at: new Date() },
        });
        await tx.participant_sessions.updateMany({
          where: {
            organization_id: organizationId,
            revoked_at: null,
            assignments: { employee_id: employeeId },
          },
          data: { revoked_at: new Date() },
        });
      }

      await tx.employees.update({
        where: { id: employeeId },
        data: { archived_at: new Date(), revision: { increment: 1 } },
      });

      await this.audit.recordIn(tx, {
        action: 'employee.archived',
        outcome: 'success',
        organizationId,
        resourceType: 'employee',
        resourceId: employeeId,
        metadata: { cancelledAssignments: cancelled },
      });

      return { archived: true, cancelledAssignments: cancelled };
    });
  }

  /** Пакетное архивирование: результат возвращается по каждому элементу. */
  async bulkArchive(
    organizationId: string,
    employeeIds: readonly string[],
    cancelActiveAssignments: boolean,
  ): Promise<BatchResult> {
    const items: BatchResult['items'] = [];

    for (const employeeId of employeeIds) {
      try {
        const result = await this.archive(organizationId, employeeId, cancelActiveAssignments);
        items.push({
          id: employeeId,
          status: 'updated',
          message:
            result.cancelledAssignments > 0
              ? `Отменено оценок: ${result.cancelledAssignments}`
              : undefined,
        });
      } catch (error) {
        items.push({
          id: employeeId,
          status: 'failed',
          message: error instanceof AppError ? error.message : 'Не удалось архивировать',
        });
      }
    }

    const succeeded = items.filter((item) => item.status !== 'failed').length;
    return {
      outcome:
        succeeded === items.length ? 'all_succeeded' : succeeded === 0 ? 'all_failed' : 'partial',
      items,
    };
  }

  async timeline(organizationId: string, employeeId: string): Promise<EmployeeTimelineEntry[]> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const assignments = await tx.assignments.findMany({
        where: { organization_id: organizationId, employee_id: employeeId },
        select: {
          id: true,
          created_at: true,
          cancelled_at: true,
          completed_at: true,
          state: true,
          scenario_versions: { select: { scenario: { select: { title: true } } } },
        },
        orderBy: { created_at: 'desc' },
        take: 100,
      });

      const entries: EmployeeTimelineEntry[] = [];
      for (const assignment of assignments) {
        const scenarioTitle = assignment.scenario_versions.scenario.title;
        entries.push({
          id: `${assignment.id}:created`,
          occurredAt: assignment.created_at.toISOString(),
          kind: 'assignment_created',
          title: `Назначена оценка «${scenarioTitle}»`,
          resourceId: assignment.id,
        });
        if (assignment.completed_at) {
          entries.push({
            id: `${assignment.id}:completed`,
            occurredAt: assignment.completed_at.toISOString(),
            kind: 'assignment_completed',
            title: `Ответы получены по оценке «${scenarioTitle}»`,
            resourceId: assignment.id,
          });
        }
        if (assignment.cancelled_at) {
          entries.push({
            id: `${assignment.id}:cancelled`,
            occurredAt: assignment.cancelled_at.toISOString(),
            kind: 'assignment_cancelled',
            title: `Оценка «${scenarioTitle}» отменена`,
            resourceId: assignment.id,
          });
        }
      }

      const reports = await tx.reports.findMany({
        where: {
          organization_id: organizationId,
          status: 'published',
          assignments: { employee_id: employeeId },
        },
        select: { id: true, published_at: true },
        orderBy: { published_at: 'desc' },
        take: 50,
      });

      for (const report of reports) {
        if (report.published_at) {
          entries.push({
            id: `${report.id}:published`,
            occurredAt: report.published_at.toISOString(),
            kind: 'report_published',
            title: 'Опубликовано заключение',
            resourceId: report.id,
          });
        }
      }

      return entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    });
  }

  private async assertEmployeeLimit(tx: TenantTransaction, organizationId: string): Promise<void> {
    // Блокировка строки организации: одновременные добавления не обойдут лимит.
    const [org] = await tx.$queryRaw<Array<{ active_employee_limit: number }>>`
      select active_employee_limit from core.organizations
      where id = ${organizationId}::uuid for update
    `;

    const limit = org?.active_employee_limit ?? DEFAULT_ACTIVE_EMPLOYEE_LIMIT;
    const active = await tx.employees.count({
      where: { organization_id: organizationId, archived_at: null },
    });

    if (active >= limit) {
      throw AppError.businessRule(
        `Достигнут лимит активных сотрудников для этой организации: ${limit}.`,
      );
    }
  }

  private async assertExternalCodeFree(
    tx: TenantTransaction,
    organizationId: string,
    externalCode: string | undefined,
  ): Promise<void> {
    if (!externalCode) {
      return;
    }
    const existing = await tx.employees.findFirst({
      where: { organization_id: organizationId, external_code: externalCode },
      select: { id: true },
    });
    if (existing) {
      throw AppError.validation(
        [{ field: 'externalCode', message: 'Такой внутренний код уже используется' }],
        'Внутренний код должен быть уникальным в организации',
      );
    }
  }
}

const employeeSelect = {
  id: true,
  display_name: true,
  external_code: true,
  job_title: true,
  department: true,
  archived_at: true,
  updated_at: true,
} as const;

type EmployeeRow = {
  id: string;
  display_name: string | null;
  external_code: string | null;
  job_title: string | null;
  department: string | null;
  archived_at: Date | null;
  updated_at: Date;
};

function toSummary(row: EmployeeRow, activeAssignments: number): EmployeeSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    externalCode: row.external_code,
    jobTitle: row.job_title,
    department: row.department,
    archivedAt: row.archived_at?.toISOString() ?? null,
    activeAssignments,
    updatedAt: row.updated_at.toISOString(),
  };
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildWhere(organizationId: string, query: EmployeeListQuery) {
  return {
    organization_id: organizationId,
    ...(query.status === 'active'
      ? { archived_at: null }
      : query.status === 'archived'
        ? { archived_at: { not: null } }
        : {}),
    ...(query.department ? { department: query.department } : {}),
    ...(query.query
      ? {
          OR: [
            { display_name: { contains: query.query, mode: 'insensitive' as const } },
            { external_code: { contains: query.query, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

/** Сортировка только по разрешённым полям: произвольное поле в ORM не попадает. */
function orderByFor(query: EmployeeListQuery) {
  const direction = query.order;
  switch (query.sort) {
    case 'createdAt':
      return [{ created_at: direction }, { id: direction }];
    case 'name':
      return [{ display_name: direction }, { id: direction }];
    case 'updatedAt':
    default:
      return [{ updated_at: direction }, { id: direction }];
  }
}

async function activeAssignmentCounts(
  tx: TenantTransaction,
  organizationId: string,
  employeeIds: readonly string[],
): Promise<Map<string, number>> {
  if (employeeIds.length === 0) {
    return new Map();
  }
  const grouped = await tx.assignments.groupBy({
    by: ['employee_id'],
    where: {
      organization_id: organizationId,
      employee_id: { in: [...employeeIds] },
      state: { in: [...ACTIVE_ASSIGNMENT_STATES] },
    },
    _count: { _all: true },
  });
  return new Map(grouped.map((row) => [row.employee_id, row._count._all]));
}

export { ACTIVE_ASSIGNMENT_STATES, ASSIGNMENT_STATE_LABELS };
