import { Injectable } from '@nestjs/common';

import type { DashboardSummary } from '@context/contracts';
import { ASSIGNMENT_STATE_LABELS, type AssignmentState } from '@context/domain';

import { PrismaService } from '../../platform/database/prisma.service';

/** Горизонт «скоро истекает» для блока внимания. */
const EXPIRING_SOON_DAYS = 3;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Сводка обзорной страницы.
   *
   * Все числа — реальные количества из тех же выборок, что и списки: карточка
   * и страница списка не должны показывать разное (ТЗ M02).
   */
  async summary(organizationId: string): Promise<DashboardSummary> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const now = new Date();
      const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 86_400_000);

      const [activeAssignments, awaitingStart, inProcessing, newReports] = await Promise.all([
        tx.assignments.count({
          where: { organization_id: organizationId, state: { in: ['invited', 'in_progress'] } },
        }),
        tx.assignments.count({ where: { organization_id: organizationId, state: 'invited' } }),
        tx.reports.count({
          where: {
            organization_id: organizationId,
            status: { in: ['queued', 'generating', 'pending_review', 'revision_requested'] },
          },
        }),
        tx.reports.count({ where: { organization_id: organizationId, status: 'published' } }),
      ]);

      const expiring = await tx.assignments.findMany({
        where: {
          organization_id: organizationId,
          state: { in: ['invited', 'in_progress'] },
          due_at: { gte: now, lte: soon },
        },
        orderBy: { due_at: 'asc' },
        take: 5,
        select: {
          id: true,
          due_at: true,
          employees: { select: { display_name: true, external_code: true } },
        },
      });

      const readyReports = await tx.reports.findMany({
        where: { organization_id: organizationId, status: 'published' },
        orderBy: { published_at: 'desc' },
        take: 5,
        select: {
          id: true,
          published_at: true,
          assignments: {
            select: {
              id: true,
              employees: { select: { display_name: true, external_code: true } },
            },
          },
        },
      });

      const failed = await tx.reports.findMany({
        where: { organization_id: organizationId, status: 'generation_failed' },
        orderBy: { updated_at: 'desc' },
        take: 3,
        select: { id: true, updated_at: true, assignment_id: true },
      });

      const attention: DashboardSummary['attention'] = [
        ...expiring.map((item) => ({
          kind: 'expiring_soon' as const,
          title: `Срок ссылки скоро истечёт: ${label(item.employees)}`,
          assignmentId: item.id,
          reportId: null,
          occurredAt: (item.due_at ?? now).toISOString(),
        })),
        ...readyReports.map((item) => ({
          kind: 'report_ready' as const,
          title: `Заключение готово: ${label(item.assignments.employees)}`,
          assignmentId: item.assignments.id,
          reportId: item.id,
          occurredAt: (item.published_at ?? now).toISOString(),
        })),
        ...failed.map((item) => ({
          kind: 'generation_failed' as const,
          // Пользователю сообщается факт задержки, без технических подробностей.
          title: 'Подготовка заключения задерживается',
          assignmentId: item.assignment_id,
          reportId: item.id,
          occurredAt: item.updated_at.toISOString(),
        })),
      ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

      const recent = await tx.assignments.findMany({
        where: { organization_id: organizationId },
        orderBy: { updated_at: 'desc' },
        take: 8,
        select: {
          id: true,
          state: true,
          updated_at: true,
          employees: { select: { display_name: true, external_code: true } },
          scenario_versions: { select: { scenario: { select: { title: true } } } },
        },
      });

      return {
        activeAssignments,
        awaitingStart,
        inProcessing,
        newReports,
        attention: attention.slice(0, 8),
        recentAssessments: recent.map((item) => ({
          assignmentId: item.id,
          employeeLabel: label(item.employees),
          scenarioTitle: item.scenario_versions.scenario.title,
          state: item.state,
          stateLabel: ASSIGNMENT_STATE_LABELS[item.state as AssignmentState],
          updatedAt: item.updated_at.toISOString(),
        })),
        generatedAt: now.toISOString(),
      };
    });
  }
}

function label(employee: { display_name: string | null; external_code: string | null }): string {
  return employee.display_name ?? employee.external_code ?? 'Без имени';
}
