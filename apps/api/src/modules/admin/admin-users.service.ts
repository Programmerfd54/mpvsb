import { Injectable } from '@nestjs/common';

import type { AdminUser, InviteAdminUser } from '@context/contracts';
import type { TenantTransaction } from '@context/database';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';

const MANAGER_PERMISSIONS = ['employees.manage', 'assessments.manage', 'reports.read'] as const;
const REVIEWER_PERMISSIONS = ['reports.read', 'reports.review'] as const;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AdminUser[]> {
    return this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const [memberships, employees, departments, managerLinks] = await Promise.all([
        tx.memberships.findMany({
          where: { organization_id: organizationId, status: { not: 'revoked' } },
          select: {
            user_id: true,
            permissions: true,
            status: true,
            user: {
              select: {
                display_name: true,
                email_display: true,
                status: true,
                user_sessions: {
                  where: { revoked_at: null },
                  orderBy: { last_seen_at: 'desc' },
                  take: 1,
                  select: { last_seen_at: true },
                },
              },
            },
          },
          orderBy: { created_at: 'asc' },
        }),
        tx.employees.findMany({
          where: { organization_id: organizationId, archived_at: null },
          select: {
            id: true,
            user_id: true,
            display_name: true,
            job_title: true,
            email: true,
            department_id: true,
          },
          orderBy: { display_name: 'asc' },
        }),
        tx.departments.findMany({
          where: { organization_id: organizationId },
          select: { id: true, name: true },
        }),
        tx.department_managers.findMany({
          where: { organization_id: organizationId, revoked_at: null },
          select: { user_id: true, department_id: true },
        }),
      ]);
      const departmentNames = new Map(departments.map((item) => [item.id, item.name]));
      const linkedEmployeeByUser = new Map(
        employees.filter((item) => item.user_id).map((item) => [item.user_id!, item]),
      );
      const membershipUserIds = new Set(memberships.map((item) => item.user_id));
      const employeeUserIds = employees
        .map((item) => item.user_id)
        .filter((item): item is string => item !== null && !membershipUserIds.has(item));
      const employeeAccounts = await tx.users.findMany({
        where: { id: { in: employeeUserIds } },
        select: {
          id: true,
          display_name: true,
          email_display: true,
          status: true,
          user_sessions: {
            where: { revoked_at: null },
            orderBy: { last_seen_at: 'desc' },
            take: 1,
            select: { last_seen_at: true },
          },
        },
      });
      const employeeAccountById = new Map(employeeAccounts.map((item) => [item.id, item]));

      const users = memberships.map((membership): AdminUser => {
        const employee = linkedEmployeeByUser.get(membership.user_id);
        const departmentIds = managerLinks
          .filter((link) => link.user_id === membership.user_id)
          .map((link) => link.department_id);
        return {
          userId: membership.user_id,
          employeeId: employee?.id ?? null,
          displayName: membership.user.display_name,
          jobTitle: employee?.job_title ?? null,
          email: membership.user.email_display,
          role: membership.permissions.includes('reports.review') ? 'reviewer' : 'manager',
          departments: departmentIds.map((id) => ({
            id,
            name: departmentNames.get(id) ?? 'Подразделение недоступно',
          })),
          deliveryStatus: 'unavailable',
          activationStatus:
            membership.user.status === 'disabled'
              ? 'blocked'
              : membership.user.status === 'active'
                ? 'activated'
                : 'pending',
          lastLoginAt: membership.user.user_sessions[0]?.last_seen_at.toISOString() ?? null,
        };
      });

      const employeeOnly = employees
        .filter((employee) => !employee.user_id || !membershipUserIds.has(employee.user_id))
        .map((employee): AdminUser => {
          const account = employee.user_id ? employeeAccountById.get(employee.user_id) : undefined;
          return {
            userId: employee.user_id,
            employeeId: employee.id,
            displayName:
              account?.display_name ?? employee.display_name ?? 'Сотрудник без отображаемого имени',
            jobTitle: employee.job_title,
            email: account?.email_display ?? employee.email,
            role: 'employee',
            departments: employee.department_id
              ? [
                  {
                    id: employee.department_id,
                    name: departmentNames.get(employee.department_id) ?? 'Подразделение недоступно',
                  },
                ]
              : [],
            deliveryStatus: 'unavailable',
            activationStatus:
              account?.status === 'disabled'
                ? 'blocked'
                : account?.status === 'active'
                  ? 'activated'
                  : 'pending',
            lastLoginAt: account?.user_sessions[0]?.last_seen_at.toISOString() ?? null,
          };
        });

      return [...users, ...employeeOnly];
    });
  }

  async invite(
    input: InviteAdminUser,
    actorUserId: string,
  ): Promise<{ userId: string; organizationId: string }> {
    return this.prisma.platformOps(async (tx) => {
      const organizationId = await this.organizationId(tx);
      const departments = await tx.departments.findMany({
        where: {
          organization_id: organizationId,
          id: { in: input.departmentIds },
          status: 'active',
        },
        select: { id: true },
      });
      if (departments.length !== new Set(input.departmentIds).size) {
        throw AppError.validation([
          { field: 'departmentIds', message: 'Одно из подразделений недоступно' },
        ]);
      }

      const existingUser = await tx.users.findUnique({
        where: { email_normalized: input.email },
        select: { id: true, status: true },
      });
      const user =
        existingUser ??
        (await tx.users.create({
          data: {
            email_normalized: input.email,
            email_display: input.email,
            display_name: input.displayName,
            status: 'invited',
          },
          select: { id: true, status: true },
        }));

      if (input.role === 'employee') {
        const managerMembership = await tx.memberships.findFirst({
          where: {
            organization_id: organizationId,
            user_id: user.id,
            status: { not: 'revoked' },
          },
          select: { id: true },
        });
        if (managerMembership) {
          throw AppError.conflict('Учётная запись уже используется руководителем или рецензентом');
        }
        const existingEmployee = await tx.employees.findFirst({
          where: {
            organization_id: organizationId,
            archived_at: null,
            OR: [{ user_id: user.id }, { user_id: null, email: input.email }],
          },
          select: { id: true, user_id: true },
        });
        if (existingEmployee?.user_id) {
          throw AppError.conflict('Для этой учётной записи уже создан сотрудник');
        }

        const employee = existingEmployee
          ? await tx.employees.update({
              where: { id: existingEmployee.id },
              data: {
                user_id: user.id,
                display_name: input.displayName,
                job_title: input.jobTitle ?? null,
                email: input.email,
                department_id: input.departmentIds[0]!,
                department: null,
                revision: { increment: 1 },
              },
              select: { id: true },
            })
          : await tx.employees.create({
              data: {
                organization_id: organizationId,
                user_id: user.id,
                display_name: input.displayName,
                job_title: input.jobTitle ?? null,
                email: input.email,
                department_id: input.departmentIds[0]!,
              },
              select: { id: true },
            });
        await tx.employee_department_history.create({
          data: {
            organization_id: organizationId,
            employee_id: employee.id,
            from_department_id: null,
            to_department_id: input.departmentIds[0]!,
            reason: 'Назначение подразделения при создании учётной записи',
            transferred_by: actorUserId,
          },
        });

        await this.audit.recordIn(tx, {
          action: 'workspace.user_invited',
          outcome: 'success',
          organizationId,
          resourceType: 'user',
          resourceId: user.id,
          metadata: { role: input.role, departmentCount: 1 },
        });
        return { userId: user.id, organizationId };
      }

      const existingMembership = await tx.memberships.findFirst({
        where: { organization_id: organizationId, user_id: user.id },
        select: { id: true, status: true },
      });
      if (existingMembership && existingMembership.status !== 'revoked') {
        throw AppError.conflict('Пользователь уже добавлен в пространство');
      }
      const linkedEmployee = await tx.employees.findFirst({
        where: { organization_id: organizationId, user_id: user.id, archived_at: null },
        select: { id: true },
      });
      if (linkedEmployee) {
        throw AppError.conflict('Учётная запись уже используется сотрудником');
      }
      const permissions =
        input.role === 'reviewer' ? [...REVIEWER_PERMISSIONS] : [...MANAGER_PERMISSIONS];
      if (existingMembership) {
        await tx.memberships.update({
          where: { id: existingMembership.id },
          data: { status: user.status === 'active' ? 'active' : 'invited', permissions },
        });
      } else {
        await tx.memberships.create({
          data: {
            organization_id: organizationId,
            user_id: user.id,
            role: 'manager',
            permissions,
            status: user.status === 'active' ? 'active' : 'invited',
            invited_by: actorUserId,
          },
        });
      }
      for (const department of departments) {
        const existing = await tx.department_managers.findFirst({
          where: {
            organization_id: organizationId,
            department_id: department.id,
            user_id: user.id,
          },
          orderBy: { assigned_at: 'desc' },
        });
        if (existing) {
          await tx.department_managers.update({
            where: { id: existing.id },
            data: { revoked_at: null, assigned_at: new Date(), assigned_by: actorUserId },
          });
        } else {
          await tx.department_managers.create({
            data: {
              organization_id: organizationId,
              department_id: department.id,
              user_id: user.id,
              assigned_by: actorUserId,
            },
          });
        }
      }
      await this.audit.recordIn(tx, {
        action: 'workspace.user_invited',
        outcome: 'success',
        organizationId,
        resourceType: 'user',
        resourceId: user.id,
        metadata: { role: input.role, departmentCount: departments.length },
      });
      return { userId: user.id, organizationId };
    });
  }

  async get(userId: string): Promise<AdminUser> {
    const user = (await this.list()).find((item) => item.userId === userId);
    if (!user) throw AppError.notFound(`Пользователь ${userId} недоступен`);
    return user;
  }

  private async organizationId(tx: TenantTransaction): Promise<string> {
    const workspace = await tx.workspace_state.findUnique({
      where: { singleton: true },
      select: { organization_id: true },
    });
    if (!workspace) throw AppError.notFound('Основное пространство не создано.');
    return workspace.organization_id;
  }
}
