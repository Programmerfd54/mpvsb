import { Injectable } from '@nestjs/common';

import type { AdminWorkspace, UpdateAdminWorkspace } from '@context/contracts';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';

@Injectable()
export class AdminWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<AdminWorkspace> {
    return this.prisma.platformOps(async (tx) => {
      const workspace = await tx.workspace_state.findUnique({
        where: { singleton: true },
        select: { organization_id: true },
      });
      if (!workspace) {
        throw AppError.notFound('Основное пространство не создано. Выполните db:bootstrap.');
      }

      const organization = await tx.organizations.findUnique({
        where: { id: workspace.organization_id },
        select: {
          id: true,
          name: true,
          logo_url: true,
          revision: true,
          setup_completed_at: true,
          _count: { select: { memberships: true, employees: true } },
        },
      });
      if (!organization) {
        throw AppError.notFound('Основная организация пространства не найдена.');
      }

      const [departmentCount, mail, template] = await Promise.all([
        tx.departments.count({ where: { organization_id: organization.id, status: 'active' } }),
        tx.workspace_mail_settings.findUnique({
          where: { organization_id: organization.id },
          select: { password_encrypted: true },
        }),
        tx.workspace_mail_templates.findUnique({
          where: { organization_id: organization.id },
          select: { status: true },
        }),
      ]);

      return {
        organizationId: organization.id,
        name: organization.name,
        logoUrl: organization.logo_url,
        revision: organization.revision,
        setupCompletedAt: organization.setup_completed_at?.toISOString() ?? null,
        steps: [
          { key: 'company', status: organization.name.trim().length >= 2 ? 'complete' : 'pending' },
          { key: 'mail', status: mail?.password_encrypted ? 'complete' : 'pending' },
          { key: 'mail_template', status: template?.status === 'published' ? 'complete' : 'pending' },
          { key: 'departments', status: departmentCount > 0 ? 'complete' : 'pending' },
          {
            key: 'users',
            status:
              organization._count.memberships + organization._count.employees > 0
                ? 'complete'
                : 'pending',
          },
          { key: 'review', status: organization.setup_completed_at ? 'complete' : 'pending' },
        ],
      };
    });
  }

  async update(input: UpdateAdminWorkspace): Promise<AdminWorkspace> {
    await this.prisma.platformOps(async (tx) => {
      const workspace = await tx.workspace_state.findUnique({
        where: { singleton: true },
        select: { organization_id: true },
      });
      if (!workspace) {
        throw AppError.notFound('Основное пространство не создано. Выполните db:bootstrap.');
      }

      const updated = await tx.organizations.updateMany({
        where: { id: workspace.organization_id, revision: input.expectedRevision },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.logoUrl === undefined ? {} : { logo_url: input.logoUrl }),
          revision: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        const exists = await tx.organizations.count({ where: { id: workspace.organization_id } });
        if (exists === 0) {
          throw AppError.notFound('Основная организация пространства не найдена.');
        }
        throw AppError.revisionConflict();
      }

      await this.audit.recordIn(tx, {
        action: 'workspace.company_updated',
        outcome: 'success',
        organizationId: workspace.organization_id,
        resourceType: 'organization',
        resourceId: workspace.organization_id,
        metadata: {
          nameChanged: input.name !== undefined,
          logoChanged: input.logoUrl !== undefined,
        },
      });
    });

    return this.get();
  }
}
