import { Injectable } from '@nestjs/common';

import type {
  AdminDepartment,
  AdminDepartmentDetail,
  AdminDepartmentListQuery,
  CreateAdminDepartment,
  TransferEmployee,
  TransferEmployeeResult,
  UpdateAdminDepartment,
} from '@context/contracts';
import type { TenantTransaction } from '@context/database';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';

@Injectable()
export class AdminDepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminDepartmentListQuery): Promise<AdminDepartment[]> {
    return this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const rows = await tx.departments.findMany({
        where: {
          organization_id: organizationId,
          ...(query.status === 'all' ? {} : { status: query.status }),
          ...(query.query ? { name: { contains: query.query, mode: 'insensitive' as const } } : {}),
        },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      });

      return Promise.all(rows.map((row) => this.summary(tx, row)));
    });
  }

  async get(departmentId: string): Promise<AdminDepartmentDetail> {
    return this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const row = await tx.departments.findFirst({
        where: { id: departmentId, organization_id: organizationId },
      });
      if (!row) throw AppError.notFound(`Подразделение ${departmentId} недоступно`);

      const [base, managerRows, employees, memberships] = await Promise.all([
        this.summary(tx, row),
        tx.department_managers.findMany({
          where: { organization_id: organizationId, department_id: departmentId, revoked_at: null },
          orderBy: { assigned_at: 'asc' },
        }),
        tx.employees.findMany({
          where: { organization_id: organizationId, department_id: departmentId },
          orderBy: [{ archived_at: 'asc' }, { display_name: 'asc' }],
          select: {
            id: true,
            display_name: true,
            job_title: true,
            archived_at: true,
            revision: true,
          },
        }),
        tx.memberships.findMany({
          where: { organization_id: organizationId, status: { in: ['invited', 'active'] } },
          select: { user_id: true, status: true },
        }),
      ]);
      const users = await tx.users.findMany({
        where: {
          id: {
            in: [...new Set([...managerRows, ...memberships].map((item) => item.user_id))],
          },
        },
        select: { id: true, display_name: true },
      });
      const names = new Map(users.map((item) => [item.id, item.display_name]));

      return {
        ...base,
        managers: managerRows.map((item) => ({
          userId: item.user_id,
          displayName: names.get(item.user_id) ?? 'Пользователь недоступен',
          assignedAt: item.assigned_at.toISOString(),
        })),
        employees: employees.map((item) => ({
          employeeId: item.id,
          displayName: item.display_name,
          jobTitle: item.job_title,
          archived: item.archived_at !== null,
          revision: item.revision,
        })),
        availableManagers: memberships
          .filter((item) => !managerRows.some((manager) => manager.user_id === item.user_id))
          .map((item) => ({
            userId: item.user_id,
            displayName: names.get(item.user_id) ?? 'Пользователь недоступен',
            membershipStatus: item.status as 'invited' | 'active',
          })),
      };
    });
  }

  async create(input: CreateAdminDepartment): Promise<AdminDepartmentDetail> {
    const id = await this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      await this.assertNameFree(tx, organizationId, input.name);
      const created = await tx.departments.create({
        data: { organization_id: organizationId, name: input.name },
        select: { id: true },
      });
      await this.audit.recordIn(tx, {
        action: 'department.created',
        outcome: 'success',
        organizationId,
        resourceType: 'department',
        resourceId: created.id,
      });
      return created.id;
    });
    return this.get(id);
  }

  async update(departmentId: string, input: UpdateAdminDepartment): Promise<AdminDepartmentDetail> {
    await this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      await this.assertNameFree(tx, organizationId, input.name, departmentId);
      const result = await tx.departments.updateMany({
        where: {
          id: departmentId,
          organization_id: organizationId,
          revision: input.expectedRevision,
        },
        data: { name: input.name, revision: { increment: 1 } },
      });
      await this.assertMutationResult(tx, organizationId, departmentId, result.count);
      await this.audit.recordIn(tx, {
        action: 'department.renamed',
        outcome: 'success',
        organizationId,
        resourceType: 'department',
        resourceId: departmentId,
      });
    });
    return this.get(departmentId);
  }

  async archive(departmentId: string, expectedRevision: number): Promise<AdminDepartmentDetail> {
    await this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const [employees, managers] = await Promise.all([
        tx.employees.count({
          where: {
            organization_id: organizationId,
            department_id: departmentId,
            archived_at: null,
          },
        }),
        tx.department_managers.count({
          where: { organization_id: organizationId, department_id: departmentId, revoked_at: null },
        }),
      ]);
      if (employees > 0 || managers > 0) {
        throw AppError.businessRule(
          `Сначала переведите сотрудников (${employees}) и отзовите назначения руководителей (${managers}).`,
        );
      }
      const result = await tx.departments.updateMany({
        where: {
          id: departmentId,
          organization_id: organizationId,
          revision: expectedRevision,
          status: 'active',
        },
        data: { status: 'archived', archived_at: new Date(), revision: { increment: 1 } },
      });
      await this.assertMutationResult(tx, organizationId, departmentId, result.count);
      await this.audit.recordIn(tx, {
        action: 'department.archived',
        outcome: 'success',
        organizationId,
        resourceType: 'department',
        resourceId: departmentId,
      });
    });
    return this.get(departmentId);
  }

  async assignManager(departmentId: string, userId: string): Promise<AdminDepartmentDetail> {
    await this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const [department, membership] = await Promise.all([
        tx.departments.findFirst({
          where: { id: departmentId, organization_id: organizationId, status: 'active' },
          select: { id: true },
        }),
        tx.memberships.findFirst({
          where: {
            organization_id: organizationId,
            user_id: userId,
            status: { in: ['invited', 'active'] },
          },
          select: { id: true },
        }),
      ]);
      if (!department) throw AppError.notFound(`Подразделение ${departmentId} недоступно`);
      if (!membership) {
        throw AppError.validation(
          [{ field: 'userId', message: 'Пользователь не состоит в этой организации' }],
          'Руководитель недоступен',
        );
      }
      const existing = await tx.department_managers.findFirst({
        where: { organization_id: organizationId, department_id: departmentId, user_id: userId },
        orderBy: { assigned_at: 'desc' },
      });
      if (existing?.revoked_at === null) {
        throw AppError.conflict('Пользователь уже руководит этим подразделением');
      }
      if (existing) {
        await tx.department_managers.update({
          where: { id: existing.id },
          data: { revoked_at: null, assigned_at: new Date() },
        });
      } else {
        await tx.department_managers.create({
          data: { organization_id: organizationId, department_id: departmentId, user_id: userId },
        });
      }
      await this.audit.recordIn(tx, {
        action: 'department.manager_assigned',
        outcome: 'success',
        organizationId,
        resourceType: 'department',
        resourceId: departmentId,
      });
    });
    return this.get(departmentId);
  }

  async revokeManager(departmentId: string, userId: string): Promise<AdminDepartmentDetail> {
    await this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const result = await tx.department_managers.updateMany({
        where: {
          organization_id: organizationId,
          department_id: departmentId,
          user_id: userId,
          revoked_at: null,
        },
        data: { revoked_at: new Date() },
      });
      if (result.count === 0) {
        throw AppError.notFound('Активное назначение руководителя не найдено');
      }
      await this.audit.recordIn(tx, {
        action: 'department.manager_revoked',
        outcome: 'success',
        organizationId,
        resourceType: 'department',
        resourceId: departmentId,
      });
    });
    return this.get(departmentId);
  }

  async transferEmployee(
    sourceDepartmentId: string,
    employeeId: string,
    actorUserId: string,
    input: TransferEmployee,
  ): Promise<TransferEmployeeResult> {
    const organizationId = await this.prisma.platformOps((tx) => this.organizationId(tx));

    return this.prisma.tenant({ organizationId }, async (tx) => {
      const [employee, target] = await Promise.all([
        tx.employees.findFirst({
          where: {
            id: employeeId,
            organization_id: organizationId,
            department_id: sourceDepartmentId,
          },
          select: { id: true, revision: true, department_id: true },
        }),
        tx.departments.findFirst({
          where: {
            id: input.targetDepartmentId,
            organization_id: organizationId,
            status: 'active',
          },
          select: { id: true, name: true },
        }),
      ]);
      if (!employee) throw AppError.notFound(`Сотрудник ${employeeId} недоступен`);
      if (!target) {
        throw AppError.validation([
          { field: 'targetDepartmentId', message: 'Целевое подразделение недоступно' },
        ]);
      }
      if (target.id === sourceDepartmentId) {
        throw AppError.validation([
          { field: 'targetDepartmentId', message: 'Выберите другое подразделение' },
        ]);
      }
      if (employee.revision !== input.expectedEmployeeRevision) {
        throw AppError.revisionConflict('Карточка сотрудника изменилась. Обновите данные.');
      }

      let cancelledAssignments = 0;
      if (input.activeAssignmentsAction === 'cancel') {
        const cancelled = await tx.assignments.updateMany({
          where: {
            organization_id: organizationId,
            employee_id: employeeId,
            state: { in: ['draft', 'invited', 'in_progress'] },
          },
          data: {
            state: 'cancelled',
            cancelled_at: new Date(),
            cancel_reason: 'Перевод сотрудника в другое подразделение',
            data_generation: { increment: 1 },
          },
        });
        cancelledAssignments = cancelled.count;
        await tx.invitations.updateMany({
          where: {
            organization_id: organizationId,
            revoked_at: null,
            assignments: { employee_id: employeeId, state: 'cancelled' },
          },
          data: { revoked_at: new Date() },
        });
        await tx.participant_sessions.updateMany({
          where: {
            organization_id: organizationId,
            revoked_at: null,
            assignments: { employee_id: employeeId, state: 'cancelled' },
          },
          data: { revoked_at: new Date() },
        });
      }

      const result = await tx.employees.updateMany({
        where: { id: employeeId, organization_id: organizationId, revision: employee.revision },
        data: {
          department_id: target.id,
          department: target.name,
          revision: { increment: 1 },
        },
      });
      if (result.count === 0) throw AppError.revisionConflict();

      await tx.employee_department_history.create({
        data: {
          organization_id: organizationId,
          employee_id: employeeId,
          from_department_id: sourceDepartmentId,
          to_department_id: target.id,
          transferred_by: actorUserId,
          reason: input.reason,
        },
      });
      await this.audit.recordIn(tx, {
        action: 'employee.department_transferred',
        outcome: 'success',
        organizationId,
        resourceType: 'employee',
        resourceId: employeeId,
        metadata: { cancelledAssignments },
      });

      return {
        employeeId,
        sourceDepartmentId,
        targetDepartmentId: target.id,
        cancelledAssignments,
        employeeRevision: employee.revision + 1,
      };
    });
  }

  private async organizationId(tx: TenantTransaction): Promise<string> {
    const workspace = await tx.workspace_state.findUnique({
      where: { singleton: true },
      select: { organization_id: true },
    });
    if (!workspace) throw AppError.notFound('Основное пространство не создано.');
    return workspace.organization_id;
  }

  private async summary(
    tx: TenantTransaction,
    row: {
      id: string;
      organization_id: string;
      name: string;
      status: string;
      revision: number;
      created_at: Date;
    },
  ): Promise<AdminDepartment> {
    const [employeeCount, managerCount] = await Promise.all([
      tx.employees.count({
        where: { organization_id: row.organization_id, department_id: row.id, archived_at: null },
      }),
      tx.department_managers.count({
        where: { organization_id: row.organization_id, department_id: row.id, revoked_at: null },
      }),
    ]);
    return {
      id: row.id,
      name: row.name,
      status: row.status as 'active' | 'archived',
      employeeCount,
      managerCount,
      revision: row.revision,
      createdAt: row.created_at.toISOString(),
    };
  }

  private async assertNameFree(
    tx: TenantTransaction,
    organizationId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const duplicate = await tx.departments.findFirst({
      where: {
        organization_id: organizationId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw AppError.validation(
        [{ field: 'name', message: 'Подразделение с таким названием уже существует' }],
        'Название должно быть уникальным',
      );
    }
  }

  private async assertMutationResult(
    tx: TenantTransaction,
    organizationId: string,
    departmentId: string,
    count: number,
  ): Promise<void> {
    if (count > 0) return;
    const exists = await tx.departments.count({
      where: { id: departmentId, organization_id: organizationId },
    });
    if (exists === 0) throw AppError.notFound(`Подразделение ${departmentId} недоступно`);
    throw AppError.revisionConflict();
  }
}
