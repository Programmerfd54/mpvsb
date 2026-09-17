import { Injectable } from '@nestjs/common';

import {
  contextFieldSchema,
  contextValuesSchema,
  methodItemSchema,
  methodPassportSchema,
  validateContextValues,
  type AssignmentDetail,
  type AssignmentListQuery,
  type AssignmentSummary,
  type ContextFieldType,
  type ContextValues,
  type CreateAssignmentsRequest,
  type CreateAssignmentsResult,
} from '@context/contracts';
import { toJson } from '@context/database';
import {
  ASSIGNMENT_STATE_LABELS,
  ATTEMPT_STATE_LABELS,
  REPORT_STATE_LABELS,
  assignmentStateMachine,
  canChangeDeadline,
  canIssueInvitation,
  invitationExpiryFrom,
  isContentAllowedInMode,
  type AssignmentState,
  type OrganizationMode,
  type ReportRevisionState,
  type ScenarioCode,
} from '@context/domain';
import { z } from 'zod';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';
import { OutboxService } from '../../platform/outbox/outbox.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { ScenariosService } from '../scenarios/scenarios.service';

const itemsSchema = z.array(methodItemSchema);

/** Состояния, в которых у сотрудника уже идёт оценка по этой версии сценария. */
const ACTIVE_STATES: AssignmentState[] = ['draft', 'invited', 'in_progress'];

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scenarios: ScenariosService,
    private readonly organizations: OrganizationsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Создание назначений пакетом.
   *
   * Весь список проверяется заранее. По умолчанию запись атомарна: либо создаются
   * все назначения, либо ни одного — руководитель не должен гадать, кому оценка
   * досталась, а кому нет (ТЗ 08.2).
   */
  async createBatch(
    organizationId: string,
    createdBy: string,
    input: CreateAssignmentsRequest,
  ): Promise<CreateAssignmentsResult> {
    const readiness = await this.organizations.readiness(organizationId);

    return this.prisma.tenant({ organizationId }, async (tx) => {
      const scenario = await this.scenarios.loadForAssignment(tx, input.scenarioVersionId);

      const organization = await tx.organizations.findUniqueOrThrow({
        where: { id: organizationId },
        select: { mode: true, status: true },
      });

      if (organization.status !== 'active') {
        throw AppError.conflict('Организация приостановлена: новые оценки создавать нельзя');
      }

      const mode = organization.mode as OrganizationMode;

      // Содержимое уровня demo нельзя назначить в реальном режиме организации.
      if (!isContentAllowedInMode(scenario.applicabilityMode, mode)) {
        throw AppError.businessRule(
          `Сценарий помечен уровнем «${scenario.applicabilityMode}» и не допускается в режиме организации «${mode}».`,
        );
      }

      if (mode !== 'demo' && !readiness.canRunRealAssessments) {
        throw AppError.businessRule(
          `Реальные оценки пока недоступны. Не закрыто: ${readiness.blockedReasons.join('; ')}`,
        );
      }

      const baseErrors = validateContextValues(scenario.contextSchema, input.context);
      if (baseErrors.length > 0) {
        throw AppError.validation(baseErrors, 'Проверьте контекст решения');
      }

      const employees = await tx.employees.findMany({
        where: { organization_id: organizationId, id: { in: [...input.employeeIds] } },
        select: { id: true, display_name: true, external_code: true, archived_at: true },
      });

      const employeesById = new Map(employees.map((row) => [row.id, row]));
      const rejected: CreateAssignmentsResult['rejected'] = [];
      const accepted: string[] = [];

      for (const employeeId of input.employeeIds) {
        const employee = employeesById.get(employeeId);
        if (!employee) {
          // Чужой сотрудник неотличим от несуществующего.
          rejected.push({ employeeId, employeeLabel: '—', reason: 'Сотрудник недоступен' });
          continue;
        }

        const label = employeeLabel(employee);

        if (employee.archived_at !== null) {
          rejected.push({ employeeId, employeeLabel: label, reason: 'Сотрудник в архиве' });
          continue;
        }

        const perEmployee = input.perEmployeeContext[employeeId];
        if (perEmployee) {
          const merged = { ...input.context, ...perEmployee };
          const errors = validateContextValues(scenario.contextSchema, merged);
          if (errors.length > 0) {
            rejected.push({
              employeeId,
              employeeLabel: label,
              reason: `Контекст заполнен неверно: ${errors[0]!.message}`,
            });
            continue;
          }
        }

        if (input.duplicatePolicy === 'reject') {
          const duplicate = await tx.assignments.findFirst({
            where: {
              organization_id: organizationId,
              employee_id: employeeId,
              scenario_version_id: input.scenarioVersionId,
              state: { in: ACTIVE_STATES },
            },
            select: { id: true },
          });
          if (duplicate) {
            rejected.push({
              employeeId,
              employeeLabel: label,
              reason: 'У сотрудника уже есть активная оценка по этому сценарию',
            });
            continue;
          }
        }

        accepted.push(employeeId);
      }

      if (rejected.length > 0) {
        throw AppError.businessRule(
          `Не удалось создать назначения: ${rejected.map((item) => `${item.employeeLabel} — ${item.reason}`).join('; ')}`,
        );
      }

      const dueAt = invitationExpiryFrom(new Date(), input.dueDays);
      const created: CreateAssignmentsResult['created'] = [];

      for (const employeeId of accepted) {
        const employee = employeesById.get(employeeId)!;
        const context: ContextValues = contextValuesSchema.parse({
          ...input.context,
          ...(input.perEmployeeContext[employeeId] ?? {}),
        });

        const assignment = await tx.assignments.create({
          data: {
            organization_id: organizationId,
            employee_id: employeeId,
            scenario_version_id: input.scenarioVersionId,
            context_snapshot: toJson(context),
            mode,
            state: 'draft',
            due_at: dueAt,
            created_by: createdBy,
          },
          select: { id: true },
        });

        // Попытки создаются сразу: порядок методик зафиксирован версией сценария,
        // руководитель и участник его не меняют.
        await tx.attempts.createMany({
          data: scenario.methods.map((method) => ({
            organization_id: organizationId,
            assignment_id: assignment.id,
            method_version_id: method.methodVersionId,
            order_index: method.orderIndex,
            required: method.required,
            state: 'not_started',
          })),
        });

        await this.audit.recordIn(tx, {
          action: 'assignment.created',
          outcome: 'success',
          organizationId,
          resourceType: 'assignment',
          resourceId: assignment.id,
          metadata: {
            scenarioCode: scenario.code,
            mode,
            duplicatePolicy: input.duplicatePolicy,
          },
        });

        created.push({
          assignmentId: assignment.id,
          employeeId,
          employeeLabel: employeeLabel(employee),
        });
      }

      if (input.draftId) {
        await tx.assignment_drafts.deleteMany({
          where: { id: input.draftId, organization_id: organizationId, created_by: createdBy },
        });
      }

      return { created, rejected: [] };
    });
  }

  async list(
    organizationId: string,
    query: AssignmentListQuery,
  ): Promise<{ items: AssignmentSummary[]; total: number }> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const where = {
        organization_id: organizationId,
        ...(query.state ? { state: query.state } : {}),
        ...(query.employeeId ? { employee_id: query.employeeId } : {}),
        ...(query.scenarioCode
          ? { scenario_versions: { scenario: { stable_code: query.scenarioCode } } }
          : {}),
        ...(query.reportStatus === 'published'
          ? { reports: { status: 'published' } }
          : query.reportStatus === 'pending'
            ? { reports: { status: { not: 'published' } } }
            : {}),
      };

      const orderBy =
        query.sort === 'dueAt'
          ? [{ due_at: query.order }, { id: query.order }]
          : query.sort === 'updatedAt'
            ? [{ updated_at: query.order }, { id: query.order }]
            : [{ created_at: query.order }, { id: query.order }];

      const [rows, total] = await Promise.all([
        tx.assignments.findMany({
          where,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: summarySelect,
        }),
        tx.assignments.count({ where }),
      ]);

      return { items: rows.map(toSummary), total };
    });
  }

  async get(organizationId: string, assignmentId: string): Promise<AssignmentDetail> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const row = await tx.assignments.findFirst({
        where: { id: assignmentId, organization_id: organizationId },
        select: {
          ...summarySelect,
          context_snapshot: true,
          replaces_assignment_id: true,
          cancel_reason: true,
          completed_at: true,
          cancelled_at: true,
          invitations: {
            select: { expires_at: true, revoked_at: true, last_exchanged_at: true },
          },
          attempts: {
            orderBy: { order_index: 'asc' },
            select: {
              id: true,
              method_version_id: true,
              order_index: true,
              required: true,
              state: true,
              submitted_at: true,
              method_versions: { select: { passport_json: true, items_json: true } },
            },
          },
          scenario_versions: {
            select: {
              semantic_version: true,
              context_schema_json: true,
              scenario: { select: { stable_code: true, title: true } },
            },
          },
        },
      });

      if (!row) {
        throw AppError.notFound(`Назначение ${assignmentId} недоступно в организации`);
      }

      const context = contextValuesSchema.parse(row.context_snapshot);
      const schema = z
        .object({ fields: z.array(contextFieldSchema) })
        .parse(row.scenario_versions.context_schema_json);

      const contextFields = schema.fields
        .map((field) => ({
          key: field.key,
          label: field.label,
          value: formatContextValue(context[field.key], field.type),
          isOpinion: field.isOpinion,
        }))
        .filter((field) => field.value !== '');

      const timeline: AssignmentDetail['timeline'] = [
        { at: row.created_at.toISOString(), title: 'Оценка создана' },
      ];
      if (row.invitations?.last_exchanged_at) {
        timeline.push({
          at: row.invitations.last_exchanged_at.toISOString(),
          title: 'Сотрудник открыл приглашение',
        });
      }
      if (row.completed_at) {
        timeline.push({ at: row.completed_at.toISOString(), title: 'Все ответы получены' });
      }
      if (row.cancelled_at) {
        timeline.push({ at: row.cancelled_at.toISOString(), title: 'Оценка отменена' });
      }

      const summary = toSummary(row);

      return {
        ...summary,
        context,
        contextFields,
        methods: row.attempts.map((attempt) => {
          const passport = methodPassportSchema.parse(attempt.method_versions.passport_json);
          const items = itemsSchema.parse(attempt.method_versions.items_json);
          return {
            attemptId: attempt.id,
            methodVersionId: attempt.method_version_id,
            title: passport.title,
            orderIndex: attempt.order_index,
            required: attempt.required,
            state: attempt.state,
            stateLabel: ATTEMPT_STATE_LABELS[attempt.state as keyof typeof ATTEMPT_STATE_LABELS],
            itemCount: items.length,
            submittedAt: attempt.submitted_at?.toISOString() ?? null,
          };
        }),
        timeline: timeline.sort((a, b) => a.at.localeCompare(b.at)),
        invitation: row.invitations
          ? {
              expiresAt: row.invitations.expires_at.toISOString(),
              revokedAt: row.invitations.revoked_at?.toISOString() ?? null,
              lastExchangedAt: row.invitations.last_exchanged_at?.toISOString() ?? null,
            }
          : null,
        replacesAssignmentId: row.replaces_assignment_id,
        cancelReason: row.cancel_reason,
        availableActions: availableActions(row.state as AssignmentState, summary.reportId !== null),
      };
    });
  }

  /** Продление срока в пределах политики. Истёкшее назначение продлевать нельзя. */
  async changeDeadline(
    organizationId: string,
    assignmentId: string,
    dueDays: number,
  ): Promise<AssignmentDetail> {
    await this.prisma.tenant({ organizationId }, async (tx) => {
      const assignment = await tx.assignments.findFirst({
        where: { id: assignmentId, organization_id: organizationId },
        select: { id: true, state: true },
      });
      if (!assignment) {
        throw AppError.notFound(`Назначение ${assignmentId} недоступно`);
      }
      if (!canChangeDeadline(assignment.state as AssignmentState)) {
        throw AppError.conflict(
          `Срок нельзя изменить в состоянии «${ASSIGNMENT_STATE_LABELS[assignment.state as AssignmentState]}»`,
        );
      }

      const dueAt = invitationExpiryFrom(new Date(), dueDays);

      await tx.assignments.update({
        where: { id: assignmentId },
        data: { due_at: dueAt, revision: { increment: 1 } },
      });
      await tx.invitations.updateMany({
        where: { organization_id: organizationId, assignment_id: assignmentId, revoked_at: null },
        data: { expires_at: dueAt },
      });

      await this.audit.recordIn(tx, {
        action: 'assignment.deadline_changed',
        outcome: 'success',
        organizationId,
        resourceType: 'assignment',
        resourceId: assignmentId,
        metadata: { dueDays },
      });
    });

    return this.get(organizationId, assignmentId);
  }

  /**
   * Отмена оценки. Ссылка и сессия участника перестают работать немедленно,
   * поколение данных увеличивается — незавершённые фоновые задания не сохранят
   * результат по отменённому назначению.
   */
  async cancel(
    organizationId: string,
    assignmentId: string,
    reason: string,
  ): Promise<AssignmentDetail> {
    await this.prisma.tenant({ organizationId }, async (tx) => {
      const assignment = await tx.assignments.findFirst({
        where: { id: assignmentId, organization_id: organizationId },
        select: { id: true, state: true, data_generation: true },
      });
      if (!assignment) {
        throw AppError.notFound(`Назначение ${assignmentId} недоступно`);
      }

      const state = assignment.state as AssignmentState;
      if (!assignmentStateMachine.can(state, 'cancelled')) {
        throw AppError.conflict(
          `Оценку нельзя отменить в состоянии «${ASSIGNMENT_STATE_LABELS[state]}»`,
        );
      }

      const nextGeneration = assignment.data_generation + 1n;

      await tx.assignments.update({
        where: { id: assignmentId },
        data: {
          state: 'cancelled',
          cancelled_at: new Date(),
          cancel_reason: reason,
          data_generation: nextGeneration,
          revision: { increment: 1 },
        },
      });

      await tx.invitations.updateMany({
        where: { organization_id: organizationId, assignment_id: assignmentId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await tx.participant_sessions.updateMany({
        where: { organization_id: organizationId, assignment_id: assignmentId, revoked_at: null },
        data: { revoked_at: new Date() },
      });

      await this.outbox.enqueue(tx, {
        eventType: 'assignment.cancelled',
        organizationId,
        entityType: 'assignment',
        entityId: assignmentId,
        dataGeneration: nextGeneration,
      });

      await this.audit.recordIn(tx, {
        action: 'assignment.cancelled',
        outcome: 'success',
        organizationId,
        resourceType: 'assignment',
        resourceId: assignmentId,
      });
    });

    return this.get(organizationId, assignmentId);
  }
}

function employeeLabel(employee: {
  display_name: string | null;
  external_code: string | null;
}): string {
  return employee.display_name ?? employee.external_code ?? 'Без имени';
}

const CONTEXT_DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function formatContextValue(value: unknown, type: ContextFieldType): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (type === 'date') {
    const parsed = new Date(String(value));
    if (!Number.isNaN(parsed.getTime())) {
      return CONTEXT_DATE_FORMAT.format(parsed);
    }
  }
  return String(value);
}

const summarySelect = {
  id: true,
  employee_id: true,
  state: true,
  mode: true,
  due_at: true,
  created_at: true,
  updated_at: true,
  employees: { select: { display_name: true, external_code: true } },
  scenario_versions: {
    select: {
      semantic_version: true,
      scenario: { select: { stable_code: true, title: true } },
    },
  },
  attempts: { select: { state: true, required: true } },
  reports: { select: { id: true, status: true } },
} as const;

type SummaryRow = {
  id: string;
  employee_id: string;
  state: string;
  mode: string;
  due_at: Date | null;
  created_at: Date;
  updated_at: Date;
  employees: { display_name: string | null; external_code: string | null };
  scenario_versions: {
    semantic_version: string;
    scenario: { stable_code: string; title: string };
  };
  attempts: Array<{ state: string; required: boolean }>;
  reports: { id: string; status: string } | null;
};

function toSummary(row: SummaryRow): AssignmentSummary {
  const state = row.state as AssignmentState;
  const submitted = row.attempts.filter(
    (attempt) => attempt.state === 'submitted' || attempt.state === 'scored',
  ).length;

  const reportStatus = row.reports?.status ?? null;

  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeLabel: employeeLabel(row.employees),
    scenarioCode: row.scenario_versions.scenario.stable_code as ScenarioCode,
    scenarioTitle: row.scenario_versions.scenario.title,
    scenarioVersion: row.scenario_versions.semantic_version,
    state,
    stateLabel: ASSIGNMENT_STATE_LABELS[state],
    mode: row.mode as OrganizationMode,
    dueAt: row.due_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    attemptsSubmitted: submitted,
    attemptsTotal: row.attempts.length,
    reportStatus,
    reportStatusLabel: reportStatus
      ? (REPORT_STATE_LABELS[reportStatus as ReportRevisionState] ?? null)
      : null,
    // Идентификатор заключения отдаётся только когда оно опубликовано:
    // черновик обычному руководителю недоступен.
    reportId: row.reports?.status === 'published' ? row.reports.id : null,
  };
}

function availableActions(
  state: AssignmentState,
  hasPublishedReport: boolean,
): AssignmentDetail['availableActions'] {
  const actions: AssignmentDetail['availableActions'] = [];

  if (canIssueInvitation(state)) {
    actions.push('issue_invitation');
  }
  if (canChangeDeadline(state)) {
    actions.push('change_deadline');
  }
  if (assignmentStateMachine.can(state, 'cancelled')) {
    actions.push('cancel');
  }
  if (state === 'draft') {
    actions.push('delete_draft');
  }
  if (hasPublishedReport) {
    actions.push('open_report');
  }
  if (state === 'completed' || state === 'cancelled' || state === 'expired') {
    actions.push('reassign');
  }

  return actions;
}
