/**
 * Временный доступ администратора платформы к данным организации (ТЗ A03, M13, 10.4).
 *
 * Проверяется то, ради чего механизм существует: администратор сам себе доступ
 * не открывает, решение принимает владелец организации, срок и объём
 * ограничены, отзыв и истечение закрывают доступ немедленно, а каждое чтение
 * и каждая неуспешная привилегированная попытка попадают в журнал. Все
 * участники синтетические.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, toJson, withPlatformOps, withTenant } from '@context/database';
import type { PrismaClient } from '@context/database';
import { NOTIFICATION_TITLES, caseCodeFor, type OrgPermission } from '@context/domain';
import { contentHash } from '@context/scoring';

import { AccessGrantsService } from '../src/modules/access-grants/access-grants.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import {
  AdminAccessGrantsController,
  OrgAccessGrantsController,
} from '../src/modules/access-grants/access-grants.controller';
import { AdminGuard } from '../src/platform/auth/guards/admin.guard';
import { isGrantLiveFor } from '../src/modules/access-grants/grant-guard';
import { ReportsService } from '../src/modules/reports/reports.service';
import { AuditService } from '../src/platform/audit/audit.service';
import { PrismaService } from '../src/platform/database/prisma.service';
import { PERMISSIONS_KEY } from '../src/platform/auth/decorators';
import { AppError } from '../src/platform/errors/app-error';

let prisma: PrismaClient;
let grants: AccessGrantsService;
let reports: ReportsService;
let audit: AuditService;
let notifications: NotificationsService;

const ids = {
  organizationId: '',
  otherOrganizationId: '',
  adminId: '',
  ownerId: '',
  plainManagerId: '',
  otherOwnerId: '',
  employeeId: '',
  scenarioVersionId: '',
  assignmentId: '',
  secondAssignmentId: '',
  otherAssignmentId: '',
  reportId: '',
};

/** Первая страница списка: пагинация проверяется отдельно. */
const PAGE = { page: 1, pageSize: 20 } as const;

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

/** События журнала по обращению. Читается напрямую: экран аудита проверяется отдельно. */
async function auditActions(resourceId: string): Promise<string[]> {
  return withPlatformOps(prisma, async (tx) => {
    const rows = await tx.audit_events.findMany({
      where: { resource_id: resourceId },
      orderBy: { occurred_at: 'asc' },
      select: { action: true },
    });
    return rows.map((row) => row.action);
  });
}

async function createRequest(assignmentIds: string[] = [ids.assignmentId]) {
  return grants.request(ids.organizationId, ids.adminId, {
    purpose: 'report_review',
    reason: 'Разбор жалобы на подготовку заключения по синтетическому случаю.',
    assignmentIds,
    requestedHours: 2,
  });
}

beforeAll(async () => {
  prisma = createPrismaClient('api');
  const prismaService = Object.create(PrismaService.prototype) as PrismaService;
  Object.defineProperty(prismaService, 'client', { value: prisma, writable: false });

  audit = new AuditService(prismaService);
  reports = new ReportsService(prismaService, audit);
  grants = new AccessGrantsService(prismaService, audit, reports);
  notifications = new NotificationsService(prismaService, audit);

  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');

  await withPlatformOps(prisma, async (tx) => {
    const organization = await tx.organizations.create({
      data: { name: 'ООО «Синтетика Доступа»', code: `grant_${suffix}`, mode: 'demo' },
      select: { id: true },
    });
    ids.organizationId = organization.id;

    const other = await tx.organizations.create({
      data: { name: 'ООО «Синтетика Соседняя»', code: `grant_o_${suffix}`, mode: 'demo' },
      select: { id: true },
    });
    ids.otherOrganizationId = other.id;

    const admin = await tx.users.create({
      data: {
        email_normalized: `grant.admin.${suffix}@synthetic.invalid`,
        email_display: `grant.admin.${suffix}@synthetic.invalid`,
        display_name: 'Администратор платформы (тест доступа)',
        platform_role: 'platform_admin',
        status: 'active',
      },
      select: { id: true },
    });
    ids.adminId = admin.id;

    const owner = await tx.users.create({
      data: {
        email_normalized: `grant.owner.${suffix}@synthetic.invalid`,
        email_display: `grant.owner.${suffix}@synthetic.invalid`,
        display_name: 'Владелец организации (тест доступа)',
        status: 'active',
      },
      select: { id: true },
    });
    ids.ownerId = owner.id;

    const plain = await tx.users.create({
      data: {
        email_normalized: `grant.manager.${suffix}@synthetic.invalid`,
        email_display: `grant.manager.${suffix}@synthetic.invalid`,
        display_name: 'Руководитель без прав владельца (тест доступа)',
        status: 'active',
      },
      select: { id: true },
    });
    ids.plainManagerId = plain.id;

    const otherOwner = await tx.users.create({
      data: {
        email_normalized: `grant.owner2.${suffix}@synthetic.invalid`,
        email_display: `grant.owner2.${suffix}@synthetic.invalid`,
        display_name: 'Владелец соседней организации (тест доступа)',
        status: 'active',
      },
      select: { id: true },
    });
    ids.otherOwnerId = otherOwner.id;

    await tx.memberships.createMany({
      data: [
        {
          organization_id: organization.id,
          user_id: owner.id,
          permissions: ['org.manage', 'employees.manage', 'reports.read'],
          status: 'active',
        },
        {
          organization_id: organization.id,
          user_id: plain.id,
          permissions: ['employees.manage', 'reports.read'],
          status: 'active',
        },
        {
          // Администратор платформы одновременно состоит в организации с правами
          // владельца: запрет решения по собственному обращению должен работать
          // и в этом случае.
          organization_id: organization.id,
          user_id: admin.id,
          permissions: ['org.manage', 'reports.read'],
          status: 'active',
        },
        {
          organization_id: other.id,
          user_id: otherOwner.id,
          permissions: ['org.manage', 'reports.read'],
          status: 'active',
        },
      ],
    });

    const policy = await tx.reporting_policies.create({
      data: {
        stable_code: `grant_policy_${suffix}`,
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
        content_hash: contentHash({ scenario: 'grant', suffix }),
        published_at: new Date(),
      },
      select: { id: true },
    });
    ids.scenarioVersionId = version.id;
  });

  // ——— Назначения и подготовленное заключение ———
  await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
    const employee = await tx.employees.create({
      data: {
        organization_id: ids.organizationId,
        display_name: 'Синтетический Сотрудник',
        external_code: `GRANT-${suffix}`,
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
        created_by: ids.ownerId,
      },
      select: { id: true },
    });
    ids.assignmentId = assignment.id;

    const second = await tx.assignments.create({
      data: {
        organization_id: ids.organizationId,
        employee_id: employee.id,
        scenario_version_id: ids.scenarioVersionId,
        context_snapshot: toJson({ decisionQuestion: 'Второй синтетический вопрос.' }),
        mode: 'demo',
        state: 'completed',
        created_by: ids.ownerId,
      },
      select: { id: true },
    });
    ids.secondAssignmentId = second.id;

    await tx.evidence_items.create({
      data: {
        organization_id: ids.organizationId,
        assignment_id: assignment.id,
        evidence_code: 'ev_1',
        kind: 'self_report',
        collected_at: new Date(),
        normalized_content: toJson({ text: 'Синтетический ответ участника для проверки доступа.' }),
        limitations: toJson(['Слова сотрудника, не проверенный факт.']),
        content_hash: contentHash({ evidence: 'grant', suffix }),
      },
    });

    const report = await tx.reports.create({
      data: {
        organization_id: ids.organizationId,
        assignment_id: assignment.id,
        status: 'published',
        published_at: new Date(),
      },
      select: { id: true },
    });
    ids.reportId = report.id;

    const revision = await tx.report_revisions.create({
      data: {
        organization_id: ids.organizationId,
        report_id: report.id,
        revision_no: 1,
        state: 'published',
        generation_mode: 'template',
        content_json: toJson({
          schemaVersion: '1.0',
          scenarioCode: 'retention_conditions',
          caseCode: caseCodeFor(assignment.id),
          supportLevel: 'partial',
          summary: 'Синтетическая записка для проверки временного доступа администратора.',
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
        }),
        content_hash: contentHash({ report: 'grant', suffix }),
        reviewer_id: ids.ownerId,
        reviewed_at: new Date(),
        published_at: new Date(),
      },
      select: { id: true },
    });

    await tx.reports.update({
      where: { id: report.id },
      data: { current_published_revision_id: revision.id },
    });
  });

  await withTenant(prisma, { organizationId: ids.otherOrganizationId }, async (tx) => {
    const employee = await tx.employees.create({
      data: {
        organization_id: ids.otherOrganizationId,
        display_name: 'Синтетический Сотрудник Соседней',
        external_code: `GRANT-O-${suffix}`,
      },
      select: { id: true },
    });

    const assignment = await tx.assignments.create({
      data: {
        organization_id: ids.otherOrganizationId,
        employee_id: employee.id,
        scenario_version_id: ids.scenarioVersionId,
        context_snapshot: toJson({ decisionQuestion: 'Вопрос соседней организации.' }),
        mode: 'demo',
        state: 'completed',
        created_by: ids.otherOwnerId,
      },
      select: { id: true },
    });
    ids.otherAssignmentId = assignment.id;
  });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Запрос временного доступа', () => {
  it('содержит причину, цель, объём назначениями и запрошенный срок', async () => {
    const grant = await createRequest();

    expect(grant.state).toBe('requested');
    expect(grant.active).toBe(false);
    expect(grant.purpose).toBe('report_review');
    expect(grant.scope.assignmentIds).toEqual([ids.assignmentId]);
    expect(grant.requestedHours).toBe(2);
    expect(grant.expiresAt).toBeNull();

    expect(await auditActions(grant.id)).toContain('access_grant.requested');
  });

  it('назначение чужой организации в объём не принимается', async () => {
    const error = await expectAppError(
      grants.request(ids.organizationId, ids.adminId, {
        purpose: 'report_review',
        reason: 'Попытка расширить объём чужим назначением для проверки.',
        assignmentIds: [ids.otherAssignmentId],
        requestedHours: 1,
      }),
      'VALIDATION_FAILED',
    );

    expect(error.fieldErrors[0]?.field).toBe('assignmentIds');
  });

  it('до решения владельца доступа к заключению нет', async () => {
    const grant = await createRequest();

    await expectAppError(
      grants.readCaseReport(grant.id, ids.assignmentId, ids.adminId),
      'FORBIDDEN',
    );

    expect(await auditActions(grant.id)).toContain('access_grant.read_denied');
  });
});

describe('Решение владельца организации', () => {
  it('полный цикл: запрос → выдача → чтение → отзыв', async () => {
    const requested = await createRequest();

    // useRequestedHours — согласие владельца с запрошенным сроком (2 часа).
    const approved = await grants.approve(ids.organizationId, requested.id, ids.ownerId, {
      hours: 1,
      useRequestedHours: true,
    });
    expect(approved.state).toBe('approved');
    expect(approved.active).toBe(true);
    // Выдан именно запрошенный срок, но не больше суток.
    expect(approved.expiresAt).not.toBeNull();
    const hours =
      (new Date(approved.expiresAt!).getTime() - new Date(approved.approvedAt!).getTime()) /
      3_600_000;
    expect(hours).toBeCloseTo(2, 3);

    const cases = await grants.grantedCases(approved.id, ids.adminId);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.caseCode).toBe(caseCodeFor(ids.assignmentId));
    expect(cases[0]?.reportId).toBe(ids.reportId);

    const detail = await grants.readCaseReport(approved.id, ids.assignmentId, ids.adminId);
    // Администратору достаётся код случая, а не имя сотрудника.
    expect(detail.employeeLabel).toBe(caseCodeFor(ids.assignmentId));
    expect(detail.employeeLabel).not.toContain('Синтетический');
    expect(detail.evidence).toHaveLength(1);
    expect(detail.decisions).toEqual([]);

    const revoked = await grants.revoke(ids.organizationId, approved.id, ids.ownerId, {});
    expect(revoked.state).toBe('revoked');
    expect(revoked.active).toBe(false);

    // Отзыв действует немедленно: следующее чтение уже не проходит.
    await expectAppError(
      grants.readCaseReport(approved.id, ids.assignmentId, ids.adminId),
      'FORBIDDEN',
    );

    const actions = await auditActions(approved.id);
    expect(actions).toContain('access_grant.requested');
    expect(actions).toContain('access_grant.approved');
    expect(actions).toContain('access_grant.revoked');
    expect(await auditActions(ids.reportId)).toContain('access_grant.report_read');
  });

  it('в журнал чтения не попадает содержание заключения', async () => {
    const grant = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );
    await grants.readCaseReport(grant.id, ids.assignmentId, ids.adminId);

    const events = await withPlatformOps(prisma, async (tx) =>
      tx.audit_events.findMany({
        where: { action: 'access_grant.report_read', resource_id: ids.reportId },
        orderBy: { occurred_at: 'desc' },
        take: 1,
        select: { metadata: true, purpose: true },
      }),
    );

    const metadata = events[0]?.metadata as Record<string, unknown>;
    expect(events[0]?.purpose).toBe('report_review');
    expect(Object.keys(metadata).sort()).toEqual(['actorId', 'caseCode', 'grantId', 'revisionNo']);
    expect(JSON.stringify(metadata)).not.toContain('Синтетическая записка');
  });

  it('запрашивающий не решает по собственному обращению даже с правами владельца', async () => {
    const requested = await createRequest();

    // У администратора в этой организации есть org.manage: запрет держится
    // не правами, а правилом «не сам себе».
    await expectAppError(
      grants.approve(ids.organizationId, requested.id, ids.adminId, { hours: 1 }),
      'FORBIDDEN',
    );

    const actions = await auditActions(requested.id);
    expect(actions).toContain('access_grant.approve_denied');

    const untouched = await grants.byId(requested.id);
    expect(untouched.state).toBe('requested');
  });

  it('руководитель без org.manage выдать доступ не может', async () => {
    const requested = await createRequest();

    await expectAppError(
      grants.approve(ids.organizationId, requested.id, ids.plainManagerId, { hours: 1 }),
      'FORBIDDEN',
    );

    expect(await auditActions(requested.id)).toContain('access_grant.approve_denied');
  });

  it('маршруты решения требуют org.manage и на уровне контроллера', () => {
    for (const handler of [
      OrgAccessGrantsController.prototype.approve,
      OrgAccessGrantsController.prototype.reject,
      OrgAccessGrantsController.prototype.revoke,
      OrgAccessGrantsController.prototype.list,
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['org.manage']);
    }
  });

  it('владелец соседней организации к обращению не подступается', async () => {
    const requested = await createRequest();

    await expectAppError(
      grants.approve(ids.otherOrganizationId, requested.id, ids.otherOwnerId, { hours: 1 }),
      'NOT_FOUND',
    );

    const visible = await grants.listForOrganization(ids.otherOrganizationId, PAGE);
    expect(visible.items.some((item) => item.id === requested.id)).toBe(false);
  });

  it('отклонение закрывает обращение и объясняет причину', async () => {
    const requested = await createRequest();

    const rejected = await grants.reject(ids.organizationId, requested.id, ids.ownerId, {
      note: 'Разбор возможен на синтетических данных.',
    });

    expect(rejected.state).toBe('rejected');
    expect(rejected.active).toBe(false);
    expect(await auditActions(requested.id)).toContain('access_grant.rejected');

    // Повторное решение по закрытому обращению — конфликт, а не молчаливая перезапись.
    await expectAppError(
      grants.approve(ids.organizationId, requested.id, ids.ownerId, { hours: 1 }),
      'STATE_CONFLICT',
    );

    await expectAppError(
      grants.readCaseReport(requested.id, ids.assignmentId, ids.adminId),
      'FORBIDDEN',
    );
  });

  it('выдать доступ дольше суток нельзя ни сервером, ни базой', async () => {
    const requested = await createRequest();

    await expectAppError(
      grants.approve(ids.organizationId, requested.id, ids.ownerId, { hours: 48 }),
      'VALIDATION_FAILED',
    );

    const approved = await grants.approve(ids.organizationId, requested.id, ids.ownerId, {
      hours: 24,
    });

    await expect(
      withTenant(prisma, { organizationId: ids.organizationId }, async (tx) =>
        tx.access_grants.update({
          where: { id: approved.id },
          data: { expires_at: new Date(Date.now() + 72 * 3_600_000) },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('Границы действующего доступа', () => {
  it('истёкший срок закрывает доступ без фонового задания', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    // Сдвигаем срок в прошлое: отдельного «истёкшего» состояния нет.
    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      const past = new Date(Date.now() - 3 * 3_600_000);
      await tx.access_grants.update({
        where: { id: approved.id },
        data: { approved_at: past, expires_at: new Date(past.getTime() + 3_600_000) },
      });
    });

    const expired = await grants.byId(approved.id);
    expect(expired.state).toBe('expired');
    expect(expired.active).toBe(false);

    await expectAppError(
      grants.readCaseReport(approved.id, ids.assignmentId, ids.adminId),
      'FORBIDDEN',
    );
  });

  it('назначение вне объёма гранта не открывается', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest([ids.assignmentId])).id,
      ids.ownerId,
      { hours: 1 },
    );

    await expectAppError(
      grants.readCaseReport(approved.id, ids.secondAssignmentId, ids.adminId),
      'FORBIDDEN',
    );

    const denied = await withPlatformOps(prisma, async (tx) =>
      tx.audit_events.findFirst({
        where: { action: 'access_grant.read_denied', resource_id: ids.secondAssignmentId },
        select: { outcome: true },
      }),
    );
    expect(denied?.outcome).toBe('denied');
  });

  it('чужой грант не становится доступом другого пользователя', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    await expectAppError(
      grants.readCaseReport(approved.id, ids.assignmentId, ids.ownerId),
      'NOT_FOUND',
    );
  });
});

describe('Продление', () => {
  it('оформляется новой записью и не меняет срок прежней', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    const extension = await grants.requestExtension(ids.organizationId, approved.id, ids.adminId, {
      reason: 'Разбор не завершён: нужен ещё час на сверку источников.',
      requestedHours: 3,
    });

    expect(extension.id).not.toBe(approved.id);
    expect(extension.state).toBe('requested');
    expect(extension.extendsGrantId).toBe(approved.id);
    expect(extension.scope.assignmentIds).toEqual(approved.scope.assignmentIds);

    // Повторный запрос продления, пока прежний ждёт решения, не принимается.
    await expectAppError(
      grants.requestExtension(ids.organizationId, approved.id, ids.adminId, {
        reason: 'Повторный запрос того же продления для проверки конфликта.',
        requestedHours: 1,
      }),
      'STATE_CONFLICT',
    );

    const extended = await grants.approve(ids.organizationId, extension.id, ids.ownerId, {
      hours: 1,
    });
    expect(extended.state).toBe('approved');
    expect(extended.active).toBe(true);

    const original = await grants.byId(approved.id);
    expect(original.expiresAt).toBe(approved.expiresAt);
    expect(await auditActions(extension.id)).toEqual(
      expect.arrayContaining(['access_grant.extension_requested', 'access_grant.extended']),
    );
  });

  it('отзыв закрывает и продление: доступ не остаётся открытым', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    const extension = await grants.approve(
      ids.organizationId,
      (
        await grants.requestExtension(ids.organizationId, approved.id, ids.adminId, {
          reason: 'Нужен дополнительный срок для завершения разбора.',
          requestedHours: 2,
        })
      ).id,
      ids.ownerId,
      { hours: 1 },
    );

    await grants.revoke(ids.organizationId, approved.id, ids.ownerId, {});

    const closed = await grants.byId(extension.id);
    expect(closed.state).toBe('revoked');
    expect(closed.active).toBe(false);

    await expectAppError(
      grants.readCaseReport(extension.id, ids.assignmentId, ids.adminId),
      'FORBIDDEN',
    );
  });

  it('продлевать нечего, если доступ уже отозван', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );
    await grants.revoke(ids.organizationId, approved.id, ids.ownerId, {});

    await expectAppError(
      grants.requestExtension(ids.organizationId, approved.id, ids.adminId, {
        reason: 'Попытка продлить отозванный доступ для проверки правила.',
        requestedHours: 1,
      }),
      'STATE_CONFLICT',
    );
  });
});

describe('Изоляция данных не обходится грантом', () => {
  it('эксплуатационный режим администратора не открывает заключения', async () => {
    const visible = await withPlatformOps(prisma, async (tx) =>
      tx.reports.count({ where: { organization_id: ids.organizationId } }),
    );
    const inTenant = await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) =>
      tx.reports.count({ where: { organization_id: ids.organizationId } }),
    );

    expect(visible).toBe(0);
    expect(inTenant).toBe(1);
  });

  it('грант одной организации не виден в контексте другой', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    const seen = await withTenant(prisma, { organizationId: ids.otherOrganizationId }, async (tx) =>
      tx.access_grants.count({ where: { id: approved.id } }),
    );

    expect(seen).toBe(0);
  });

  it('база не принимает одобрение собственного обращения', async () => {
    const requested = await createRequest();

    await expect(
      withTenant(prisma, { organizationId: ids.organizationId }, async (tx) =>
        tx.access_grants.update({
          where: { id: requested.id },
          data: {
            state: 'approved',
            approved_by: ids.adminId,
            approved_at: new Date(),
            expires_at: new Date(Date.now() + 3_600_000),
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('продление не уводит цепочку в чужую организацию', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    await expect(
      withPlatformOps(prisma, async (tx) =>
        tx.access_grants.create({
          data: {
            organization_id: ids.otherOrganizationId,
            grantee_user_id: ids.adminId,
            requested_by: ids.adminId,
            purpose: 'report_review',
            reason: 'Попытка привязать продление к обращению чужой организации.',
            resource_scope: toJson({ assignmentIds: [ids.otherAssignmentId] }),
            permissions: ['reports.read_granted'],
            state: 'requested',
            extends_grant_id: approved.id,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('Закрытие доступа не обходится продлением и чужим грантом', () => {
  it('зависший запрос продления не открывает доступ после истечения родителя', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    const extension = await grants.requestExtension(ids.organizationId, approved.id, ids.adminId, {
      reason: 'Запрос продления, который останется без решения до истечения срока.',
      requestedHours: 24,
    });

    // Срок родителя уходит в прошлое: отдельного состояния «истёк» в БД нет.
    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      const past = new Date(Date.now() - 3 * 3_600_000);
      await tx.access_grants.update({
        where: { id: approved.id },
        data: { approved_at: past, expires_at: new Date(past.getTime() + 3_600_000) },
      });
    });

    await expectAppError(
      grants.approve(ids.organizationId, extension.id, ids.ownerId, { hours: 24 }),
      'STATE_CONFLICT',
    );

    // Обращение осталось нерешённым, доступ не открылся заново.
    expect((await grants.byId(extension.id)).state).toBe('requested');
    await expectAppError(
      grants.readCaseReport(extension.id, ids.assignmentId, ids.adminId),
      'FORBIDDEN',
    );
  });

  it('попытка поехать на чужом гранте попадает в журнал', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    await expectAppError(grants.grantedCases(approved.id, ids.plainManagerId), 'NOT_FOUND');

    const denied = await withPlatformOps(prisma, async (tx) =>
      tx.audit_events.findFirst({
        where: { action: 'access_grant.read_denied', resource_id: approved.id, outcome: 'denied' },
        orderBy: { occurred_at: 'desc' },
        select: { metadata: true },
      }),
    );

    expect((denied?.metadata as Record<string, unknown>).reason).toBe('not_owner');
  });

  it('обращение к несуществующему гранту тоже оставляет след', async () => {
    const unknownId = randomUUID();

    await expectAppError(grants.grantedCases(unknownId, ids.adminId), 'NOT_FOUND');

    const denied = await withPlatformOps(prisma, async (tx) =>
      tx.audit_events.findFirst({
        where: { action: 'access_grant.read_denied', resource_id: unknownId },
        select: { metadata: true, outcome: true },
      }),
    );

    expect(denied?.outcome).toBe('denied');
    expect((denied?.metadata as Record<string, unknown>).reason).toBe('unknown_grant');
  });

  it('решение в организации без membership записывается как отказ', async () => {
    const requested = await createRequest();

    await expectAppError(
      grants.approve(ids.otherOrganizationId, requested.id, ids.plainManagerId, { hours: 1 }),
      'NOT_FOUND',
    );

    const denied = await withPlatformOps(prisma, async (tx) =>
      tx.audit_events.findFirst({
        where: {
          action: 'access_grant.approve_denied',
          resource_id: requested.id,
          outcome: 'denied',
        },
        orderBy: { occurred_at: 'desc' },
        select: { metadata: true },
      }),
    );

    expect((denied?.metadata as Record<string, unknown>).reason).toBe('no_membership');
  });

  it('грант без нужного разрешения не считается действующим', async () => {
    const requested = await createRequest();

    // Поле permissions — не украшение: без reports.read_granted грант не живой.
    await withPlatformOps(prisma, async (tx) =>
      tx.access_grants.update({ where: { id: requested.id }, data: { permissions: [] } }),
    );

    const approved = await grants.approve(ids.organizationId, requested.id, ids.ownerId, {
      hours: 1,
    });

    const live = await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) =>
      isGrantLiveFor(tx, {
        organizationId: ids.organizationId,
        grantId: approved.id,
        userId: ids.adminId,
        assignmentId: ids.assignmentId,
      }),
    );

    expect(live).toBe(false);
    await expectAppError(
      grants.readCaseReport(approved.id, ids.assignmentId, ids.adminId),
      'FORBIDDEN',
    );
  });

  it('администратор сам закрывает свой доступ вместе с продлением', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    const extension = await grants.approve(
      ids.organizationId,
      (
        await grants.requestExtension(ids.organizationId, approved.id, ids.adminId, {
          reason: 'Продление, которое администратор закроет сам вместе с основным грантом.',
          requestedHours: 2,
        })
      ).id,
      ids.ownerId,
      { hours: 2 },
    );

    const closed = await grants.revokeOwn(approved.id, ids.adminId);
    expect(closed.state).toBe('revoked');
    expect((await grants.byId(extension.id)).state).toBe('revoked');

    // Чужой грант так не закрыть: ответ неотличим от «нет такого», но попытка
    // остаётся в журнале.
    await expectAppError(grants.revokeOwn(approved.id, ids.ownerId), 'NOT_FOUND');

    const denied = await withPlatformOps(prisma, async (tx) =>
      tx.audit_events.findFirst({
        where: {
          action: 'access_grant.revoke_denied',
          resource_id: approved.id,
          outcome: 'denied',
        },
        orderBy: { occurred_at: 'desc' },
        select: { metadata: true },
      }),
    );

    expect((denied?.metadata as Record<string, unknown>).reason).toBe('not_owner');
  });

  it('администратор снимает своё нерешённое обращение сам', async () => {
    const requested = await createRequest();

    const withdrawn = await grants.revokeOwn(requested.id, ids.adminId);
    expect(withdrawn.state).toBe('revoked');

    // Владельцу больше нечего решать: снятое обращение не одобряется.
    await expectAppError(
      grants.approve(ids.organizationId, requested.id, ids.ownerId, { hours: 1 }),
      'STATE_CONFLICT',
    );

    const closing = await withPlatformOps(prisma, async (tx) =>
      tx.audit_events.findFirst({
        where: {
          action: 'access_grant.revoked',
          resource_id: requested.id,
          outcome: 'success',
        },
        orderBy: { occurred_at: 'desc' },
        select: { metadata: true },
      }),
    );

    expect((closing?.metadata as Record<string, unknown>).reason).toBe('self_withdrawn');
  });

  it('продление чужого обращения и обращение не в ту организацию попадают в журнал', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    const extensionInput = {
      reason: 'Попытка продлить обращение, к которому обратившийся отношения не имеет.',
      requestedHours: 2,
    };

    // Чужой грант: получатель другой.
    await expectAppError(
      grants.requestExtension(ids.organizationId, approved.id, ids.plainManagerId, extensionInput),
      'NOT_FOUND',
    );

    const notOwner = await withPlatformOps(prisma, async (tx) =>
      tx.audit_events.findFirst({
        where: {
          action: 'access_grant.extension_denied',
          resource_id: approved.id,
          outcome: 'denied',
        },
        orderBy: { occurred_at: 'desc' },
        select: { metadata: true },
      }),
    );
    expect((notOwner?.metadata as Record<string, unknown>).reason).toBe('not_owner');

    // Свой грант, но организация в пути другая: причина отказа иная, и в
    // журнале видно, к какой организации обращались.
    await expectAppError(
      grants.requestExtension(ids.otherOrganizationId, approved.id, ids.adminId, extensionInput),
      'NOT_FOUND',
    );

    const mismatch = await withPlatformOps(prisma, async (tx) =>
      tx.audit_events.findFirst({
        where: {
          action: 'access_grant.extension_denied',
          resource_id: approved.id,
          outcome: 'denied',
        },
        orderBy: { occurred_at: 'desc' },
        select: { metadata: true },
      }),
    );
    const metadata = mismatch?.metadata as Record<string, unknown>;
    expect(metadata.reason).toBe('org_mismatch');
    expect(metadata.requestedOrganizationId).toBe(ids.otherOrganizationId);
  });

  it('использование гранта записывается, а не только отказы', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    const cases = await grants.grantedCases(approved.id, ids.adminId);
    expect(cases).toHaveLength(1);

    const listed = await withPlatformOps(prisma, async (tx) =>
      tx.audit_events.findFirst({
        where: { action: 'access_grant.cases_listed', resource_id: approved.id },
        select: { outcome: true, metadata: true },
      }),
    );

    expect(listed?.outcome).toBe('success');
    expect((listed?.metadata as Record<string, unknown>).rows).toBe(1);
  });
});

describe('Перечень назначений и страницы списков', () => {
  it('перечень назначений даёт коды случаев, но не имена сотрудников', async () => {
    const list = await grants.listOrganizationAssignments(ids.organizationId, ids.adminId, PAGE);

    expect(list.total).toBeGreaterThanOrEqual(2);
    const row = list.items.find((item) => item.assignmentId === ids.assignmentId);
    expect(row?.caseCode).toBe(caseCodeFor(ids.assignmentId));
    expect(JSON.stringify(list.items)).not.toContain('Синтетический Сотрудник');
    expect(JSON.stringify(list.items)).not.toContain('GRANT-');

    // Состояние назначения и признаки заключения в перечень не входят: для
    // выбора объёма они не нужны, а по выданному гранту видны и так.
    expect(row).not.toHaveProperty('assignmentState');
    expect(row).not.toHaveProperty('hasReport');
    expect(row).not.toHaveProperty('reportStatus');

    const otherScenario = await grants.listOrganizationAssignments(
      ids.organizationId,
      ids.adminId,
      { ...PAGE, scenarioCode: 'role_readiness' },
    );
    expect(otherScenario.total).toBe(0);

    const logged = await withPlatformOps(prisma, async (tx) =>
      tx.audit_events.findFirst({
        where: { action: 'admin.assignments_listed', resource_id: ids.organizationId },
        select: { outcome: true },
      }),
    );
    expect(logged?.outcome).toBe('success');
  });

  it('перечень назначений организации закрыт AdminGuard', () => {
    // Кросс-tenant путь данных: без роли администратора платформы маршрут
    // недоступен, а сам перечень читается узким резолвером базы.
    const guards = Reflect.getMetadata('__guards__', AdminAccessGrantsController) as unknown[];
    expect(guards).toContain(AdminGuard);
  });

  it('назначения чужой организации в перечень не попадают', async () => {
    const list = await grants.listOrganizationAssignments(
      ids.otherOrganizationId,
      ids.adminId,
      PAGE,
    );

    expect(list.items.some((item) => item.assignmentId === ids.assignmentId)).toBe(false);
  });

  it('список обращений страничный: общее число видно, записи не теряются', async () => {
    await createRequest();
    await createRequest();

    const first = await grants.listForGrantee(ids.adminId, { page: 1, pageSize: 1 });
    const second = await grants.listForGrantee(ids.adminId, { page: 2, pageSize: 1 });

    expect(first.items).toHaveLength(1);
    expect(first.total).toBeGreaterThan(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});

describe('Выбор ревизии для разбора заключения', () => {
  it('для разбора отдаётся ревизия на проверке, а не прежняя опубликованная', async () => {
    const pendingId = await withTenant(
      prisma,
      { organizationId: ids.organizationId },
      async (tx) => {
        const revision = await tx.report_revisions.create({
          data: {
            organization_id: ids.organizationId,
            report_id: ids.reportId,
            revision_no: 2,
            state: 'pending_review',
            generation_mode: 'template',
            content_json: toJson({
              schemaVersion: '1.0',
              scenarioCode: 'retention_conditions',
              caseCode: caseCodeFor(ids.assignmentId),
              supportLevel: 'partial',
              summary: 'Синтетическая записка, ожидающая проверки рецензентом.',
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
            }),
            content_hash: contentHash({ report: 'grant-pending', at: Date.now() }),
          },
          select: { id: true },
        });
        return revision.id;
      },
    );

    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    const detail = await grants.readCaseReport(approved.id, ids.assignmentId, ids.adminId);
    // Разбор просят ради ревизии на проверке: подменять её опубликованной нельзя.
    expect(detail.revisionId).toBe(pendingId);
    expect(detail.revisionState).toBe('pending_review');
  });

  it('по цели вне разбора заключения непроверенный черновик не выдаётся', async () => {
    // По второму назначению заключение есть только в виде черновика на проверке.
    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      const report = await tx.reports.create({
        data: {
          organization_id: ids.organizationId,
          assignment_id: ids.secondAssignmentId,
          status: 'pending_review',
        },
        select: { id: true },
      });

      await tx.report_revisions.create({
        data: {
          organization_id: ids.organizationId,
          report_id: report.id,
          revision_no: 1,
          state: 'pending_review',
          generation_mode: 'template',
          content_json: toJson({
            schemaVersion: '1.0',
            scenarioCode: 'retention_conditions',
            caseCode: caseCodeFor(ids.secondAssignmentId),
            supportLevel: 'partial',
            summary: 'Синтетический черновик, который ещё не проверял рецензент.',
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
          }),
          content_hash: contentHash({ report: 'grant-incident', at: Date.now() }),
        },
      });
    });

    const incident = async (assignmentId: string) =>
      grants.approve(
        ids.organizationId,
        (
          await grants.request(ids.organizationId, ids.adminId, {
            purpose: 'incident_support',
            reason: 'Разбор инцидента обработки по синтетическому случаю.',
            assignmentIds: [assignmentId],
            requestedHours: 1,
          })
        ).id,
        ids.ownerId,
        { hours: 1 },
      );

    // Цель гранта — инцидент обработки, а не разбор черновика: непроверенная
    // ревизия под неё не подпадает.
    const draftOnly = await incident(ids.secondAssignmentId);
    await expectAppError(
      grants.readCaseReport(draftOnly.id, ids.secondAssignmentId, ids.adminId),
      'NOT_FOUND',
    );

    // Опубликованное заключение по той же цели читается, и состояние ревизии
    // видно явно, а не выводится из пустого publishedAt.
    const published = await incident(ids.assignmentId);
    const detail = await grants.readCaseReport(published.id, ids.assignmentId, ids.adminId);
    expect(detail.revisionState).toBe('published');
  });
});

describe('Владелец организации узнаёт об обращении', () => {
  /** Ящик целиком: обращений за время прогона накапливается много. */
  const INBOX = { page: 1, pageSize: 100, filter: 'all' } as const;

  /** Права владельца организации: решение по обращениям — за org.manage. */
  const OWNER_PERMISSIONS: readonly OrgPermission[] = ['org.manage', 'reports.read'];

  async function inboxOf(userId: string) {
    return (await notifications.list(ids.organizationId, userId, INBOX)).items;
  }

  it('обращение уведомляет владельца, но не самого обратившегося', async () => {
    const grant = await createRequest();

    const owner = (await inboxOf(ids.ownerId)).find((item) => item.resourceId === grant.id);

    expect(
      owner,
      'обращение за доступом к данным о сотрудниках обязано дойти до владельца',
    ).toBeDefined();
    expect(owner!.type).toBe('access_grant_requested');
    expect(owner!.resourceType).toBe('access_grant');
    expect(owner!.readAt).toBeNull();

    /*
     * Администратор платформы состоит в этой организации владельцем, но
     * обращение оформил он сам: уведомлять его о собственном запросе незачем,
     * и решать по нему он всё равно не вправе.
     */
    expect((await inboxOf(ids.adminId)).some((item) => item.resourceId === grant.id)).toBe(false);

    // Руководитель без org.manage решения не принимает и адресатом не является.
    expect((await inboxOf(ids.plainManagerId)).some((item) => item.resourceId === grant.id)).toBe(
      false,
    );
  });

  it('в уведомлении нет ни причины, ни цели обращения', async () => {
    const grant = await grants.request(ids.organizationId, ids.adminId, {
      purpose: 'incident_support',
      reason: 'Синтетическая причина обращения, которой не место в уведомлении.',
      assignmentIds: [ids.assignmentId],
      requestedHours: 1,
    });

    const owner = (await inboxOf(ids.ownerId)).find((item) => item.resourceId === grant.id)!;

    expect(owner.title).toBe(NOTIFICATION_TITLES.access_grant_requested);
    // Свободный текст выдаётся только на странице доступов, за org.manage.
    expect(JSON.stringify(owner)).not.toContain('Синтетическая причина');
    expect(JSON.stringify(owner)).not.toContain('incident_support');
  });

  it('продление уведомляет заново: это отдельное обращение со своим решением', async () => {
    const approved = await grants.approve(
      ids.organizationId,
      (await createRequest()).id,
      ids.ownerId,
      { hours: 1 },
    );

    const extension = await grants.requestExtension(ids.organizationId, approved.id, ids.adminId, {
      reason: 'Синтетическое продление: разбор не завершён.',
      requestedHours: 1,
    });

    const inbox = await inboxOf(ids.ownerId);
    expect(inbox.some((item) => item.resourceId === approved.id)).toBe(true);
    expect(inbox.some((item) => item.resourceId === extension.id)).toBe(true);
  });

  it('уведомление ведёт на страницу доступов, а без org.manage — никуда', async () => {
    const grant = await createRequest();
    const owner = (await inboxOf(ids.ownerId)).find((item) => item.resourceId === grant.id)!;

    const target = await notifications.open(
      ids.organizationId,
      { userId: ids.ownerId, permissions: OWNER_PERMISSIONS },
      owner.id,
    );

    expect(target.status).toBe('available');
    expect(target.path).toBe('/app/settings');

    // Право проверяется в момент открытия: отозванный org.manage закрывает
    // переход, хотя уведомление осталось в ящике.
    const withoutPermission = await notifications.open(
      ids.organizationId,
      { userId: ids.ownerId, permissions: ['reports.read'] },
      owner.id,
    );

    expect(withoutPermission.status).toBe('unavailable');
    expect(withoutPermission.path).toBeNull();
  });
});
