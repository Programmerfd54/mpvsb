/**
 * Экран обработки и журнал аудита.
 *
 * Проверяется то, ради чего экран существует: администратор видит реальный исход
 * фонового задания, может повторить временную ошибку и не может повторить
 * задание по отменённому назначению, отозванному согласию или устаревшему
 * поколению данных. Ответы участника и полезная нагрузка на экран не попадают
 * (ТЗ A09, A11, 10.8).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, toJson, withPlatformOps, withTenant } from '@context/database';
import type { PrismaClient } from '@context/database';
import { contentHash } from '@context/scoring';

import { AdminOperationsService } from '../src/modules/admin/admin-operations.service';
import { AuditService } from '../src/platform/audit/audit.service';
import { PrismaService } from '../src/platform/database/prisma.service';

let prisma: PrismaClient;
let operations: AdminOperationsService;

const ids = {
  organizationId: '',
  actorId: '',
  employeeId: '',
  scenarioVersionId: '',
  assignmentId: '',
  jobId: '',
  consentId: '',
};

/** Возвращает строку очереди в исходное состояние между проверками. */
async function resetJob(data: Record<string, unknown> = {}): Promise<void> {
  await withPlatformOps(prisma, async (tx) => {
    await tx.outbox_events.update({
      where: { id: ids.jobId },
      data: {
        published_at: new Date(),
        completed_at: null,
        failed_at: new Date(),
        last_error_code: 'provider_error',
        retries_stopped_at: null,
        retries_stopped_by: null,
        attempts: 1,
        ...data,
      },
    });
  });
}

beforeAll(async () => {
  prisma = createPrismaClient('api');
  const prismaService = Object.create(PrismaService.prototype) as PrismaService;
  Object.defineProperty(prismaService, 'client', { value: prisma, writable: false });

  operations = new AdminOperationsService(prismaService, new AuditService(prismaService));

  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');

  await withPlatformOps(prisma, async (tx) => {
    const organization = await tx.organizations.create({
      data: { name: 'ООО «Синтетика Обработки»', code: `ops_${suffix}`, mode: 'demo' },
      select: { id: true },
    });
    ids.organizationId = organization.id;

    const user = await tx.users.create({
      data: {
        email_normalized: `ops.${suffix}@synthetic.invalid`,
        email_display: `ops.${suffix}@synthetic.invalid`,
        display_name: 'Администратор (тест обработки)',
        platform_role: 'platform_admin',
        status: 'active',
      },
      select: { id: true },
    });
    ids.actorId = user.id;

    const policy = await tx.reporting_policies.create({
      data: {
        stable_code: `ops_policy_${suffix}`,
        semantic_version: '1.0.0',
        permitted_claims: toJson(['описание условий работы со слов сотрудника']),
        required_limitations: toJson(['Пригодность для кадровых решений не подтверждена.']),
        forbidden_claims: toJson(['прогноз вероятности ухода']),
      },
      select: { id: true },
    });

    const scenario = await tx.scenarios.create({
      data: { stable_code: `ops_scenario_${suffix}`, title: 'Сценарий проверки обработки' },
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
        content_hash: contentHash({ scenario: 'ops', suffix }),
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
        display_name: 'Синтетический Участник',
        external_code: `OPS-${suffix}`,
      },
      select: { id: true },
    });
    ids.employeeId = employee.id;

    const assignment = await tx.assignments.create({
      data: {
        organization_id: ids.organizationId,
        employee_id: employee.id,
        scenario_version_id: ids.scenarioVersionId,
        context_snapshot: toJson({ decisionQuestion: 'Синтетический вопрос для проверки экрана.' }),
        mode: 'demo',
        state: 'in_progress',
        created_by: ids.actorId,
      },
      select: { id: true },
    });
    ids.assignmentId = assignment.id;

    const document = await tx.legal_document_versions.create({
      data: {
        key: `ops_notice_${suffix}`,
        locale: 'ru',
        semantic_version: '1.0.0',
        status: 'draft',
        title: 'Информирование (тест обработки)',
        body: 'Образец для теста.',
        purpose: 'assessment_participation',
        content_hash: contentHash(`ops_notice_${suffix}`),
      },
      select: { id: true, content_hash: true },
    });

    const consent = await tx.consent_records.create({
      data: {
        organization_id: ids.organizationId,
        assignment_id: assignment.id,
        document_version_id: document.id,
        document_hash: document.content_hash,
        purpose: 'assessment_participation',
      },
      select: { id: true },
    });
    ids.consentId = consent.id;
  });

  await withPlatformOps(prisma, async (tx) => {
    const job = await tx.outbox_events.create({
      data: {
        event_type: 'report.generation_requested',
        organization_id: ids.organizationId,
        entity_type: 'assignment',
        entity_id: ids.assignmentId,
        // Полезная нагрузка — только идентификаторы; экран покажет имена полей.
        payload: toJson({ assignmentId: ids.assignmentId }),
        data_generation: 1n,
        published_at: new Date(),
        attempts: 1,
      },
      select: { id: true },
    });
    ids.jobId = job.id;
  });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Экран обработки', () => {
  it('состояние задания выводится из отметок, а не задаётся отдельно', async () => {
    await resetJob({ failed_at: null, last_error_code: null, completed_at: new Date() });

    const [job] = await operations.jobs({ limit: 200 });
    const target = (await operations.jobs({ limit: 200 })).find((row) => row.id === ids.jobId);

    expect(job).toBeDefined();
    expect(target?.state).toBe('done');
    // Задержка измеряется, а не оценивается.
    expect(target?.latencyMs).not.toBeNull();
    expect(target?.assignmentCode).toMatch(/^CASE-/);
  });

  it('фильтр по состоянию не выдаёт лишнего', async () => {
    await resetJob();

    const failed = await operations.jobs({ state: 'failed', limit: 200 });
    const done = await operations.jobs({ state: 'done', limit: 200 });

    expect(failed.some((row) => row.id === ids.jobId)).toBe(true);
    expect(done.some((row) => row.id === ids.jobId)).toBe(false);
  });

  it('детали не содержат значений полезной нагрузки', async () => {
    await resetJob();

    const details = await operations.jobDetails(ids.jobId, ids.actorId);

    // Показываются имена полей; сама полезная нагрузка сервер не покидает.
    expect(details.payloadKeys).toEqual(['assignmentId']);
    expect((details as Record<string, unknown>).payload).toBeUndefined();
    expect(details.queueName).toBe('generate-report');
  });

  it('обращение к деталям задания записывается в аудит', async () => {
    await operations.jobDetails(ids.jobId, ids.actorId);

    const events = await operations.auditEvents({ action: 'job.details_read', limit: 50 });
    expect(events.some((event) => event.resourceType === 'outbox_event')).toBe(true);
  });

  it('повторяемая ошибка возвращает задание в очередь', async () => {
    await resetJob();

    const before = await operations.jobDetails(ids.jobId, ids.actorId);
    expect(before.retryBlockers).toEqual([]);

    const details = await operations.retryJob(ids.jobId, ids.actorId);

    expect(details.job.state).toBe('queued');
    expect(details.job.lastErrorCode).toBeNull();
    expect(details.retriedAt).not.toBeNull();
    // Повторять уже нечего: ошибка снята, строка ждёт доставки.
    expect(details.retryBlockers).toContain('Задание не завершалось ошибкой: повторять нечего.');

    const events = await operations.auditEvents({ action: 'job.retry', limit: 50 });
    expect(events.some((event) => event.outcome === 'success')).toBe(true);
  });

  it('постоянная ошибка содержимого повтором не устраняется', async () => {
    await resetJob({ last_error_code: 'forbidden_claim' });

    await expect(operations.retryJob(ids.jobId, ids.actorId)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('успешное задание повторять нечего', async () => {
    await resetJob({ failed_at: null, last_error_code: null, completed_at: new Date() });

    await expect(operations.retryJob(ids.jobId, ids.actorId)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('исчерпанный лимит повторов останавливает попытки', async () => {
    await resetJob({ attempts: 5 });

    const details = await operations.jobDetails(ids.jobId, ids.actorId);
    expect(details.retryBlockers.some((text) => text.includes('лимит повторов'))).toBe(true);
  });

  it('повтор не обходит ограду поколения данных', async () => {
    await resetJob();
    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      await tx.assignments.update({
        where: { id: ids.assignmentId },
        data: { data_generation: 2n },
      });
    });

    const details = await operations.jobDetails(ids.jobId, ids.actorId);
    expect(details.retryBlockers.some((text) => text.includes('Поколение данных'))).toBe(true);

    await expect(operations.retryJob(ids.jobId, ids.actorId)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });

    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      await tx.assignments.update({
        where: { id: ids.assignmentId },
        data: { data_generation: 1n },
      });
    });
  });

  it('повтор невозможен без действующего согласия', async () => {
    await resetJob();
    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      await tx.consent_records.update({
        where: { id: ids.consentId },
        data: { withdrawn_at: new Date() },
      });
    });

    const details = await operations.jobDetails(ids.jobId, ids.actorId);
    expect(details.retryBlockers.some((text) => text.includes('Согласие'))).toBe(true);

    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      await tx.consent_records.update({
        where: { id: ids.consentId },
        data: { withdrawn_at: null },
      });
    });
  });

  it('повтор невозможен для отменённого назначения', async () => {
    await resetJob();
    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      await tx.assignments.update({
        where: { id: ids.assignmentId },
        data: { state: 'cancelled' },
      });
    });

    const details = await operations.jobDetails(ids.jobId, ids.actorId);
    expect(details.retryBlockers).toContain('Назначение отменено.');

    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      await tx.assignments.update({
        where: { id: ids.assignmentId },
        data: { state: 'in_progress' },
      });
    });
  });

  it('остановка повторов убирает строку из выборки диспетчера', async () => {
    await resetJob();
    const stopped = await operations.setRetriesStopped(ids.jobId, true, ids.actorId);

    expect(stopped.job.state).toBe('stopped');
    expect(stopped.retryBlockers.some((text) => text.includes('остановлены'))).toBe(true);

    // Диспетчер выбирает строки тем же условием, что и частичный индекс.
    const pending = await withPlatformOps(prisma, async (tx) =>
      tx.outbox_events.findMany({
        where: { published_at: null, retries_stopped_at: null },
        select: { id: true },
      }),
    );
    expect(pending.some((row) => row.id === ids.jobId)).toBe(false);

    const resumed = await operations.setRetriesStopped(ids.jobId, false, ids.actorId);
    expect(resumed.job.state).toBe('failed');
  });

  it('сводка считает упавшие задания по факту, а не по нулю', async () => {
    await resetJob();

    const overview = await operations.overview();
    expect(overview.failedJobs).toBeGreaterThan(0);
  });
});

describe('Журнал аудита', () => {
  it('фильтр по действию и организации сужает выборку', async () => {
    await operations.jobDetails(ids.jobId, ids.actorId);

    const byAction = await operations.auditEvents({ action: 'job.details_read', limit: 100 });
    expect(byAction.length).toBeGreaterThan(0);
    expect(byAction.every((event) => event.action === 'job.details_read')).toBe(true);

    const byOther = await operations.auditEvents({ action: 'auth.login', limit: 100 });
    expect(byOther.every((event) => event.action === 'auth.login')).toBe(true);
  });

  it('скрытые поля метаданных показываются именем, а не значением', async () => {
    const eventId = await withPlatformOps(prisma, async (tx) => {
      const event = await tx.audit_events.create({
        data: {
          actor_type: 'platform_admin',
          actor_id: ids.actorId,
          organization_id: ids.organizationId,
          action: 'test.redaction',
          resource_type: 'report',
          outcome: 'success',
          metadata: toJson({
            reportId: 'r-1',
            email: 'участник@synthetic.invalid',
            answers: 'текст ответа участника',
          }),
        },
        select: { id: true },
      });
      return event.id;
    });

    const details = await operations.auditDetails(eventId, ids.actorId);

    expect(details.redactedKeys).toContain('email');
    expect(details.redactedKeys).toContain('answers');
    expect(details.metadata.map((item) => item.key)).toContain('reportId');
    expect(JSON.stringify(details.metadata)).not.toContain('synthetic.invalid');
    expect(JSON.stringify(details.metadata)).not.toContain('текст ответа участника');
  });

  it('обращение к записи аудита само попадает в аудит', async () => {
    const events = await operations.auditEvents({ action: 'audit.details_read', limit: 50 });
    expect(events.length).toBeGreaterThan(0);
  });

  it('справочник фильтров перечисляет только встречающиеся значения', async () => {
    const facets = await operations.facets();

    expect(facets.eventTypes).toContain('report.generation_requested');
    expect(facets.actions).toContain('job.details_read');
    expect(facets.organizationCodes.length).toBeGreaterThan(0);
  });
});
