import { Injectable } from '@nestjs/common';

import {
  CORRECTION_BLOCK_KEYS,
  CORRECTION_BLOCK_LABELS,
  CORRECTION_REQUEST_STATES,
  CORRECTION_REQUEST_STATE_LABELS,
  REVIEW_CHECKLIST_ITEMS,
  methodPassportSchema,
  reportContentSchema,
  type CorrectionBlockKey,
  type CorrectionRequestState,
  type CorrectionRequestView,
  type EvidenceItemView,
  type ReportDetail,
  type ReportSummary,
} from '@context/contracts';
import { toJson, type TenantTransaction } from '@context/database';
import {
  DECISION_ACTION_LABELS,
  EVIDENCE_KIND_LABELS,
  EVIDENCE_KIND_LIMITS,
  GENERATION_MODE_LABELS,
  NOTIFICATION_TITLES,
  SUPPORT_LEVEL_LABELS,
  caseCodeFor,
  isReviewable,
  notificationEventKey,
  reportRevisionStateMachine,
  type DecisionAction,
  type EvidenceKind,
  type GenerationMode,
  type OrganizationMode,
  type OrgPermission,
  type ReportRevisionState,
  type ScenarioCode,
  type SupportLevel,
} from '@context/domain';
import { z } from 'zod';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';
import { isGrantLiveFor } from '../access-grants/grant-guard';

const limitationsSchema = z.array(z.string());
const normalizedContentSchema = z.object({ text: z.string() });

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Список опубликованных заключений. Черновики обычному руководителю не видны. */
  async listPublished(
    organizationId: string,
    query: { page: number; pageSize: number; employeeId?: string; scenarioCode?: ScenarioCode },
  ): Promise<{ items: ReportSummary[]; total: number }> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const where = {
        organization_id: organizationId,
        status: 'published',
        ...(query.employeeId ? { assignments: { employee_id: query.employeeId } } : {}),
        ...(query.scenarioCode
          ? {
              assignments: { scenario_versions: { scenario: { stable_code: query.scenarioCode } } },
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        tx.reports.findMany({
          where,
          orderBy: [{ published_at: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: reportListSelect,
        }),
        tx.reports.count({ where }),
      ]);

      const items = rows
        .map((row) => toSummary(row))
        .filter((item): item is ReportSummary => item !== null);
      return { items, total };
    });
  }

  /**
   * Опубликованное заключение для руководителя.
   * Непубликованные ревизии сюда не попадают даже по прямой ссылке.
   */
  /**
   * Чтение опубликованного заключения руководителем.
   *
   * Обращение записывается в аудит: доступ к заключению о человеке — событие,
   * которое должно быть видно в журнале, а не бесплатное действие (ТЗ 10.9, A11).
   */
  async getPublished(organizationId: string, reportId: string): Promise<ReportDetail> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const report = await tx.reports.findFirst({
        where: { id: reportId, organization_id: organizationId, status: 'published' },
        select: reportDetailSelect,
      });

      if (!report?.current_published_revision) {
        throw AppError.notFound(`Опубликованное заключение ${reportId} недоступно`);
      }

      const detail = await this.buildDetail(
        tx,
        organizationId,
        report,
        report.current_published_revision,
      );

      await this.audit.recordIn(tx, {
        action: 'report.read',
        outcome: 'success',
        organizationId,
        resourceType: 'report',
        resourceId: reportId,
        purpose: 'manager_decision',
        metadata: { revisionNo: report.current_published_revision.revision_no },
      });

      return detail;
    });
  }

  /** Черновики на проверке. Доступно только с разрешением reports.review. */
  async listPendingReview(organizationId: string): Promise<
    Array<{
      reportId: string;
      revisionId: string;
      caseCode: string;
      scenarioTitle: string;
      generationMode: GenerationMode;
      createdAt: string;
      evidenceCount: number;
    }>
  > {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const revisions = await tx.report_revisions.findMany({
        where: { organization_id: organizationId, state: 'pending_review' },
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          created_at: true,
          generation_mode: true,
          content_json: true,
          report: {
            select: {
              id: true,
              assignment_id: true,
              assignments: {
                select: {
                  scenario_versions: { select: { scenario: { select: { title: true } } } },
                  evidence_items: { select: { id: true } },
                },
              },
            },
          },
        },
      });

      return revisions.map((revision) => {
        const content = reportContentSchema.parse(revision.content_json);
        return {
          reportId: revision.report.id,
          revisionId: revision.id,
          // Рецензии достаточно кода случая: персональный идентификатор не нужен.
          caseCode: content.caseCode,
          scenarioTitle: revision.report.assignments.scenario_versions.scenario.title,
          generationMode: (revision.generation_mode ?? 'template') as GenerationMode,
          createdAt: revision.created_at.toISOString(),
          evidenceCount: revision.report.assignments.evidence_items.length,
        };
      });
    });
  }

  /** Черновик с источниками для рецензента. */
  async getForReview(organizationId: string, reportId: string): Promise<ReportDetail> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const report = await tx.reports.findFirst({
        where: { id: reportId, organization_id: organizationId },
        select: reportDetailSelect,
      });

      if (!report) {
        throw AppError.notFound(`Заключение ${reportId} недоступно`);
      }

      const revision =
        report.revisions.find((item) => isReviewable(item.state as ReportRevisionState)) ??
        report.current_published_revision;

      if (!revision) {
        throw AppError.notFound('Нет ревизии, доступной для проверки');
      }

      const detail = await this.buildDetail(tx, organizationId, report, revision);

      // Рецензент читает черновик о конкретном человеке: обращение фиксируется.
      await this.audit.recordIn(tx, {
        action: 'report.read_for_review',
        outcome: 'success',
        organizationId,
        resourceType: 'report',
        resourceId: reportId,
        purpose: 'review',
        metadata: { revisionNo: revision.revision_no },
      });

      return detail;
    });
  }

  /**
   * Заключение назначения для администратора платформы по временному гранту.
   *
   * Грант перепроверяется в той же транзакции по часам базы: отзыв или
   * истечение между проверкой и чтением доступ не пропустят. Ответ сужен:
   * вместо имени сотрудника — код случая, без решений руководителя и имени
   * рецензента. Чтение записывается в аудит атомарно с самим чтением, без
   * содержания прочитанного (ТЗ 10.4, A03).
   */
  async getForAccessGrant(
    organizationId: string,
    assignmentId: string,
    access: { readonly grantId: string; readonly userId: string; readonly purpose: string },
  ): Promise<ReportDetail> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const live = await isGrantLiveFor(tx, {
        organizationId,
        grantId: access.grantId,
        userId: access.userId,
        assignmentId,
      });

      if (!live) {
        throw AppError.forbidden(
          'Доступ по этому обращению не действует. Оформите новое обращение или попросите продление.',
        );
      }

      const report = await tx.reports.findFirst({
        where: { organization_id: organizationId, assignment_id: assignmentId },
        select: reportDetailSelect,
      });

      const reviewable =
        report?.revisions.find((item) => isReviewable(item.state as ReportRevisionState)) ?? null;
      const published = report?.current_published_revision ?? null;

      // Разбор заключения просят ради ревизии на проверке: отдать вместо неё
      // старую опубликованную значило бы подменить предмет разбора. Для
      // остальных целей выдаётся только опубликованная версия: непроверенный
      // черновик под цель «инцидент» или «запрос по данным» не подпадает, и
      // выдавать его как заключение нельзя (ТЗ A08, 10.4).
      const revision = access.purpose === 'report_review' ? (reviewable ?? published) : published;

      if (!report || !revision) {
        throw AppError.notFound(
          access.purpose === 'report_review'
            ? 'Заключение по этому назначению ещё не подготовлено'
            : 'Заключение по этому назначению ещё не опубликовано. Для разбора черновика укажите цель «Разбор заключения».',
        );
      }

      const detail = await this.buildDetail(tx, organizationId, report, revision);

      await this.audit.recordIn(tx, {
        action: 'access_grant.report_read',
        outcome: 'success',
        organizationId,
        resourceType: 'report',
        resourceId: report.id,
        purpose: access.purpose,
        metadata: {
          actorId: access.userId,
          grantId: access.grantId,
          caseCode: caseCodeFor(assignmentId),
          revisionNo: revision.revision_no,
        },
      });

      return {
        ...detail,
        // Администратору достаточно кода случая: имя сотрудника в объём не входит.
        employeeLabel: caseCodeFor(assignmentId),
        decisions: [],
        preparation: { ...detail.preparation, reviewerName: null },
      };
    });
  }

  /**
   * Публикация ревизии.
   *
   * Обязателен полный чек-лист рецензента и его идентификатор: опубликованная
   * ревизия неизменяема, исправление создаётся отдельной ревизией (ТЗ A08).
   */
  async publish(
    organizationId: string,
    reportId: string,
    reviewerId: string,
    checklist: Readonly<Record<string, boolean>>,
    comment: string | undefined,
  ): Promise<ReportDetail> {
    await this.prisma.tenant({ organizationId }, async (tx) => {
      const missing = REVIEW_CHECKLIST_ITEMS.filter((key) => checklist[key] !== true);
      if (missing.length > 0) {
        throw AppError.businessRule(
          'Публикация требует подтверждения всех пунктов проверки.',
          missing.map((key) => ({ field: key, message: 'Пункт не подтверждён' })),
        );
      }

      const revision = await tx.report_revisions.findFirst({
        where: { organization_id: organizationId, report_id: reportId, state: 'pending_review' },
        orderBy: { revision_no: 'desc' },
        select: {
          id: true,
          state: true,
          content_hash: true,
          report: { select: { current_published_revision_id: true } },
        },
      });

      if (!revision) {
        throw AppError.conflict('Нет ревизии, ожидающей проверки');
      }
      if (!revision.content_hash) {
        throw AppError.conflict('Ревизия не содержит подготовленного текста');
      }

      reportRevisionStateMachine.assert(revision.state as ReportRevisionState, 'published');

      const now = new Date();

      // Предыдущая опубликованная ревизия помечается как заменённая, но остаётся
      // доступной: история публикаций не переписывается.
      const previousId = revision.report.current_published_revision_id;
      if (previousId) {
        await tx.report_revisions.update({
          where: { id: previousId },
          data: { state: 'superseded' },
        });
      }

      await tx.report_revisions.update({
        where: { id: revision.id },
        data: {
          state: 'published',
          reviewer_id: reviewerId,
          reviewed_at: now,
          published_at: now,
          ...(previousId ? { supersedes_id: previousId } : {}),
        },
      });

      await tx.reports.update({
        where: { id: reportId },
        data: {
          status: 'published',
          published_at: now,
          current_published_revision_id: revision.id,
        },
      });

      await tx.report_reviews.create({
        data: {
          organization_id: organizationId,
          revision_id: revision.id,
          reviewer_id: reviewerId,
          checklist_json: toJson(checklist),
          action: 'approved',
          comment: comment ?? null,
        },
      });

      await this.notifyAssignmentOwner(tx, organizationId, reportId, revision.id);

      await this.audit.recordIn(tx, {
        action: 'report.published',
        outcome: 'success',
        organizationId,
        resourceType: 'report_revision',
        resourceId: revision.id,
        metadata: { supersededPrevious: previousId !== null },
      });
    });

    return this.getPublished(organizationId, reportId);
  }

  /** Возврат черновика на доработку с замечаниями рецензента. */
  async requestRevision(
    organizationId: string,
    reportId: string,
    reviewerId: string,
    comment: string,
  ): Promise<void> {
    await this.prisma.tenant({ organizationId }, async (tx) => {
      const revision = await tx.report_revisions.findFirst({
        where: { organization_id: organizationId, report_id: reportId, state: 'pending_review' },
        orderBy: { revision_no: 'desc' },
        select: { id: true, state: true },
      });

      if (!revision) {
        throw AppError.conflict('Нет ревизии, ожидающей проверки');
      }

      reportRevisionStateMachine.assert(
        revision.state as ReportRevisionState,
        'revision_requested',
      );

      await tx.report_revisions.update({
        where: { id: revision.id },
        data: { state: 'revision_requested', reviewer_id: reviewerId, reviewed_at: new Date() },
      });
      await tx.reports.update({
        where: { id: reportId },
        data: { status: 'revision_requested' },
      });
      await tx.report_reviews.create({
        data: {
          organization_id: organizationId,
          revision_id: revision.id,
          reviewer_id: reviewerId,
          checklist_json: toJson({}),
          action: 'revision_requested',
          comment,
        },
      });

      await this.audit.recordIn(tx, {
        action: 'report.revision_requested',
        outcome: 'success',
        organizationId,
        resourceType: 'report_revision',
        resourceId: revision.id,
      });
    });
  }

  /**
   * Управленческая запись действия.
   * Это запись пользователя: она не меняет заключение и не становится
   * автоматически исходом исследования (ТЗ M09).
   */
  async recordDecision(
    organizationId: string,
    reportId: string,
    actorId: string,
    input: { actionCode: DecisionAction; comment?: string; followUpAt?: string },
  ): Promise<void> {
    await this.prisma.tenant({ organizationId }, async (tx) => {
      const report = await tx.reports.findFirst({
        where: { id: reportId, organization_id: organizationId, status: 'published' },
        select: { current_published_revision_id: true },
      });

      if (!report?.current_published_revision_id) {
        throw AppError.notFound(`Опубликованное заключение ${reportId} недоступно`);
      }

      await tx.decisions.create({
        data: {
          organization_id: organizationId,
          report_revision_id: report.current_published_revision_id,
          actor_id: actorId,
          action_code: input.actionCode,
          user_comment: input.comment ?? null,
          follow_up_at: input.followUpAt ? new Date(input.followUpAt) : null,
        },
      });

      await this.audit.recordIn(tx, {
        action: 'report.decision_recorded',
        outcome: 'success',
        organizationId,
        resourceType: 'report',
        resourceId: reportId,
        metadata: { actionCode: input.actionCode },
      });
    });
  }

  /** Запрос на исправление. Отчёт остаётся доступным с отметкой запроса. */
  async requestCorrection(
    organizationId: string,
    reportId: string,
    requesterUserId: string,
    input: { blockKey: string; description: string },
  ): Promise<{ receiptId: string }> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      /*
       * Известное расхождение, закреплённое в уже записанных строках:
       * `resource_type` = 'report_revision', а в `resource_id` лежит
       * идентификатор заключения, а не ревизии. Чтение запросов и проверка
       * цели уведомления повторяют это же сочетание — иначе выборка была бы
       * пустой. Привести к одному значению нужно отдельной задачей с
       * миграцией данных (см. отчёт M14).
       */
      const created = await tx.correction_requests.create({
        data: {
          organization_id: organizationId,
          resource_type: 'report_revision',
          resource_id: reportId,
          requester_type: 'manager',
          requester_user_id: requesterUserId,
          block_key: input.blockKey,
          description: input.description,
        },
        select: { id: true },
      });

      await this.notifyReviewers(tx, organizationId, reportId, created.id, requesterUserId);

      await this.audit.recordIn(tx, {
        action: 'report.correction_requested',
        outcome: 'success',
        organizationId,
        resourceType: 'report',
        resourceId: reportId,
        metadata: { blockKey: input.blockKey },
      });

      return { receiptId: created.id };
    });
  }

  /**
   * Запросы на исправление по заключению — для рецензента (ТЗ 01.7, M10).
   *
   * Это точка, куда ведёт уведомление `revision_requested`: без неё рецензент
   * знал бы о запросе, но не о том, что именно заявлено. Свободный текст
   * выдаётся здесь, за разрешением `reports.review`, и в уведомление не
   * переносится. Имя автора запроса не выдаётся: для разбора достаточно типа
   * обратившегося.
   */
  async listCorrections(
    organizationId: string,
    reportId: string,
  ): Promise<CorrectionRequestView[]> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const report = await tx.reports.findFirst({
        where: { id: reportId, organization_id: organizationId },
        select: { id: true },
      });

      if (!report) {
        throw AppError.notFound(`Заключение ${reportId} недоступно`);
      }

      // Фильтр опирается на то же известное расхождение, что и запись выше:
      // 'report_revision' + идентификатор заключения в `resource_id`.
      const rows = await tx.correction_requests.findMany({
        where: {
          organization_id: organizationId,
          resource_type: 'report_revision',
          resource_id: reportId,
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          requester_type: true,
          block_key: true,
          description: true,
          state: true,
          created_at: true,
          updated_at: true,
        },
      });

      // Чтение запросов о конкретном человеке фиксируется, как и чтение черновика.
      await this.audit.recordIn(tx, {
        action: 'report.corrections_read',
        outcome: 'success',
        organizationId,
        resourceType: 'report',
        resourceId: reportId,
        purpose: 'review',
        metadata: { count: rows.length },
      });

      return rows.map((row) => {
        const blockKey = correctionBlockKeyOf(row.block_key);
        const state = correctionStateOf(row.state);

        return {
          id: row.id,
          reportId,
          requesterType: row.requester_type as CorrectionRequestView['requesterType'],
          blockKey,
          blockLabel: blockKey === null ? null : CORRECTION_BLOCK_LABELS[blockKey],
          description: row.description,
          state,
          stateLabel: CORRECTION_REQUEST_STATE_LABELS[state],
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        };
      });
    });
  }

  /**
   * Уведомление автору назначения о готовом заключении.
   *
   * Событие — публикация конкретной ревизии, поэтому ключ дедупликации
   * строится по `revisionId`, а не по отчёту. Выпуск исправленной версии после
   * запроса на исправление — отдельное событие: руководитель, сам запросивший
   * исправление, обязан узнать, что оно вышло. Повторная обработка той же
   * публикации при этом второго уведомления не создаёт: вставка идёт через
   * `createMany` с `skipDuplicates`, как у остальных продюсеров.
   */
  private async notifyAssignmentOwner(
    tx: TenantTransaction,
    organizationId: string,
    reportId: string,
    revisionId: string,
  ): Promise<void> {
    const report = await tx.reports.findFirst({
      where: { id: reportId, organization_id: organizationId },
      select: { assignments: { select: { created_by: true } } },
    });

    if (!report) {
      return;
    }

    const recipientUserId = report.assignments.created_by;

    /*
     * Адресат должен быть действующим участником организации: у пользователя
     * с отозванным membership ManagerGuard ответит 404, и уведомление стало бы
     * мёртвой записью, никого не уведомившей. Ту же проверку делает
     * notifyReviewers — два продюсера рядом работают одинаково.
     */
    const membership = await tx.memberships.findFirst({
      where: {
        organization_id: organizationId,
        user_id: recipientUserId,
        status: 'active',
      },
      select: { id: true },
    });

    if (!membership) {
      return;
    }

    const eventKey = notificationEventKey('report_published', revisionId);

    /*
     * Уведомление не содержит текста заключения: только факт готовности.
     *
     * Вставка идёт `createMany` с `skipDuplicates`, а не `upsert`: уникальный
     * ключ дедупликации — «адресат + событие», без организации, и под RLS
     * строка с тем же ключом в другой организации этой транзакции не видна.
     * `upsert` не нашёл бы её, пошёл на INSERT и получил бы нарушение
     * уникальности — 500 на штатном пути публикации. `skipDuplicates`
     * обрабатывает такой случай тихо и одинаково с остальными продюсерами.
     */
    await tx.notifications.createMany({
      data: [
        {
          organization_id: organizationId,
          recipient_user_id: recipientUserId,
          type: 'report_published',
          resource_type: 'report',
          resource_id: reportId,
          title: NOTIFICATION_TITLES.report_published,
          event_key: eventKey,
        },
      ],
      skipDuplicates: true,
    });
  }

  /**
   * Уведомление рецензентам о запросе на исправление (ТЗ 01.7, M10).
   *
   * Адресаты — действующие участники организации с правом проверки; автор
   * запроса себе уведомление не шлёт. Описание неточности — свободный текст
   * пользователя, поэтому в уведомление оно не попадает: адресат открывает
   * запрос там, где право на чтение проверяется заново.
   */
  private async notifyReviewers(
    tx: TenantTransaction,
    organizationId: string,
    reportId: string,
    correctionRequestId: string,
    requesterUserId: string,
  ): Promise<void> {
    const reviewers = await tx.memberships.findMany({
      where: {
        organization_id: organizationId,
        status: 'active',
        permissions: { has: 'reports.review' satisfies OrgPermission },
        user_id: { not: requesterUserId },
      },
      select: { user_id: true },
    });

    if (reviewers.length === 0) {
      return;
    }

    const eventKey = notificationEventKey('revision_requested', correctionRequestId);

    await tx.notifications.createMany({
      data: reviewers.map((reviewer) => ({
        organization_id: organizationId,
        recipient_user_id: reviewer.user_id,
        type: 'revision_requested',
        resource_type: 'report',
        resource_id: reportId,
        title: NOTIFICATION_TITLES.revision_requested,
        event_key: eventKey,
      })),
      // Дедупликация по «событие + адресат»: повторная обработка того же
      // запроса второго уведомления не создаёт.
      skipDuplicates: true,
    });
  }

  private async buildDetail(
    tx: TenantTransaction,
    organizationId: string,
    report: ReportDetailRow,
    revision: RevisionRow,
  ): Promise<ReportDetail> {
    const content = reportContentSchema.parse(revision.content_json);

    const evidenceRows = await tx.evidence_items.findMany({
      where: { organization_id: organizationId, assignment_id: report.assignment_id },
      orderBy: { evidence_code: 'asc' },
      select: {
        evidence_code: true,
        kind: true,
        collected_at: true,
        normalized_content: true,
        limitations: true,
      },
    });

    const evidence: EvidenceItemView[] = evidenceRows.map((row) => {
      const kind = row.kind as EvidenceKind;
      return {
        evidenceCode: row.evidence_code,
        kind,
        kindLabel: EVIDENCE_KIND_LABELS[kind],
        kindLimit: EVIDENCE_KIND_LIMITS[kind],
        collectedAt: row.collected_at.toISOString(),
        content: normalizedContentSchema.parse(row.normalized_content).text,
        limitations: limitationsSchema.parse(row.limitations),
      };
    });

    const decisions = await tx.decisions.findMany({
      where: { organization_id: organizationId, report_revision_id: revision.id },
      orderBy: { created_at: 'desc' },
      select: {
        action_code: true,
        user_comment: true,
        follow_up_at: true,
        created_at: true,
        users: { select: { display_name: true } },
      },
    });

    const reviewer = revision.reviewer_id
      ? await tx.users.findUnique({
          where: { id: revision.reviewer_id },
          select: { display_name: true },
        })
      : null;

    const scorerVersion = await tx.score_results.findFirst({
      where: { organization_id: organizationId, attempts: { assignment_id: report.assignment_id } },
      select: { scorer_version: true },
      orderBy: { created_at: 'desc' },
    });

    const summary = toSummary(report, revision);
    if (!summary) {
      throw AppError.notFound('Заключение недоступно');
    }

    return {
      ...summary,
      revisionId: revision.id,
      // Состояние ревизии показывается прямо: отличать проверенное заключение
      // от черновика по пустому publishedAt интерфейсу не следует (ТЗ A08).
      revisionState: revision.state as ReportRevisionState,
      content,
      evidence,
      preparation: {
        methods: report.assignments.attempts.map((attempt) => {
          const passport = methodPassportSchema.parse(attempt.method_versions.passport_json);
          return { title: passport.title, version: attempt.method_versions.semantic_version };
        }),
        scenarioVersion: report.assignments.scenario_versions.semantic_version,
        scorerVersion: scorerVersion?.scorer_version ?? null,
        promptVersion: revision.prompt_version_id,
        reviewedAt: revision.reviewed_at?.toISOString() ?? null,
        reviewerName: reviewer?.display_name ?? null,
        inputHash: revision.input_hash,
      },
      currentRevisionId: report.current_published_revision_id ?? null,
      decisions: decisions.map((decision) => ({
        actionCode: decision.action_code,
        actionLabel:
          DECISION_ACTION_LABELS[decision.action_code as DecisionAction] ?? decision.action_code,
        comment: decision.user_comment,
        followUpAt: decision.follow_up_at?.toISOString() ?? null,
        createdAt: decision.created_at.toISOString(),
        actorName: decision.users.display_name,
      })),
    };
  }
}

const revisionSelect = {
  id: true,
  revision_no: true,
  state: true,
  content_json: true,
  generation_mode: true,
  prompt_version_id: true,
  input_hash: true,
  reviewer_id: true,
  reviewed_at: true,
  published_at: true,
} as const;

const reportListSelect = {
  id: true,
  assignment_id: true,
  status: true,
  published_at: true,
  current_published_revision: { select: revisionSelect },
  assignments: {
    select: {
      mode: true,
      employees: { select: { display_name: true, external_code: true } },
      scenario_versions: {
        select: {
          semantic_version: true,
          scenario: { select: { stable_code: true, title: true } },
        },
      },
    },
  },
} as const;

const reportDetailSelect = {
  ...reportListSelect,
  current_published_revision_id: true,
  revisions: { select: revisionSelect, orderBy: { revision_no: 'desc' as const } },
  assignments: {
    select: {
      mode: true,
      employees: { select: { display_name: true, external_code: true } },
      scenario_versions: {
        select: {
          semantic_version: true,
          scenario: { select: { stable_code: true, title: true } },
        },
      },
      attempts: {
        orderBy: { order_index: 'asc' as const },
        select: { method_versions: { select: { passport_json: true, semantic_version: true } } },
      },
    },
  },
} as const;

type RevisionRow = {
  id: string;
  revision_no: number;
  state: string;
  content_json: unknown;
  generation_mode: string | null;
  prompt_version_id: string | null;
  input_hash: string | null;
  reviewer_id: string | null;
  reviewed_at: Date | null;
  published_at: Date | null;
};

type ReportDetailRow = {
  id: string;
  assignment_id: string;
  status: string;
  published_at: Date | null;
  current_published_revision_id?: string | null;
  current_published_revision: RevisionRow | null;
  revisions?: RevisionRow[];
  assignments: {
    mode: string;
    employees: { display_name: string | null; external_code: string | null };
    scenario_versions: {
      semantic_version: string;
      scenario: { stable_code: string; title: string };
    };
    attempts: Array<{ method_versions: { passport_json: unknown; semantic_version: string } }>;
  };
};

function toSummary(
  report: Omit<ReportDetailRow, 'assignments'> & {
    assignments: Omit<ReportDetailRow['assignments'], 'attempts'> & {
      attempts?: ReportDetailRow['assignments']['attempts'];
    };
  },
  explicitRevision?: RevisionRow,
): ReportSummary | null {
  const revision = explicitRevision ?? report.current_published_revision;
  if (!revision?.content_json) {
    return null;
  }

  const content = reportContentSchema.parse(revision.content_json);
  const mode = (revision.generation_mode ?? 'template') as GenerationMode;

  return {
    reportId: report.id,
    assignmentId: report.assignment_id,
    employeeLabel:
      report.assignments.employees.display_name ??
      report.assignments.employees.external_code ??
      'Без имени',
    scenarioCode: report.assignments.scenario_versions.scenario.stable_code as ScenarioCode,
    scenarioTitle: report.assignments.scenario_versions.scenario.title,
    publishedAt: revision.published_at?.toISOString() ?? null,
    revisionNo: revision.revision_no,
    supportLevel: content.supportLevel as SupportLevel,
    supportLevelLabel: SUPPORT_LEVEL_LABELS[content.supportLevel as SupportLevel],
    summary: content.summary,
    generationMode: mode,
    generationModeLabel: GENERATION_MODE_LABELS[mode],
    mode: report.assignments.mode as OrganizationMode,
    superseded: revision.state === 'superseded',
  };
}

/**
 * Блок заключения из базы. Колонка допускает null и не ограничена списком,
 * поэтому неизвестное значение приводится к «нет блока»: рецензенту лучше
 * увидеть запрос без пометки блока, чем не увидеть запрос вовсе.
 */
function correctionBlockKeyOf(value: string | null): CorrectionBlockKey | null {
  return value !== null && (CORRECTION_BLOCK_KEYS as readonly string[]).includes(value)
    ? (value as CorrectionBlockKey)
    : null;
}

/**
 * Состояние запроса. Список закреплён check-constraint, поэтому несовпадение
 * означает расхождение кода и схемы, а не пользовательский ввод.
 */
function correctionStateOf(value: string): CorrectionRequestState {
  if (!(CORRECTION_REQUEST_STATES as readonly string[]).includes(value)) {
    throw new AppError('INTERNAL_ERROR', {
      internalDetail: `Неизвестное состояние запроса на исправление «${value}»: схема базы и контракты разошлись`,
    });
  }
  return value as CorrectionRequestState;
}
