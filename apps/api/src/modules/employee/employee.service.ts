import { Injectable } from '@nestjs/common';

import {
  methodPassportSchema,
  type EmployeeAssessment,
  type EmployeeAssessmentDetail,
  type EmployeeProfile,
} from '@context/contracts';

import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';
import type { RequestActor } from '../../platform/request/request-context';

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(actor: RequestActor): Promise<EmployeeProfile> {
    const { organizationId, employeeId } = employeeScope(actor);
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const employee = await tx.employees.findFirst({
        where: { id: employeeId, organization_id: organizationId, archived_at: null },
        select: {
          display_name: true,
          email: true,
          job_title: true,
          department_id: true,
          organizations: { select: { name: true, participant_contact: true } },
        },
      });
      if (!employee) throw AppError.notFound('Профиль сотрудника не найден');
      const department = employee.department_id
        ? await tx.departments.findFirst({
            where: { id: employee.department_id, organization_id: organizationId },
            select: { name: true },
          })
        : null;
      return {
        employeeId,
        displayName: employee.display_name ?? 'Сотрудник',
        email: employee.email,
        jobTitle: employee.job_title,
        departmentName: department?.name ?? null,
        organizationName: employee.organizations.name,
        organizationContact: employee.organizations.participant_contact,
      };
    });
  }

  async assessments(actor: RequestActor): Promise<EmployeeAssessment[]> {
    const { organizationId, employeeId } = employeeScope(actor);
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const rows = await tx.assignments.findMany({
        where: { organization_id: organizationId, employee_id: employeeId },
        orderBy: { created_at: 'desc' },
        select: assessmentSelect,
      });
      return rows.map(toAssessment);
    });
  }

  async assessment(actor: RequestActor, assignmentId: string): Promise<EmployeeAssessmentDetail> {
    const { organizationId, employeeId } = employeeScope(actor);
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const row = await tx.assignments.findFirst({
        where: { id: assignmentId, organization_id: organizationId, employee_id: employeeId },
        select: {
          ...assessmentSelect,
          mode: true,
          organizations: { select: { name: true, participant_contact: true } },
          scenario_versions: {
            select: { participant_visibility: true, scenario: { select: { title: true } } },
          },
          attempts: {
            orderBy: { order_index: 'asc' },
            select: {
              id: true,
              state: true,
              method_versions: { select: { passport_json: true, items_json: true } },
              answers: { select: { id: true } },
            },
          },
        },
      });
      if (!row) throw AppError.notFound('Оценка не найдена');
      return {
        ...toAssessment(row),
        organizationName: row.organizations.name,
        organizationContact: row.organizations.participant_contact,
        participantVisibility: row.scenario_versions
          .participant_visibility as EmployeeAssessmentDetail['participantVisibility'],
        mode: row.mode as EmployeeAssessmentDetail['mode'],
        stages: row.attempts.map((attempt) => ({
          id: attempt.id,
          title: methodPassportSchema.parse(attempt.method_versions.passport_json).title,
          state: attempt.state,
          itemCount: Array.isArray(attempt.method_versions.items_json)
            ? attempt.method_versions.items_json.length
            : 0,
          answeredCount: attempt.answers.length,
        })),
      };
    });
  }
}

const assessmentSelect = {
  id: true,
  state: true,
  due_at: true,
  created_at: true,
  completed_at: true,
  scenario_versions: { select: { scenario: { select: { title: true } } } },
  attempts: { select: { state: true } },
  consent_records: { where: { withdrawn_at: null }, select: { id: true } },
  reports: { select: { status: true, published_at: true } },
} as const;

interface AssessmentRow {
  readonly id: string;
  readonly state: string;
  readonly due_at: Date | null;
  readonly created_at: Date;
  readonly scenario_versions: { readonly scenario: { readonly title: string } };
  readonly attempts: ReadonlyArray<{ readonly state: string }>;
  readonly consent_records: ReadonlyArray<{ readonly id: string }>;
  readonly reports: { readonly published_at: Date | null } | null;
}

function toAssessment(row: AssessmentRow): EmployeeAssessment {
  const submittedCount = row.attempts.filter((item: { state: string }) =>
    ['submitted', 'scored'].includes(item.state),
  ).length;
  const dueExpired = row.due_at instanceof Date && row.due_at <= new Date();
  let status: EmployeeAssessment['status'];
  if (row.state === 'cancelled') status = 'cancelled';
  else if (row.state === 'expired' || (dueExpired && row.state !== 'completed')) status = 'expired';
  else if (row.reports?.published_at) status = 'completed';
  else if (row.state === 'completed' && row.reports) status = 'report_preparing';
  else if (row.state === 'completed') status = 'submitted';
  else if (row.state === 'in_progress') status = 'in_progress';
  else status = 'new';
  const labels: Record<EmployeeAssessment['status'], string> = {
    new: 'Новая',
    in_progress: 'В процессе',
    submitted: 'Отправлена',
    report_preparing: 'Заключение готовится',
    completed: 'Завершена',
    expired: 'Срок истёк',
    cancelled: 'Отменена',
  };
  const canOpen = (row.state === 'invited' || row.state === 'in_progress') && !dueExpired;
  return {
    id: row.id,
    title: row.scenario_versions.scenario.title,
    status,
    statusLabel: labels[status],
    dueAt: row.due_at?.toISOString() ?? null,
    methodCount: row.attempts.length,
    submittedCount,
    consentGiven: row.consent_records.length > 0,
    canOpen,
    actionLabel: canOpen
      ? row.state === 'in_progress' || row.consent_records.length
        ? 'Продолжить'
        : 'Начать'
      : null,
    createdAt: row.created_at.toISOString(),
  };
}

function employeeScope(actor: RequestActor): { organizationId: string; employeeId: string } {
  if (!actor.organizationId || !actor.employeeId)
    throw AppError.forbidden('Нет области сотрудника');
  return { organizationId: actor.organizationId, employeeId: actor.employeeId };
}
