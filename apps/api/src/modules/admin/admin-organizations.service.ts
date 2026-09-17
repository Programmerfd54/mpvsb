import { Injectable } from '@nestjs/common';

import type {
  AdminOrganization,
  CreateOrganizationInput,
  ReadinessCheck,
  UpdateReadinessInput,
} from '@context/contracts';
import type { TenantTransaction } from '@context/database';
import {
  OWNER_PERMISSIONS,
  READINESS_CHECK_KEYS,
  READINESS_CHECK_LABELS,
  type ApplicabilityMode,
  type ReadinessState,
} from '@context/domain';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';

const ACTIVE_ASSIGNMENT_STATES = ['draft', 'invited', 'in_progress'] as const;
const PENDING_REPORT_STATES = [
  'queued',
  'generating',
  'pending_review',
  'revision_requested',
] as const;

/**
 * Управление организациями со стороны платформы.
 *
 * Работа идёт в эксплуатационном режиме: администратор видит количества и
 * технические параметры, но не содержание оценок. Ответы участников и черновики
 * заключений остаются закрытыми строгой политикой RLS (ТЗ 01.2, 05).
 */
@Injectable()
export class AdminOrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AdminOrganization[]> {
    return this.prisma.platformOps(async (tx) => {
      const rows = await tx.organizations.findMany({
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          timezone: true,
          mode: true,
          status: true,
          active_employee_limit: true,
          created_at: true,
          _count: { select: { memberships: true } },
        },
      });

      const result: AdminOrganization[] = [];

      for (const row of rows) {
        // Счётчики считаются в контексте организации: тот же путь, что и у
        // обычных запросов, поэтому расхождения с кабинетом невозможны.
        const counts = await this.countsFor(row.id);
        const readiness = await this.readinessCounts(tx, row.id);

        result.push({
          id: row.id,
          code: row.code,
          name: row.name,
          timezone: row.timezone,
          mode: row.mode as ApplicabilityMode,
          status: row.status as 'active' | 'suspended',
          activeEmployeeLimit: row.active_employee_limit,
          counts: { managers: row._count.memberships, ...counts },
          readinessVerified: readiness.verified,
          readinessTotal: READINESS_CHECK_KEYS.length,
          createdAt: row.created_at.toISOString(),
        });
      }

      return result;
    });
  }

  async get(organizationId: string): Promise<AdminOrganization> {
    const all = await this.list();
    const found = all.find((item) => item.id === organizationId);
    if (!found) {
      throw AppError.notFound(`Организация ${organizationId} не найдена`);
    }
    return found;
  }

  /**
   * Создание организации.
   *
   * Новый tenant не получает права реального запуска автоматически: режим demo,
   * все пункты готовности открыты (ТЗ A02).
   */
  async create(
    input: CreateOrganizationInput,
    createdBy: string,
  ): Promise<{ organizationId: string; ownerUserId: string; ownerIsNew: boolean }> {
    return this.prisma.platformOps(async (tx) => {
      const existing = await tx.organizations.findUnique({
        where: { code: input.code },
        select: { id: true },
      });
      if (existing) {
        throw AppError.validation(
          [{ field: 'code', message: 'Организация с таким кодом уже существует' }],
          'Код организации должен быть уникальным',
        );
      }

      const organization = await tx.organizations.create({
        data: {
          name: input.name,
          code: input.code,
          timezone: input.timezone,
          active_employee_limit: input.activeEmployeeLimit,
          mode: 'demo',
          status: 'active',
        },
        select: { id: true },
      });

      const existingUser = await tx.users.findUnique({
        where: { email_normalized: input.ownerEmail },
        select: { id: true },
      });

      const owner =
        existingUser ??
        (await tx.users.create({
          data: {
            email_normalized: input.ownerEmail,
            email_display: input.ownerEmail,
            display_name: input.ownerName,
            status: 'invited',
          },
          select: { id: true },
        }));

      await tx.memberships.create({
        data: {
          organization_id: organization.id,
          user_id: owner.id,
          permissions: [...OWNER_PERMISSIONS],
          status: existingUser ? 'active' : 'invited',
          invited_by: createdBy,
        },
      });

      // Пункты готовности открыты: реальные оценки заблокированы до проверки.
      await tx.readiness_checks.createMany({
        data: READINESS_CHECK_KEYS.map((key) => ({
          organization_id: organization.id,
          check_key: key,
          state: 'pending',
        })),
      });

      await this.audit.recordIn(tx, {
        action: 'organization.created',
        outcome: 'success',
        organizationId: organization.id,
        resourceType: 'organization',
        resourceId: organization.id,
        metadata: { code: input.code, ownerIsNew: existingUser === null },
      });

      return {
        organizationId: organization.id,
        ownerUserId: owner.id,
        ownerIsNew: existingUser === null,
      };
    });
  }

  /**
   * Приостановка организации.
   *
   * Новые назначения становятся невозможны, но уже опубликованные заключения
   * остаются доступны на чтение: приостановка — не удаление данных.
   */
  async setStatus(
    organizationId: string,
    status: 'active' | 'suspended',
    reason: string | undefined,
  ): Promise<AdminOrganization> {
    await this.prisma.platformOps(async (tx) => {
      const organization = await tx.organizations.findUnique({
        where: { id: organizationId },
        select: { id: true, status: true },
      });
      if (!organization) {
        throw AppError.notFound(`Организация ${organizationId} не найдена`);
      }
      if (organization.status === status) {
        throw AppError.conflict(
          status === 'suspended' ? 'Организация уже приостановлена' : 'Организация уже активна',
        );
      }

      await tx.organizations.update({
        where: { id: organizationId },
        data: { status, revision: { increment: 1 } },
      });

      await this.audit.recordIn(tx, {
        action: status === 'suspended' ? 'organization.suspended' : 'organization.resumed',
        outcome: 'success',
        organizationId,
        resourceType: 'organization',
        resourceId: organizationId,
        metadata: { reason: reason ?? null },
      });
    });

    return this.get(organizationId);
  }

  async readiness(organizationId: string): Promise<ReadinessCheck[]> {
    return this.prisma.platformOps(async (tx) => {
      const rows = await tx.readiness_checks.findMany({
        where: { organization_id: organizationId },
        select: { check_key: true, state: true, verified_at: true, note: true },
      });
      const byKey = new Map(rows.map((row) => [row.check_key, row]));

      return READINESS_CHECK_KEYS.map((key) => {
        const row = byKey.get(key);
        return {
          key,
          label: READINESS_CHECK_LABELS[key],
          state: (row?.state ?? 'pending') as ReadinessState,
          verifiedAt: row?.verified_at?.toISOString() ?? null,
          note: row?.note ?? null,
        };
      });
    });
  }

  /**
   * Отметка пункта готовности.
   *
   * Отметка фиксирует, кто и когда её поставил. Она не заменяет правовую или
   * методическую оценку: это запись ответственного человека (ТЗ A03).
   */
  async updateReadiness(
    organizationId: string,
    input: UpdateReadinessInput,
    actorId: string,
  ): Promise<ReadinessCheck[]> {
    await this.prisma.platformOps(async (tx) => {
      const organization = await tx.organizations.findUnique({
        where: { id: organizationId },
        select: { id: true },
      });
      if (!organization) {
        throw AppError.notFound(`Организация ${organizationId} не найдена`);
      }

      const verified = input.state === 'verified';

      await tx.readiness_checks.upsert({
        where: {
          organization_id_check_key: { organization_id: organizationId, check_key: input.key },
        },
        create: {
          organization_id: organizationId,
          check_key: input.key,
          state: input.state,
          verified_by: verified ? actorId : null,
          verified_at: verified ? new Date() : null,
          note: input.note ?? null,
          evidence_ref: input.evidenceRef ?? null,
        },
        update: {
          state: input.state,
          verified_by: verified ? actorId : null,
          verified_at: verified ? new Date() : null,
          note: input.note ?? null,
          evidence_ref: input.evidenceRef ?? null,
        },
      });

      await this.audit.recordIn(tx, {
        action: 'organization.readiness_changed',
        outcome: 'success',
        organizationId,
        resourceType: 'readiness_check',
        metadata: { key: input.key, state: input.state },
      });
    });

    return this.readiness(organizationId);
  }

  private async countsFor(organizationId: string): Promise<{
    employees: number;
    activeAssignments: number;
    pendingReports: number;
  }> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const [employees, activeAssignments, pendingReports] = await Promise.all([
        tx.employees.count({ where: { organization_id: organizationId, archived_at: null } }),
        tx.assignments.count({
          where: { organization_id: organizationId, state: { in: [...ACTIVE_ASSIGNMENT_STATES] } },
        }),
        tx.reports.count({
          where: { organization_id: organizationId, status: { in: [...PENDING_REPORT_STATES] } },
        }),
      ]);
      return { employees, activeAssignments, pendingReports };
    });
  }

  private async readinessCounts(
    tx: TenantTransaction,
    organizationId: string,
  ): Promise<{ verified: number }> {
    const verified = await tx.readiness_checks.count({
      where: { organization_id: organizationId, state: { in: ['verified', 'not_applicable'] } },
    });
    return { verified };
  }
}
