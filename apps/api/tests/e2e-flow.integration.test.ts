/**
 * Сквозной путь платформы на реальной базе.
 *
 * Проверяется то, ради чего существует система: руководитель задаёт вопрос,
 * сотрудник отвечает по персональной ссылке, ответы считаются, готовится
 * заключение, человек его проверяет и публикует, руководитель читает результат.
 *
 * Фоновые задания вызываются напрямую, без очереди: тест проверяет бизнес-путь,
 * а не доставку сообщений — её проверяет отдельный набор.
 */
import { randomUUID } from 'node:crypto';

import argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPrismaClient,
  toJson,
  withPlatformOps,
  withTenant,
  type PrismaClient,
} from '@context/database';
import {
  SYNTHETIC_METHODS,
  SYNTHETIC_REPORTING_POLICIES,
  SYNTHETIC_SCENARIOS,
} from '@context/testing';
import { contentHash } from '@context/scoring';
import { reportContentSchema } from '@context/contracts';

import { handleGenerateReport, handleScoreAttempt } from '../../worker/src/jobs/handlers';
import { runGenerateReport } from '../../worker/src/jobs/generate-report';
import { runScoreAttempt } from '../../worker/src/jobs/score-attempt';

const ARGON2 = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

let prisma: PrismaClient;
let workerPrisma: PrismaClient;

const ids = {
  organizationId: '',
  otherOrganizationId: '',
  managerId: '',
  reviewerId: '',
  employeeId: '',
  scenarioVersionId: '',
  assignmentId: '',
  reportId: '',
};

beforeAll(async () => {
  process.env.REPORT_PROVIDER = 'fake';
  prisma = createPrismaClient('api');
  workerPrisma = createPrismaClient('worker');

  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');

  // ——— Организации и учётные записи ———
  await withPlatformOps(prisma, async (tx) => {
    const org = await tx.organizations.create({
      data: { name: 'ООО «Тест Альфа»', code: `t_alpha_${suffix}`, mode: 'demo' },
      select: { id: true },
    });
    const other = await tx.organizations.create({
      data: { name: 'ООО «Тест Бета»', code: `t_beta_${suffix}`, mode: 'demo' },
      select: { id: true },
    });
    ids.organizationId = org.id;
    ids.otherOrganizationId = other.id;

    // Фиксированное значение для временной тестовой базы, которая пересоздаётся
    // перед каждым прогоном. Секретом не является и нигде больше не используется.
    const passwordHash = await argon2.hash('Synthetic-Test-Password-1', ARGON2);

    const manager = await tx.users.create({
      data: {
        email_normalized: `manager.${suffix}@synthetic.invalid`,
        email_display: `manager.${suffix}@synthetic.invalid`,
        display_name: 'Руководитель (тест)',
        password_hash: passwordHash,
        status: 'active',
      },
      select: { id: true },
    });
    const reviewer = await tx.users.create({
      data: {
        email_normalized: `reviewer.${suffix}@synthetic.invalid`,
        email_display: `reviewer.${suffix}@synthetic.invalid`,
        display_name: 'Рецензент (тест)',
        password_hash: passwordHash,
        status: 'active',
      },
      select: { id: true },
    });
    ids.managerId = manager.id;
    ids.reviewerId = reviewer.id;

    await tx.memberships.createMany({
      data: [
        {
          organization_id: org.id,
          user_id: manager.id,
          permissions: ['org.manage', 'employees.manage', 'assessments.manage', 'reports.read'],
          status: 'active',
        },
        {
          organization_id: org.id,
          user_id: reviewer.id,
          permissions: ['reports.read', 'reports.review'],
          status: 'active',
        },
      ],
    });
  });

  // ——— Содержимое: методики, политика отчёта, сценарий ———
  await withPlatformOps(prisma, async (tx) => {
    const methodVersionIds = new Map<string, string>();

    for (const method of SYNTHETIC_METHODS) {
      const methodRow = await tx.methods.create({
        data: { stable_code: `${method.code}_${suffix}`, title: method.passport.title },
        select: { id: true },
      });
      const version = await tx.method_versions.create({
        data: {
          method_id: methodRow.id,
          semantic_version: method.semanticVersion,
          status: 'published',
          applicability_mode: 'demo',
          passport_json: toJson(method.passport),
          items_json: toJson(method.items),
          scoring_config_json: toJson(method.scoring),
          missing_policy: method.scoring.missingPolicy,
          content_hash: contentHash({ code: method.code, suffix }),
          published_at: new Date(),
        },
        select: { id: true },
      });
      methodVersionIds.set(method.code, version.id);
    }

    const scenario = SYNTHETIC_SCENARIOS.find((item) => item.code === 'role_readiness')!;
    const policy = SYNTHETIC_REPORTING_POLICIES.find(
      (item) => item.code === scenario.reportingPolicyCode,
    )!;

    const policyRow = await tx.reporting_policies.create({
      data: {
        stable_code: `${policy.code}_${suffix}`,
        semantic_version: policy.semanticVersion,
        permitted_claims: toJson(policy.permittedClaims),
        required_limitations: toJson(policy.requiredLimitations),
        forbidden_claims: toJson(policy.forbiddenClaims),
      },
      select: { id: true },
    });

    // Код сценария остаётся настоящим: он входит в заключение и проверяется
    // по перечислению. Суффикс здесь сломал бы проверку выхода — и это
    // правильное поведение валидатора, поэтому подменять его нельзя.
    const scenarioRow = await tx.scenarios.upsert({
      where: { stable_code: scenario.code },
      create: { stable_code: scenario.code, title: scenario.title },
      update: {},
      select: { id: true },
    });

    const version = await tx.scenario_versions.create({
      data: {
        scenario_id: scenarioRow.id,
        semantic_version: `1.0.${Date.now() % 1000}`,
        status: 'published',
        applicability_mode: 'demo',
        context_schema_json: toJson(scenario.contextSchema),
        reporting_policy_id: policyRow.id,
        content_hash: contentHash({ code: scenario.code, suffix }),
        published_at: new Date(),
      },
      select: { id: true },
    });

    await tx.scenario_methods.createMany({
      data: scenario.methodCodes.map((code, index) => ({
        scenario_version_id: version.id,
        method_version_id: methodVersionIds.get(code)!,
        order_index: index,
        required: true,
      })),
    });

    ids.scenarioVersionId = version.id;
  });

  // ——— Сотрудник ———
  await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
    const employee = await tx.employees.create({
      data: {
        organization_id: ids.organizationId,
        display_name: 'Синтетический Участник',
        external_code: `T-${suffix}`,
        job_title: 'Аналитик',
      },
      select: { id: true },
    });
    ids.employeeId = employee.id;
  });
}, 90_000);

afterAll(async () => {
  await prisma.$disconnect();
  await workerPrisma.$disconnect();
});

describe('Сквозной путь: назначение → участие → подсчёт → заключение', () => {
  it('руководитель создаёт назначение с закреплёнными методиками', async () => {
    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      const methods = await tx.scenario_methods.findMany({
        where: { scenario_version_id: ids.scenarioVersionId },
        orderBy: { order_index: 'asc' },
        select: { method_version_id: true, order_index: true },
      });

      const assignment = await tx.assignments.create({
        data: {
          organization_id: ids.organizationId,
          employee_id: ids.employeeId,
          scenario_version_id: ids.scenarioVersionId,
          context_snapshot: toJson({
            decisionQuestion: 'Проверяем готовность сотрудника к роли координатора направления',
            decisionHorizon: '2027-01-01',
            currentRole: 'Аналитик',
            targetRole: 'Координатор направления',
            newResponsibilities: 'Планирование загрузки команды',
            successCriteria: 'Сроки согласованы заранее',
            workFacts: 'В сентябре вёл два проекта, оба сданы в срок.',
            managerOpinion: 'Мне кажется, человеку не хватает уверенности.',
          }),
          mode: 'demo',
          state: 'invited',
          due_at: new Date(Date.now() + 14 * 86_400_000),
          created_by: ids.managerId,
        },
        select: { id: true },
      });

      await tx.attempts.createMany({
        data: methods.map((method) => ({
          organization_id: ids.organizationId,
          assignment_id: assignment.id,
          method_version_id: method.method_version_id,
          order_index: method.order_index,
          required: true,
          state: 'not_started',
        })),
      });

      ids.assignmentId = assignment.id;

      const attempts = await tx.attempts.count({
        where: { organization_id: ids.organizationId, assignment_id: assignment.id },
      });
      expect(attempts).toBe(methods.length);
    });
  });

  it('участник отвечает, ответы фиксируются неизменяемым снимком', async () => {
    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      // Согласие обязательно до сохранения ответов.
      const document = await tx.legal_document_versions.create({
        data: {
          key: `notice_${randomUUID().slice(0, 8)}`,
          locale: 'ru',
          semantic_version: '1.0.0',
          status: 'draft',
          title: 'Информирование (тест)',
          body: 'Образец для теста.',
          purpose: 'assessment_participation',
          content_hash: contentHash('Образец для теста.'),
        },
        select: { id: true, content_hash: true },
      });

      await tx.consent_records.create({
        data: {
          organization_id: ids.organizationId,
          assignment_id: ids.assignmentId,
          document_version_id: document.id,
          document_hash: document.content_hash,
          purpose: 'assessment_participation',
        },
      });

      const attempts = await tx.attempts.findMany({
        where: { organization_id: ids.organizationId, assignment_id: ids.assignmentId },
        orderBy: { order_index: 'asc' },
        select: { id: true, method_versions: { select: { items_json: true } } },
      });

      for (const attempt of attempts) {
        const items = attempt.method_versions.items_json as Array<Record<string, unknown>>;
        const answers: Record<string, unknown> = {};

        for (const item of items) {
          const itemId = String(item['id']);
          const type = String(item['type']);
          const response =
            type === 'likert'
              ? { type: 'likert', value: Number(item['max']) - 1 }
              : type === 'single_choice'
                ? {
                    type: 'single_choice',
                    optionId: (item['options'] as Array<{ id: string }>)[0]!.id,
                  }
                : type === 'multiple_choice'
                  ? {
                      type: 'multiple_choice',
                      optionIds: [(item['options'] as Array<{ id: string }>)[0]!.id],
                    }
                  : type === 'short_text'
                    ? { type: 'short_text', text: 'Синтетический ответ.' }
                    : {
                        type: 'situational',
                        ...((item['response'] as { kind: string }).kind === 'single_choice'
                          ? {
                              optionId: (item['response'] as { options: Array<{ id: string }> })
                                .options[0]!.id,
                            }
                          : { text: 'Синтетический ответ на ситуацию.' }),
                      };

          answers[itemId] = response;
          await tx.answers.create({
            data: {
              organization_id: ids.organizationId,
              attempt_id: attempt.id,
              item_id: itemId,
              response_json: toJson(response),
            },
          });
        }

        await tx.attempts.update({
          where: { id: attempt.id },
          data: { state: 'submitted', submitted_at: new Date() },
        });

        await tx.submission_snapshots.create({
          data: {
            organization_id: ids.organizationId,
            attempt_id: attempt.id,
            answers_snapshot_json: toJson(answers),
            input_hash: contentHash(answers),
            consent_hash: document.content_hash,
          },
        });
      }

      await tx.assignments.update({
        where: { id: ids.assignmentId },
        data: { state: 'completed', completed_at: new Date() },
      });
    });
  });

  it('подсчёт идемпотентен: повторный запуск не создаёт второй результат', async () => {
    const attempts = await withTenant(prisma, { organizationId: ids.organizationId }, (tx) =>
      tx.attempts.findMany({
        where: { organization_id: ids.organizationId, assignment_id: ids.assignmentId },
        select: { id: true },
      }),
    );

    for (const attempt of attempts) {
      // Первый подсчёт — через обработчик очереди: он же записывает исход
      // в строку outbox, из которой экран обработки узнаёт, чем всё кончилось.
      const job = await withPlatformOps(prisma, (tx) =>
        tx.outbox_events.create({
          data: {
            event_type: 'attempt.submitted',
            organization_id: ids.organizationId,
            entity_type: 'attempt',
            entity_id: attempt.id,
            data_generation: 1n,
            published_at: new Date(),
            attempts: 1,
          },
          select: { id: true },
        }),
      );

      const first = await handleScoreAttempt(workerPrisma, {
        organizationId: ids.organizationId,
        entityId: attempt.id,
        dataGeneration: '1',
        outboxId: job.id,
      });
      expect(first.status).toBe('scored');

      const outcome = await withPlatformOps(prisma, (tx) =>
        tx.outbox_events.findUniqueOrThrow({
          where: { id: job.id },
          select: { completed_at: true, failed_at: true },
        }),
      );
      expect(outcome.completed_at).not.toBeNull();
      expect(outcome.failed_at).toBeNull();

      const second = await runScoreAttempt(workerPrisma, {
        organizationId: ids.organizationId,
        entityId: attempt.id,
        dataGeneration: '1',
      });
      expect(second.status).toBe('already_scored');
    }

    const results = await withTenant(prisma, { organizationId: ids.organizationId }, (tx) =>
      tx.score_results.count({
        where: {
          organization_id: ids.organizationId,
          attempts: { assignment_id: ids.assignmentId },
        },
      }),
    );
    expect(results).toBe(attempts.length);
  });

  it('устаревшее поколение данных не сохраняет результат', async () => {
    const attempt = await withTenant(prisma, { organizationId: ids.organizationId }, (tx) =>
      tx.attempts.findFirstOrThrow({
        where: { organization_id: ids.organizationId, assignment_id: ids.assignmentId },
        select: { id: true },
      }),
    );

    const result = await runScoreAttempt(workerPrisma, {
      organizationId: ids.organizationId,
      entityId: attempt.id,
      // Назначение живёт в поколении 1: задание из другого поколения пропускается.
      dataGeneration: '99',
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('Поколение данных');
  });

  it('заключение готовится, ссылается только на существующие свидетельства', async () => {
    // Через обработчик очереди: экран обработки должен узнать исход задания.
    const job = await withPlatformOps(prisma, (tx) =>
      tx.outbox_events.create({
        data: {
          event_type: 'report.generation_requested',
          organization_id: ids.organizationId,
          entity_type: 'assignment',
          entity_id: ids.assignmentId,
          data_generation: 1n,
          published_at: new Date(),
          attempts: 1,
        },
        select: { id: true },
      }),
    );

    const result = (await handleGenerateReport(workerPrisma, {
      organizationId: ids.organizationId,
      entityId: ids.assignmentId,
      dataGeneration: '1',
      outboxId: job.id,
    })) as { status: string; reportId?: string };

    expect(result.status).toBe('drafted');

    // Исход записан обратно в очередь: без этого сводка показывала бы ноль.
    const outcome = await withPlatformOps(prisma, (tx) =>
      tx.outbox_events.findUniqueOrThrow({
        where: { id: job.id },
        select: { completed_at: true, failed_at: true, last_error_code: true },
      }),
    );
    expect(outcome.completed_at).not.toBeNull();
    expect(outcome.failed_at).toBeNull();
    expect(outcome.last_error_code).toBeNull();
    ids.reportId = result.reportId!;

    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      const revision = await tx.report_revisions.findFirstOrThrow({
        where: { organization_id: ids.organizationId, report_id: ids.reportId },
        orderBy: { revision_no: 'desc' },
        select: { state: true, content_json: true, generation_mode: true },
      });

      expect(revision.state).toBe('pending_review');

      const content = reportContentSchema.parse(revision.content_json);
      const evidence = await tx.evidence_items.findMany({
        where: { organization_id: ids.organizationId, assignment_id: ids.assignmentId },
        select: { evidence_code: true, kind: true },
      });

      const known = new Set(evidence.map((item) => item.evidence_code));
      for (const finding of content.findings) {
        for (const code of finding.evidenceIds) {
          expect(known.has(code), `утверждение ссылается на ${code}`).toBe(true);
        }
      }

      // Типы свидетельств разделены: факт руководителя, мнение, самоотчёт, расчёт.
      const kinds = new Set(evidence.map((item) => item.kind));
      expect(kinds.has('work_fact')).toBe(true);
      expect(kinds.has('manager_opinion')).toBe(true);
      expect(kinds.has('self_report')).toBe(true);
      expect(kinds.has('method_result')).toBe(true);

      // Прогноза нет: проверенной модели для этой цели не зарегистрировано.
      expect(content.prediction).toBeNull();
      // Ограничения обязательны и непусты.
      expect(content.limitations.length).toBeGreaterThan(0);
    });
  });

  it('повторная подготовка не создаёт второе заключение', async () => {
    const again = await runGenerateReport(workerPrisma, {
      organizationId: ids.organizationId,
      entityId: ids.assignmentId,
      dataGeneration: '1',
    });

    expect(again.status).toBe('skipped');

    const count = await withTenant(prisma, { organizationId: ids.organizationId }, (tx) =>
      tx.reports.count({
        where: { organization_id: ids.organizationId, assignment_id: ids.assignmentId },
      }),
    );
    expect(count).toBe(1);
  });

  it('до публикации заключение недоступно как опубликованное', async () => {
    const published = await withTenant(prisma, { organizationId: ids.organizationId }, (tx) =>
      tx.reports.findFirst({
        where: { id: ids.reportId, organization_id: ids.organizationId, status: 'published' },
      }),
    );
    expect(published).toBeNull();
  });

  it('публикация фиксирует рецензента и делает ревизию неизменяемой', async () => {
    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      const revision = await tx.report_revisions.findFirstOrThrow({
        where: {
          organization_id: ids.organizationId,
          report_id: ids.reportId,
          state: 'pending_review',
        },
        select: { id: true, content_hash: true },
      });

      const now = new Date();
      await tx.report_revisions.update({
        where: { id: revision.id },
        data: {
          state: 'published',
          reviewer_id: ids.reviewerId,
          reviewed_at: now,
          published_at: now,
        },
      });
      await tx.reports.update({
        where: { id: ids.reportId },
        data: {
          status: 'published',
          published_at: now,
          current_published_revision_id: revision.id,
        },
      });

      const result = await tx.reports.findFirstOrThrow({
        where: { id: ids.reportId, organization_id: ids.organizationId, status: 'published' },
        select: {
          current_published_revision: { select: { reviewer_id: true, content_hash: true } },
        },
      });

      expect(result.current_published_revision?.reviewer_id).toBe(ids.reviewerId);
      expect(result.current_published_revision?.content_hash).toBe(revision.content_hash);
    });
  });

  it('другая организация не видит ни назначение, ни заключение', async () => {
    await withTenant(prisma, { organizationId: ids.otherOrganizationId }, async (tx) => {
      const assignment = await tx.assignments.findUnique({ where: { id: ids.assignmentId } });
      const report = await tx.reports.findUnique({ where: { id: ids.reportId } });
      const answers = await tx.answers.count();
      const evidence = await tx.evidence_items.count();

      expect(assignment).toBeNull();
      expect(report).toBeNull();
      expect(answers).toBe(0);
      expect(evidence).toBe(0);
    });
  });

  it('роль worker не читает справочник сотрудников', async () => {
    await expect(
      withTenant(workerPrisma, { organizationId: ids.organizationId }, (tx) =>
        tx.employees.count(),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
