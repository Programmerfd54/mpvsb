/**
 * Входящие уведомления руководителя (ТЗ 01.7, M14).
 *
 * Проверяется то, ради чего механизм существует: адресат видит только свои
 * уведомления и только в своей организации, отметка прочитанным идемпотентна,
 * счётчик колокольчика совпадает со списком, повторная обработка события
 * второго уведомления не создаёт, а открытие ресурса заново проверяет право
 * и наличие ресурса и ничего из него не возвращает при отказе.
 *
 * Все участники синтетические.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REVIEW_CHECKLIST_ITEMS } from '@context/contracts';
import { createPrismaClient, toJson, withPlatformOps, withTenant } from '@context/database';
import type { PrismaClient } from '@context/database';
import {
  NOTIFICATION_TITLES,
  caseCodeFor,
  notificationEventKey,
  type OrgPermission,
} from '@context/domain';
import { contentHash } from '@context/scoring';

import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ReportsService } from '../src/modules/reports/reports.service';
import { AuditService } from '../src/platform/audit/audit.service';
import { PrismaService } from '../src/platform/database/prisma.service';
import { AppError } from '../src/platform/errors/app-error';

let prisma: PrismaClient;
let notifications: NotificationsService;
let reports: ReportsService;

const ids = {
  organizationId: '',
  otherOrganizationId: '',
  /** Руководитель, создавший назначение: адресат готовых заключений и сроков. */
  creatorId: '',
  /** Рецензент: адресат запросов на исправление. Права на чтение заключений нет. */
  reviewerId: '',
  /** Руководитель соседней организации. */
  strangerId: '',
  /** Автор назначения с отозванным membership: уведомлять его некуда. */
  revokedId: '',
  employeeId: '',
  scenarioVersionId: '',
  assignmentId: '',
  expiringAssignmentId: '',
  reportId: '',
  /** Заключение назначения, созданного отозванным руководителем. */
  revokedReportId: '',
  otherReportId: '',
};

const PAGE = { page: 1, pageSize: 20, filter: 'all' } as const;
const UNREAD_PAGE = { page: 1, pageSize: 20, filter: 'unread' } as const;

/** Полный чек-лист рецензента: публикация без него невозможна. */
const FULL_CHECKLIST: Record<string, boolean> = Object.fromEntries(
  REVIEW_CHECKLIST_ITEMS.map((item) => [item, true]),
);

const CREATOR_PERMISSIONS: readonly OrgPermission[] = ['assessments.manage', 'reports.read'];
const REVIEWER_PERMISSIONS: readonly OrgPermission[] = ['reports.review'];

/** Ошибка прикладного кода: проверяем код, а не текст сообщения. */
async function expectAppError(work: Promise<unknown>, code: string): Promise<AppError> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );

  expect(error, 'ожидалась ошибка, но вызов завершился успешно').toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

function revisionContent(assignmentId: string, summary: string): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    scenarioCode: 'retention_conditions',
    caseCode: caseCodeFor(assignmentId),
    supportLevel: 'partial',
    summary,
    decisionNotes: [],
    findings: [
      {
        id: 'finding_synthetic',
        statement: 'Сотрудник назвал условия, которые считает важными.',
        evidenceIds: ['ev_1'],
        kind: 'self_report',
        limitations: [],
      },
    ],
    contradictions: [],
    limitations: ['Пригодность для кадровых решений не подтверждена.'],
    nextActions: [],
    reconsiderWhen: [],
    prediction: null,
  };
}

/** Новая ревизия на проверке: публикация работает только с такой. */
async function createPendingRevision(
  revisionNo: number,
  summary: string,
  target: { reportId: string; assignmentId: string } = {
    reportId: ids.reportId,
    assignmentId: ids.assignmentId,
  },
): Promise<void> {
  await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
    await tx.report_revisions.create({
      data: {
        organization_id: ids.organizationId,
        report_id: target.reportId,
        revision_no: revisionNo,
        state: 'pending_review',
        generation_mode: 'template',
        content_json: toJson(revisionContent(target.assignmentId, summary)),
        content_hash: contentHash({ revision: revisionNo, summary, report: target.reportId }),
      },
    });
  });
}

/** Идентификатор опубликованной ревизии: по нему строится ключ события. */
async function publishedRevisionId(reportId: string): Promise<string> {
  const report = await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) =>
    tx.reports.findFirst({
      where: { id: reportId, organization_id: ids.organizationId },
      select: { current_published_revision_id: true },
    }),
  );

  expect(report?.current_published_revision_id, 'заключение не опубликовано').toBeTruthy();
  return report!.current_published_revision_id!;
}

/**
 * Повторная обработка той же публикации: продюсер идемпотентен, поэтому
 * вставка с тем же ключом события ничего не добавляет.
 */
async function reprocessPublication(revisionId: string, recipientUserId: string): Promise<number> {
  const result = await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) =>
    tx.notifications.createMany({
      data: [
        {
          organization_id: ids.organizationId,
          recipient_user_id: recipientUserId,
          type: 'report_published',
          resource_type: 'report',
          resource_id: ids.reportId,
          title: NOTIFICATION_TITLES.report_published,
          event_key: notificationEventKey('report_published', revisionId),
        },
      ],
      skipDuplicates: true,
    }),
  );

  return result.count;
}

async function countOwn(userId: string, organizationId = ids.organizationId): Promise<number> {
  const result = await notifications.list(organizationId, userId, PAGE);
  return result.total;
}

beforeAll(async () => {
  prisma = createPrismaClient('api');

  const prismaService = Object.create(PrismaService.prototype) as PrismaService;
  Object.defineProperty(prismaService, 'client', { value: prisma, writable: false });

  const audit = new AuditService(prismaService);
  reports = new ReportsService(prismaService, audit);
  notifications = new NotificationsService(prismaService, audit);

  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');

  await withPlatformOps(prisma, async (tx) => {
    const organization = await tx.organizations.create({
      data: { name: 'ООО «Синтетика Уведомлений»', code: `notify_${suffix}`, mode: 'demo' },
      select: { id: true },
    });
    ids.organizationId = organization.id;

    const other = await tx.organizations.create({
      data: { name: 'ООО «Синтетика Соседняя»', code: `notify_o_${suffix}`, mode: 'demo' },
      select: { id: true },
    });
    ids.otherOrganizationId = other.id;

    const creator = await tx.users.create({
      data: {
        email_normalized: `notify.creator.${suffix}@synthetic.invalid`,
        email_display: `notify.creator.${suffix}@synthetic.invalid`,
        display_name: 'Руководитель-автор назначения (тест уведомлений)',
        status: 'active',
      },
      select: { id: true },
    });
    ids.creatorId = creator.id;

    const reviewer = await tx.users.create({
      data: {
        email_normalized: `notify.reviewer.${suffix}@synthetic.invalid`,
        email_display: `notify.reviewer.${suffix}@synthetic.invalid`,
        display_name: 'Рецензент (тест уведомлений)',
        status: 'active',
      },
      select: { id: true },
    });
    ids.reviewerId = reviewer.id;

    const stranger = await tx.users.create({
      data: {
        email_normalized: `notify.stranger.${suffix}@synthetic.invalid`,
        email_display: `notify.stranger.${suffix}@synthetic.invalid`,
        display_name: 'Руководитель соседней организации (тест уведомлений)',
        status: 'active',
      },
      select: { id: true },
    });
    ids.strangerId = stranger.id;

    const revoked = await tx.users.create({
      data: {
        email_normalized: `notify.revoked.${suffix}@synthetic.invalid`,
        email_display: `notify.revoked.${suffix}@synthetic.invalid`,
        display_name: 'Руководитель с отозванным доступом (тест уведомлений)',
        status: 'active',
      },
      select: { id: true },
    });
    ids.revokedId = revoked.id;

    await tx.memberships.createMany({
      data: [
        {
          organization_id: organization.id,
          user_id: creator.id,
          permissions: [...CREATOR_PERMISSIONS],
          status: 'active',
        },
        {
          organization_id: organization.id,
          user_id: reviewer.id,
          permissions: [...REVIEWER_PERMISSIONS],
          status: 'active',
        },
        {
          organization_id: other.id,
          user_id: stranger.id,
          permissions: ['reports.read'],
          status: 'active',
        },
        {
          // Membership отозван: маршруты уведомлений ответят ему 404.
          organization_id: organization.id,
          user_id: revoked.id,
          permissions: [...CREATOR_PERMISSIONS],
          status: 'revoked',
        },
      ],
    });

    const policy = await tx.reporting_policies.create({
      data: {
        stable_code: `notify_policy_${suffix}`,
        semantic_version: '1.0.0',
        permitted_claims: toJson(['описание условий работы со слов сотрудника']),
        required_limitations: toJson(['Пригодность для кадровых решений не подтверждена.']),
        forbidden_claims: toJson(['прогноз вероятности ухода']),
      },
      select: { id: true },
    });

    const scenario = await tx.scenarios.create({
      data: { stable_code: `retention_conditions_${suffix}`, title: 'Условия удержания' },
      select: { id: true },
    });

    const version = await tx.scenario_versions.create({
      data: {
        scenario_id: scenario.id,
        semantic_version: '1.0.0',
        status: 'published',
        applicability_mode: 'demo',
        context_schema_json: toJson({
          fields: [
            {
              key: 'decisionQuestion',
              label: 'Какое решение вы принимаете',
              type: 'textarea',
              required: true,
              isOpinion: false,
              evidenceRole: 'context',
            },
          ],
        }),
        reporting_policy_id: policy.id,
        content_hash: contentHash({ scenario: 'notify', suffix }),
        published_at: new Date(),
      },
      select: { id: true },
    });
    ids.scenarioVersionId = version.id;
  });

  await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
    const employee = await tx.employees.create({
      data: {
        organization_id: ids.organizationId,
        display_name: 'Синтетический Сотрудник',
        external_code: `NOTIFY-${suffix}`,
      },
      select: { id: true },
    });
    ids.employeeId = employee.id;

    const assignment = await tx.assignments.create({
      data: {
        organization_id: ids.organizationId,
        employee_id: employee.id,
        scenario_version_id: ids.scenarioVersionId,
        context_snapshot: toJson({ decisionQuestion: 'Синтетический вопрос руководителя.' }),
        mode: 'demo',
        state: 'completed',
        created_by: ids.creatorId,
      },
      select: { id: true },
    });
    ids.assignmentId = assignment.id;

    // Назначение со сроком через сутки: попадает в окно предупреждения.
    const expiring = await tx.assignments.create({
      data: {
        organization_id: ids.organizationId,
        employee_id: employee.id,
        scenario_version_id: ids.scenarioVersionId,
        context_snapshot: toJson({ decisionQuestion: 'Второй синтетический вопрос.' }),
        mode: 'demo',
        state: 'invited',
        due_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        created_by: ids.creatorId,
      },
      select: { id: true },
    });
    ids.expiringAssignmentId = expiring.id;

    await tx.evidence_items.create({
      data: {
        organization_id: ids.organizationId,
        assignment_id: assignment.id,
        evidence_code: 'ev_1',
        kind: 'self_report',
        collected_at: new Date(),
        normalized_content: toJson({
          text: 'Синтетический ответ участника для проверки уведомлений.',
        }),
        limitations: toJson(['Слова сотрудника, не проверенный факт.']),
        content_hash: contentHash({ evidence: 'notify', suffix }),
      },
    });

    const report = await tx.reports.create({
      data: {
        organization_id: ids.organizationId,
        assignment_id: assignment.id,
        status: 'pending_review',
      },
      select: { id: true },
    });
    ids.reportId = report.id;

    // Назначение автора с отозванным membership: заключение по нему готово,
    // но уведомлять его некуда.
    const revokedAssignment = await tx.assignments.create({
      data: {
        organization_id: ids.organizationId,
        employee_id: employee.id,
        scenario_version_id: ids.scenarioVersionId,
        context_snapshot: toJson({ decisionQuestion: 'Третий синтетический вопрос.' }),
        mode: 'demo',
        state: 'completed',
        created_by: ids.revokedId,
      },
      select: { id: true },
    });

    const revokedReport = await tx.reports.create({
      data: {
        organization_id: ids.organizationId,
        assignment_id: revokedAssignment.id,
        status: 'pending_review',
      },
      select: { id: true },
    });
    ids.revokedReportId = revokedReport.id;

    await tx.report_revisions.create({
      data: {
        organization_id: ids.organizationId,
        report_id: revokedReport.id,
        revision_no: 1,
        state: 'pending_review',
        generation_mode: 'template',
        content_json: toJson(
          revisionContent(revokedAssignment.id, 'Синтетическая записка отозванного автора.'),
        ),
        content_hash: contentHash({ revision: 1, report: revokedReport.id }),
      },
    });
  });

  // Заключение соседней организации: ссылка на него из чужого уведомления
  // не должна открываться.
  await withTenant(prisma, { organizationId: ids.otherOrganizationId }, async (tx) => {
    const employee = await tx.employees.create({
      data: {
        organization_id: ids.otherOrganizationId,
        display_name: 'Синтетический Сотрудник соседней организации',
        external_code: `NOTIFY-O-${suffix}`,
      },
      select: { id: true },
    });

    const assignment = await tx.assignments.create({
      data: {
        organization_id: ids.otherOrganizationId,
        employee_id: employee.id,
        scenario_version_id: ids.scenarioVersionId,
        context_snapshot: toJson({ decisionQuestion: 'Синтетический вопрос соседей.' }),
        mode: 'demo',
        state: 'completed',
        created_by: ids.strangerId,
      },
      select: { id: true },
    });

    const report = await tx.reports.create({
      data: {
        organization_id: ids.otherOrganizationId,
        assignment_id: assignment.id,
        status: 'published',
        published_at: new Date(),
      },
      select: { id: true },
    });
    ids.otherReportId = report.id;
  });

  await createPendingRevision(1, 'Синтетическая записка для проверки уведомлений.');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Создание уведомлений после события', () => {
  it('публикация заключения уведомляет автора назначения и не раскрывает текста', async () => {
    await reports.publish(
      ids.organizationId,
      ids.reportId,
      ids.reviewerId,
      FULL_CHECKLIST,
      'Проверено по чек-листу.',
    );

    const inbox = await notifications.list(ids.organizationId, ids.creatorId, PAGE);

    expect(inbox.total).toBe(1);
    const notification = inbox.items[0]!;
    expect(notification.type).toBe('report_published');
    expect(notification.title).toBe(NOTIFICATION_TITLES.report_published);
    expect(notification.resourceType).toBe('report');
    expect(notification.resourceId).toBe(ids.reportId);
    expect(notification.readAt).toBeNull();
    // Записка заключения в уведомление не попадает.
    expect(JSON.stringify(notification)).not.toContain('Синтетическая записка');
  });

  it('исправленная версия заключения уведомляет заново, а повтор той же публикации — нет', async () => {
    const firstRevisionId = await publishedRevisionId(ids.reportId);

    await createPendingRevision(2, 'Исправленная синтетическая записка.');
    await reports.publish(
      ids.organizationId,
      ids.reportId,
      ids.reviewerId,
      FULL_CHECKLIST,
      'Исправление проверено.',
    );

    const secondRevisionId = await publishedRevisionId(ids.reportId);
    expect(secondRevisionId).not.toBe(firstRevisionId);

    /*
     * Выпуск исправленной версии — отдельное событие: руководитель, сам
     * запросивший исправление, обязан узнать, что оно вышло. Ключ события
     * строится по опубликованной ревизии, поэтому уведомлений два.
     */
    const inbox = await notifications.list(ids.organizationId, ids.creatorId, PAGE);
    const published = inbox.items.filter((item) => item.type === 'report_published');
    expect(published).toHaveLength(2);
    expect(new Set(published.map((item) => item.id)).size).toBe(2);

    // Повторная обработка той же публикации второго уведомления не создаёт.
    expect(await reprocessPublication(secondRevisionId, ids.creatorId)).toBe(0);
    expect(await countOwn(ids.creatorId)).toBe(2);
  });

  it('автору с отозванным membership уведомление не создаётся', async () => {
    await reports.publish(
      ids.organizationId,
      ids.revokedReportId,
      ids.reviewerId,
      FULL_CHECKLIST,
      'Проверено по чек-листу.',
    );

    // Мёртвая запись не нужна: маршруты уведомлений ответят такому адресату 404.
    expect(await countOwn(ids.revokedId)).toBe(0);
  });

  it('запрос на исправление уведомляет рецензента, но не автора запроса', async () => {
    const before = await countOwn(ids.creatorId);

    await reports.requestCorrection(ids.organizationId, ids.reportId, ids.creatorId, {
      blockKey: 'findings',
      description: 'Синтетическое описание неточности для проверки уведомлений.',
    });

    const reviewerInbox = await notifications.list(ids.organizationId, ids.reviewerId, PAGE);
    const revision = reviewerInbox.items.find((item) => item.type === 'revision_requested');

    expect(revision).toBeDefined();
    expect(revision!.title).toBe(NOTIFICATION_TITLES.revision_requested);
    expect(revision!.resourceId).toBe(ids.reportId);
    // Свободный текст запроса в уведомление не переносится.
    expect(JSON.stringify(reviewerInbox.items)).not.toContain('Синтетическое описание');

    expect(await countOwn(ids.creatorId)).toBe(before);
  });

  it('предупреждение о сроке ссылается на назначение и не дублируется', async () => {
    // Само задание проверяется в наборе worker; здесь важно, что уведомление
    // о сроке попадает в тот же ящик и отделено ключом события.
    const eventKey = notificationEventKey('assignment_expiring', ids.expiringAssignmentId);

    const inserted = await withTenant(prisma, { organizationId: ids.organizationId }, (tx) =>
      tx.notifications.createMany({
        data: [0, 1].map(() => ({
          organization_id: ids.organizationId,
          recipient_user_id: ids.creatorId,
          type: 'assignment_expiring',
          resource_type: 'assignment',
          resource_id: ids.expiringAssignmentId,
          title: NOTIFICATION_TITLES.assignment_expiring,
          event_key: eventKey,
        })),
        skipDuplicates: true,
      }),
    );

    expect(inserted.count).toBe(1);

    const inbox = await notifications.list(ids.organizationId, ids.creatorId, PAGE);
    const expiring = inbox.items.filter((item) => item.type === 'assignment_expiring');

    expect(expiring).toHaveLength(1);
    expect(expiring[0]!.resourceType).toBe('assignment');
    expect(expiring[0]!.resourceId).toBe(ids.expiringAssignmentId);
    expect(expiring[0]!.title).toBe(NOTIFICATION_TITLES.assignment_expiring);
  });
});

describe('Изоляция получателей и организаций', () => {
  it('чужие уведомления в списке не появляются', async () => {
    const reviewerInbox = await notifications.list(ids.organizationId, ids.reviewerId, PAGE);

    expect(reviewerInbox.items.every((item) => item.type === 'revision_requested')).toBe(true);
    expect(reviewerInbox.items.some((item) => item.type === 'report_published')).toBe(false);
  });

  it('руководитель соседней организации не видит уведомлений этой организации', async () => {
    expect(await countOwn(ids.strangerId, ids.otherOrganizationId)).toBe(0);
    expect(await countOwn(ids.strangerId, ids.organizationId)).toBe(0);
  });

  it('уведомление получателя не видно в контексте другой организации', async () => {
    expect(await countOwn(ids.creatorId, ids.otherOrganizationId)).toBe(0);
  });

  it('чужое уведомление нельзя отметить прочитанным', async () => {
    const inbox = await notifications.list(ids.organizationId, ids.creatorId, PAGE);
    const foreign = inbox.items[0]!;

    await expectAppError(
      notifications.markRead(ids.organizationId, ids.reviewerId, foreign.id),
      'NOT_FOUND',
    );

    const stillUnread = await notifications.list(ids.organizationId, ids.creatorId, UNREAD_PAGE);
    expect(stillUnread.items.some((item) => item.id === foreign.id)).toBe(true);
  });
});

describe('Счётчик и отметка прочитанным', () => {
  it('счётчик совпадает со списком непрочитанных', async () => {
    const unread = await notifications.list(ids.organizationId, ids.creatorId, UNREAD_PAGE);
    const counter = await notifications.unreadCount(ids.organizationId, ids.creatorId);

    expect(counter.unread).toBe(unread.total);
    expect(counter.unread).toBeGreaterThan(0);
  });

  it('отметка прочитанным идемпотентна', async () => {
    const unread = await notifications.list(ids.organizationId, ids.creatorId, UNREAD_PAGE);
    const target = unread.items[0]!;
    const before = await notifications.unreadCount(ids.organizationId, ids.creatorId);

    const first = await notifications.markRead(ids.organizationId, ids.creatorId, target.id);
    const second = await notifications.markRead(ids.organizationId, ids.creatorId, target.id);

    expect(first.notification.readAt).not.toBeNull();
    // Повторный вызов момент прочтения не переписывает и счётчик не двигает.
    expect(second.notification.readAt).toBe(first.notification.readAt);
    expect(first.unread).toBe(before.unread - 1);
    expect(second.unread).toBe(first.unread);
  });

  it('прочитанное уведомление исчезает из фильтра unread, но остаётся в all', async () => {
    const unread = await notifications.list(ids.organizationId, ids.creatorId, UNREAD_PAGE);
    const all = await notifications.list(ids.organizationId, ids.creatorId, PAGE);

    expect(all.total).toBeGreaterThan(unread.total);
  });

  it('«отметить все» очищает счётчик получателя и не трогает чужой', async () => {
    const reviewerBefore = await notifications.unreadCount(ids.organizationId, ids.reviewerId);
    expect(reviewerBefore.unread).toBeGreaterThan(0);

    const result = await notifications.markAllRead(ids.organizationId, ids.creatorId);

    expect(result.updated).toBeGreaterThan(0);
    expect(result.unread).toBe(0);
    expect((await notifications.unreadCount(ids.organizationId, ids.creatorId)).unread).toBe(0);
    expect((await notifications.unreadCount(ids.organizationId, ids.reviewerId)).unread).toBe(
      reviewerBefore.unread,
    );

    // Повторный вызов ничего не меняет: обновлять уже нечего.
    const repeat = await notifications.markAllRead(ids.organizationId, ids.creatorId);
    expect(repeat.updated).toBe(0);
  });
});

describe('Открытие ресурса с повторной проверкой доступа', () => {
  it('готовое заключение открывается получателем с правом чтения', async () => {
    const inbox = await notifications.list(ids.organizationId, ids.creatorId, PAGE);
    const published = inbox.items.find((item) => item.type === 'report_published')!;

    const target = await notifications.open(
      ids.organizationId,
      { userId: ids.creatorId, permissions: CREATOR_PERMISSIONS },
      published.id,
    );

    expect(target.status).toBe('available');
    expect(target.path).toBe(`/app/reports/${ids.reportId}`);
  });

  it('назначение открывается на странице оценки', async () => {
    const inbox = await notifications.list(ids.organizationId, ids.creatorId, PAGE);
    const expiring = inbox.items.find((item) => item.type === 'assignment_expiring')!;

    const target = await notifications.open(
      ids.organizationId,
      { userId: ids.creatorId, permissions: CREATOR_PERMISSIONS },
      expiring.id,
    );

    expect(target.status).toBe('available');
    expect(target.path).toBe(`/app/assessments/${ids.expiringAssignmentId}`);
  });

  it('запрос на исправление ведёт рецензента на страницу проверки', async () => {
    const inbox = await notifications.list(ids.organizationId, ids.reviewerId, PAGE);
    const revision = inbox.items.find((item) => item.type === 'revision_requested')!;

    const target = await notifications.open(
      ids.organizationId,
      { userId: ids.reviewerId, permissions: REVIEWER_PERMISSIONS },
      revision.id,
    );

    expect(target.status).toBe('available');
    expect(target.path).toBe(`/app/reviews/${ids.reportId}`);
  });

  it('отозванное право закрывает ресурс без утечки содержания', async () => {
    const inbox = await notifications.list(ids.organizationId, ids.creatorId, PAGE);
    const published = inbox.items.find((item) => item.type === 'report_published')!;

    // Право reports.read отозвано: уведомление осталось, доступ — нет.
    const target = await notifications.open(
      ids.organizationId,
      { userId: ids.creatorId, permissions: ['assessments.manage'] },
      published.id,
    );

    expect(target.status).toBe('unavailable');
    expect(target.path).toBeNull();
    expect(target.message).not.toContain('Синтетическая');
  });

  it('удалённый ресурс отвечает так же, как отозванный доступ', async () => {
    const missingReportId = randomUUID();

    const notificationId = await withTenant(
      prisma,
      { organizationId: ids.organizationId },
      async (tx) => {
        const created = await tx.notifications.create({
          data: {
            organization_id: ids.organizationId,
            recipient_user_id: ids.creatorId,
            type: 'report_published',
            resource_type: 'report',
            resource_id: missingReportId,
            title: NOTIFICATION_TITLES.report_published,
            event_key: `report_published:${missingReportId}`,
          },
          select: { id: true },
        });
        return created.id;
      },
    );

    const target = await notifications.open(
      ids.organizationId,
      { userId: ids.creatorId, permissions: CREATOR_PERMISSIONS },
      notificationId,
    );

    expect(target.status).toBe('unavailable');
    expect(target.path).toBeNull();
  });

  it('ссылка на ресурс другой организации не открывается', async () => {
    const notificationId = await withTenant(
      prisma,
      { organizationId: ids.organizationId },
      async (tx) => {
        const created = await tx.notifications.create({
          data: {
            organization_id: ids.organizationId,
            recipient_user_id: ids.creatorId,
            type: 'report_published',
            resource_type: 'report',
            resource_id: ids.otherReportId,
            title: NOTIFICATION_TITLES.report_published,
            event_key: `report_published:${ids.otherReportId}`,
          },
          select: { id: true },
        });
        return created.id;
      },
    );

    const target = await notifications.open(
      ids.organizationId,
      { userId: ids.creatorId, permissions: CREATOR_PERMISSIONS },
      notificationId,
    );

    expect(target.status).toBe('unavailable');
    expect(target.path).toBeNull();
  });

  it('открытие отмечает уведомление прочитанным', async () => {
    const notificationId = await withTenant(
      prisma,
      { organizationId: ids.organizationId },
      async (tx) => {
        const created = await tx.notifications.create({
          data: {
            organization_id: ids.organizationId,
            recipient_user_id: ids.creatorId,
            type: 'report_published',
            resource_type: 'report',
            resource_id: ids.reportId,
            title: NOTIFICATION_TITLES.report_published,
            event_key: `report_published:open:${randomUUID()}`,
          },
          select: { id: true },
        });
        return created.id;
      },
    );

    await notifications.open(
      ids.organizationId,
      { userId: ids.creatorId, permissions: CREATOR_PERMISSIONS },
      notificationId,
    );

    const unread = await notifications.list(ids.organizationId, ids.creatorId, UNREAD_PAGE);
    expect(unread.items.some((item) => item.id === notificationId)).toBe(false);
  });

  it('неудачное открытие не съедает непрочитанное и возвращает счётчик', async () => {
    const missingReportId = randomUUID();

    const notificationId = await withTenant(
      prisma,
      { organizationId: ids.organizationId },
      async (tx) => {
        const created = await tx.notifications.create({
          data: {
            organization_id: ids.organizationId,
            recipient_user_id: ids.creatorId,
            type: 'report_published',
            resource_type: 'report',
            resource_id: missingReportId,
            title: NOTIFICATION_TITLES.report_published,
            event_key: `report_published:unread:${missingReportId}`,
          },
          select: { id: true },
        });
        return created.id;
      },
    );

    const target = await notifications.open(
      ids.organizationId,
      { userId: ids.creatorId, permissions: CREATOR_PERMISSIONS },
      notificationId,
    );

    expect(target.status).toBe('unavailable');
    // Пользователь ничего не получил: пометка непрочитанного остаётся за ним.
    const unread = await notifications.list(ids.organizationId, ids.creatorId, UNREAD_PAGE);
    expect(unread.items.some((item) => item.id === notificationId)).toBe(true);
    expect(target.unread).toBe(
      (await notifications.unreadCount(ids.organizationId, ids.creatorId)).unread,
    );
  });

  it('уведомление без ресурса не сообщает об удалении или отзыве доступа', async () => {
    const notificationId = await withTenant(
      prisma,
      { organizationId: ids.organizationId },
      async (tx) => {
        const created = await tx.notifications.create({
          data: {
            organization_id: ids.organizationId,
            recipient_user_id: ids.creatorId,
            type: 'export_ready',
            resource_type: null,
            resource_id: null,
            title: NOTIFICATION_TITLES.export_ready,
            event_key: `export_ready:${randomUUID()}`,
          },
          select: { id: true },
        });
        return created.id;
      },
    );

    const target = await notifications.open(
      ids.organizationId,
      { userId: ids.creatorId, permissions: CREATOR_PERMISSIONS },
      notificationId,
    );

    // Отказ по несуществующему ресурсу — для сравнения текстов.
    const missingId = await withTenant(
      prisma,
      { organizationId: ids.organizationId },
      async (tx) => {
        const created = await tx.notifications.create({
          data: {
            organization_id: ids.organizationId,
            recipient_user_id: ids.creatorId,
            type: 'report_published',
            resource_type: 'report',
            resource_id: randomUUID(),
            title: NOTIFICATION_TITLES.report_published,
            event_key: `report_published:compare:${randomUUID()}`,
          },
          select: { id: true },
        });
        return created.id;
      },
    );

    const missing = await notifications.open(
      ids.organizationId,
      { userId: ids.creatorId, permissions: CREATOR_PERMISSIONS },
      missingId,
    );

    expect(target.status).toBe('unavailable');
    expect(target.path).toBeNull();
    /*
     * Неразличимыми обязаны быть «удалено» и «доступ отозван». У события, для
     * которого страницы не предполагалось, скрывать нечего, и общий текст про
     * удаление или отзыв доступа был бы прямой дезинформацией.
     */
    expect(target.message).not.toBe(missing.message);
    expect(target.message).not.toContain('больше не открывается');
  });

  it('чужое уведомление открыть нельзя', async () => {
    const inbox = await notifications.list(ids.organizationId, ids.creatorId, PAGE);
    const foreign = inbox.items[0]!;

    await expectAppError(
      notifications.open(
        ids.organizationId,
        { userId: ids.reviewerId, permissions: REVIEWER_PERMISSIONS },
        foreign.id,
      ),
      'NOT_FOUND',
    );
  });
});

describe('Заголовок уведомления пишет сервер', () => {
  it('свободный текст в колонке title наружу не выходит', async () => {
    const freeText = 'Синтетический свободный текст руководителя в заголовке';

    const notificationId = await withTenant(
      prisma,
      { organizationId: ids.organizationId },
      async (tx) => {
        const created = await tx.notifications.create({
          data: {
            organization_id: ids.organizationId,
            recipient_user_id: ids.creatorId,
            type: 'report_published',
            resource_type: 'report',
            resource_id: ids.reportId,
            // Продюсер, нарушивший правило: в колонке пользовательский текст.
            title: freeText,
            event_key: `report_published:title:${randomUUID()}`,
          },
          select: { id: true },
        });
        return created.id;
      },
    );

    const inbox = await notifications.list(ids.organizationId, ids.creatorId, PAGE);
    const item = inbox.items.find((row) => row.id === notificationId)!;

    // Заголовок собирается по типу события, поэтому канал утечки закрыт
    // чтением, а не дисциплиной продюсеров.
    expect(item.title).toBe(NOTIFICATION_TITLES.report_published);
    expect(JSON.stringify(inbox.items)).not.toContain('свободный текст');
  });
});

describe('Запрос на исправление доступен рецензенту', () => {
  it('рецензент читает блок и текст запроса по заключению', async () => {
    const corrections = await reports.listCorrections(ids.organizationId, ids.reportId);

    expect(corrections.length).toBeGreaterThan(0);
    const request = corrections[0]!;
    expect(request.blockKey).toBe('findings');
    expect(request.blockLabel).toBeTruthy();
    expect(request.state).toBe('received');
    expect(request.stateLabel).toBeTruthy();
    // Свободный текст выдаётся здесь — за разрешением reports.review, а не в уведомлении.
    expect(request.description).toContain('Синтетическое описание');
  });

  it('заключение другой организации запросов не отдаёт', async () => {
    await expectAppError(
      reports.listCorrections(ids.organizationId, ids.otherReportId),
      'NOT_FOUND',
    );
  });

  it('уведомление о запросе не ведёт туда, где запроса нет', async () => {
    // Заключение существует, но запросов на исправление по нему нет:
    // открывать рецензенту нечего.
    const notificationId = await withTenant(
      prisma,
      { organizationId: ids.organizationId },
      async (tx) => {
        const created = await tx.notifications.create({
          data: {
            organization_id: ids.organizationId,
            recipient_user_id: ids.reviewerId,
            type: 'revision_requested',
            resource_type: 'report',
            resource_id: ids.revokedReportId,
            title: NOTIFICATION_TITLES.revision_requested,
            event_key: `revision_requested:absent:${randomUUID()}`,
          },
          select: { id: true },
        });
        return created.id;
      },
    );

    const target = await notifications.open(
      ids.organizationId,
      { userId: ids.reviewerId, permissions: REVIEWER_PERMISSIONS },
      notificationId,
    );

    expect(target.status).toBe('unavailable');
    expect(target.path).toBeNull();
  });
});

describe('Дедупликация на уровне базы', () => {
  it('повторная вставка того же события тому же адресату отклоняется', async () => {
    const eventKey = `report_published:dedup:${randomUUID()}`;

    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      await tx.notifications.create({
        data: {
          organization_id: ids.organizationId,
          recipient_user_id: ids.creatorId,
          type: 'report_published',
          resource_type: 'report',
          resource_id: ids.reportId,
          title: NOTIFICATION_TITLES.report_published,
          event_key: eventKey,
        },
      });
    });

    const duplicate = await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) =>
      tx.notifications.createMany({
        data: [
          {
            organization_id: ids.organizationId,
            recipient_user_id: ids.creatorId,
            type: 'report_published',
            resource_type: 'report',
            resource_id: ids.reportId,
            title: NOTIFICATION_TITLES.report_published,
            event_key: eventKey,
          },
          {
            // Тот же ключ события, другой адресат — это другое уведомление.
            organization_id: ids.organizationId,
            recipient_user_id: ids.reviewerId,
            type: 'report_published',
            resource_type: 'report',
            resource_id: ids.reportId,
            title: NOTIFICATION_TITLES.report_published,
            event_key: eventKey,
          },
        ],
        skipDuplicates: true,
      }),
    );

    expect(duplicate.count).toBe(1);
  });
});

describe('Журнал открытий отличает отказ от события без страницы', () => {
  /** Исходы записей `notification.opened` по ресурсу. */
  async function openOutcomes(resourceId: string): Promise<string[]> {
    return withPlatformOps(prisma, async (tx) => {
      const rows = await tx.audit_events.findMany({
        where: { action: 'notification.opened', resource_id: resourceId },
        orderBy: { occurred_at: 'asc' },
        select: { outcome: true },
      });
      return rows.map((row) => row.outcome);
    });
  }

  it('уведомление без страницы не пишется как отказ, а недоступный ресурс — пишется', async () => {
    const targetless = await withTenant(
      prisma,
      { organizationId: ids.organizationId },
      async (tx) => {
        const created = await tx.notifications.create({
          data: {
            organization_id: ids.organizationId,
            recipient_user_id: ids.creatorId,
            type: 'deletion_completed',
            resource_type: null,
            resource_id: null,
            title: NOTIFICATION_TITLES.deletion_completed,
            event_key: `deletion_completed:audit:${randomUUID()}`,
          },
          select: { id: true },
        });
        return created.id;
      },
    );

    await notifications.open(
      ids.organizationId,
      { userId: ids.creatorId, permissions: CREATOR_PERMISSIONS },
      targetless,
    );

    /*
     * Ничего не отказано: страницы у события не предполагалось. Ложные
     * `denied` копились бы на каждом открытии такого уведомления, и настоящие
     * отказы перестали бы быть заметны в журнале безопасности.
     */
    expect(await openOutcomes(targetless)).toEqual(['success']);

    const missingReportId = randomUUID();
    const denied = await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      const created = await tx.notifications.create({
        data: {
          organization_id: ids.organizationId,
          recipient_user_id: ids.creatorId,
          type: 'report_published',
          resource_type: 'report',
          resource_id: missingReportId,
          title: NOTIFICATION_TITLES.report_published,
          event_key: `report_published:audit:${missingReportId}`,
        },
        select: { id: true },
      });
      return created.id;
    });

    await notifications.open(
      ids.organizationId,
      { userId: ids.creatorId, permissions: CREATOR_PERMISSIONS },
      denied,
    );

    // Цель была, открыть не дали — это настоящий отказ.
    expect(await openOutcomes(missingReportId)).toEqual(['denied']);
  });

  it('схема не принимает ни неизвестный тип ресурса, ни идентификатор без типа', async () => {
    const insert = (data: { resourceType: string | null; resourceId: string | null }) =>
      withTenant(prisma, { organizationId: ids.organizationId }, async (tx) =>
        tx.notifications.create({
          data: {
            organization_id: ids.organizationId,
            recipient_user_id: ids.creatorId,
            type: 'report_published',
            resource_type: data.resourceType,
            resource_id: data.resourceId,
            title: NOTIFICATION_TITLES.report_published,
            event_key: `report_published:constraint:${randomUUID()}`,
          },
          select: { id: true },
        }),
      );

    // Ограничение 0019: чтение может обращаться с нераспознанным типом строго,
    // потому что база такую строку не принимает.
    await expect(insert({ resourceType: 'employee', resourceId: randomUUID() })).rejects.toThrow();
    await expect(insert({ resourceType: null, resourceId: randomUUID() })).rejects.toThrow();
    await expect(insert({ resourceType: 'report', resourceId: null })).rejects.toThrow();
  });
});
