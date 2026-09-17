import { Injectable } from '@nestjs/common';

import type {
  MemberSummary,
  OrganizationSummary,
  ReadinessSummary,
  UpdateOrganizationRequest,
} from '@context/contracts';
import type { TenantTransaction } from '@context/database';
import {
  DEFAULT_MANAGER_PERMISSIONS,
  READINESS_CHECK_KEYS,
  READINESS_CHECK_LABELS,
  canRunInMode,
  findStudyRoleConflict,
  isOrgPermission,
  type OrgPermission,
  type OrganizationMode,
  type ReadinessCheckKey,
  type ReadinessState,
} from '@context/domain';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(organizationId: string): Promise<OrganizationSummary> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const row = await tx.organizations.findUniqueOrThrow({
        where: { id: organizationId },
        select: {
          id: true,
          code: true,
          name: true,
          timezone: true,
          mode: true,
          status: true,
          participant_contact: true,
          active_employee_limit: true,
        },
      });
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        timezone: row.timezone,
        mode: row.mode as OrganizationMode,
        status: row.status as 'active' | 'suspended',
        participantContact: row.participant_contact,
        activeEmployeeLimit: row.active_employee_limit,
      };
    });
  }

  /**
   * Изменения настроек видны будущим назначениям. Уже зафиксированные
   * consent snapshots и контексты оценок не переписываются.
   */
  async update(
    organizationId: string,
    input: UpdateOrganizationRequest,
  ): Promise<OrganizationSummary> {
    await this.prisma.tenant({ organizationId }, async (tx) => {
      await tx.organizations.update({
        where: { id: organizationId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
          ...(input.participantContact === undefined
            ? {}
            : { participant_contact: input.participantContact }),
          revision: { increment: 1 },
        },
      });

      await this.audit.recordIn(tx, {
        action: 'organization.updated',
        outcome: 'success',
        organizationId,
        resourceType: 'organization',
        resourceId: organizationId,
        metadata: { fields: Object.keys(input).join(',') },
      });
    });

    return this.get(organizationId);
  }

  async listMembers(organizationId: string): Promise<MemberSummary[]> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const rows = await tx.memberships.findMany({
        where: { organization_id: organizationId, status: { not: 'revoked' } },
        select: {
          id: true,
          user_id: true,
          permissions: true,
          status: true,
          created_at: true,
          user: { select: { display_name: true, email_display: true } },
        },
        orderBy: { created_at: 'asc' },
      });

      return rows.map((row) => ({
        membershipId: row.id,
        userId: row.user_id,
        displayName: row.user.display_name,
        email: row.user.email_display,
        permissions: row.permissions.filter(isOrgPermission),
        status: row.status as MemberSummary['status'],
        invitedAt: row.created_at.toISOString(),
      }));
    });
  }

  /**
   * Приглашение руководителя. Ссылка активации возвращается один раз;
   * в P0 её передаёт владелец организации, система писем не отправляет.
   */
  async inviteMember(
    organizationId: string,
    input: { email: string; displayName: string; permissions: readonly OrgPermission[] },
  ): Promise<{ membershipId: string; userId: string; isNewUser: boolean }> {
    this.assertNoRoleConflict(input.permissions);

    return this.prisma.tenant({ organizationId }, async (tx) => {
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

      const existingMembership = await tx.memberships.findFirst({
        where: { organization_id: organizationId, user_id: user.id },
        select: { id: true, status: true },
      });

      if (existingMembership && existingMembership.status !== 'revoked') {
        throw AppError.conflict('Этот пользователь уже приглашён в организацию');
      }

      const membership = existingMembership
        ? await tx.memberships.update({
            where: { id: existingMembership.id },
            data: { permissions: [...input.permissions], status: 'invited' },
            select: { id: true },
          })
        : await tx.memberships.create({
            data: {
              organization_id: organizationId,
              user_id: user.id,
              permissions: [...input.permissions],
              status: user.status === 'active' ? 'active' : 'invited',
            },
            select: { id: true },
          });

      await this.audit.recordIn(tx, {
        action: 'membership.invited',
        outcome: 'success',
        organizationId,
        resourceType: 'membership',
        resourceId: membership.id,
        metadata: { permissions: input.permissions.join(','), newUser: existingUser === null },
      });

      return { membershipId: membership.id, userId: user.id, isNewUser: existingUser === null };
    });
  }

  async updateMemberPermissions(
    organizationId: string,
    membershipId: string,
    permissions: readonly OrgPermission[],
  ): Promise<MemberSummary[]> {
    this.assertNoRoleConflict(permissions);

    await this.prisma.tenant({ organizationId }, async (tx) => {
      const membership = await tx.memberships.findFirst({
        where: { id: membershipId, organization_id: organizationId },
        select: { id: true, permissions: true },
      });
      if (!membership) {
        throw AppError.notFound(`Доступ ${membershipId} не найден в организации`);
      }

      const losesOwnership =
        membership.permissions.includes('org.manage') && !permissions.includes('org.manage');
      if (losesOwnership) {
        await this.assertNotLastOwner(tx, organizationId, membershipId);
      }

      await tx.memberships.update({
        where: { id: membershipId },
        data: { permissions: [...permissions] },
      });

      await this.audit.recordIn(tx, {
        action: 'membership.permissions_changed',
        outcome: 'success',
        organizationId,
        resourceType: 'membership',
        resourceId: membershipId,
        metadata: { permissions: permissions.join(',') },
      });
    });

    return this.listMembers(organizationId);
  }

  async revokeMember(organizationId: string, membershipId: string): Promise<void> {
    await this.prisma.tenant({ organizationId }, async (tx) => {
      const membership = await tx.memberships.findFirst({
        where: { id: membershipId, organization_id: organizationId },
        select: { id: true, user_id: true, permissions: true, status: true },
      });
      if (!membership || membership.status === 'revoked') {
        throw AppError.notFound(`Доступ ${membershipId} не найден в организации`);
      }

      if (membership.permissions.includes('org.manage')) {
        await this.assertNotLastOwner(tx, organizationId, membershipId);
      }

      await tx.memberships.update({
        where: { id: membershipId },
        data: { status: 'revoked', permissions: [] },
      });

      // Отзыв членства немедленно закрывает текущие сессии пользователя
      // в этой организации (ТЗ 01.1).
      await tx.user_sessions.updateMany({
        where: { user_id: membership.user_id, revoked_at: null },
        data: { revoked_at: new Date() },
      });

      await this.audit.recordIn(tx, {
        action: 'membership.revoked',
        outcome: 'success',
        organizationId,
        resourceType: 'membership',
        resourceId: membershipId,
      });
    });
  }

  async readiness(organizationId: string): Promise<ReadinessSummary> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const org = await tx.organizations.findUniqueOrThrow({
        where: { id: organizationId },
        select: { mode: true },
      });

      const rows = await tx.readiness_checks.findMany({
        where: { organization_id: organizationId },
        select: { check_key: true, state: true, verified_at: true, note: true },
      });

      const byKey = new Map(rows.map((row) => [row.check_key, row]));
      const checks = READINESS_CHECK_KEYS.map((key) => {
        const row = byKey.get(key);
        return {
          key,
          label: READINESS_CHECK_LABELS[key],
          state: (row?.state ?? 'pending') as ReadinessState,
          verifiedAt: row?.verified_at?.toISOString() ?? null,
          note: row?.note ?? null,
        };
      });

      const states = Object.fromEntries(checks.map((check) => [check.key, check.state])) as Partial<
        Record<ReadinessCheckKey, ReadinessState>
      >;

      const mode = org.mode as OrganizationMode;
      const verdict = canRunInMode(mode, states);

      return {
        mode,
        canRunRealAssessments: mode !== 'demo' && verdict.allowed,
        blockedReasons: verdict.missing.map((key) => READINESS_CHECK_LABELS[key]),
        checks,
      };
    });
  }

  /**
   * Нельзя оставить организацию без владельца: иначе управлять доступами
   * станет некому и потребуется вмешательство администратора платформы.
   */
  private async assertNotLastOwner(
    tx: TenantTransaction,
    organizationId: string,
    excludedMembershipId: string,
  ): Promise<void> {
    const owners = await tx.memberships.count({
      where: {
        organization_id: organizationId,
        status: 'active',
        permissions: { has: 'org.manage' },
        id: { not: excludedMembershipId },
      },
    });

    if (owners === 0) {
      throw AppError.conflict(
        'Это последний владелец организации. Сначала назначьте другого владельца.',
      );
    }
  }

  /** Рецензент прогнозов не может одновременно вносить исходы исследования. */
  private assertNoRoleConflict(permissions: readonly OrgPermission[]): void {
    const conflict = findStudyRoleConflict(permissions);
    if (conflict) {
      throw AppError.businessRule(
        `Несовместимые роли в исследовании: «${conflict.a}» и «${conflict.b}» нельзя выдать одному человеку.`,
      );
    }
  }
}

export { DEFAULT_MANAGER_PERMISSIONS };
