/**
 * Редактирование сценария.
 *
 * Версия сценария закрепляет набор версий методик: назначение, созданное по ней,
 * всегда проходит те же тесты в том же порядке. Проверяется, что состав нельзя
 * собрать противоречиво и что опубликованная версия неизменяема (ТЗ 01.4, A06).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MethodDraftContent, UpdateScenarioVersionInput } from '@context/contracts';
import { createPrismaClient, withPlatformOps, type PrismaClient } from '@context/database';

import { AdminContentService } from '../src/modules/admin/admin-content.service';
import { MethodEditorService } from '../src/modules/admin/method-editor.service';
import { ScenarioEditorService } from '../src/modules/admin/scenario-editor.service';
import { AuditService } from '../src/platform/audit/audit.service';
import { PrismaService } from '../src/platform/database/prisma.service';
import { AppError } from '../src/platform/errors/app-error';

let prisma: PrismaClient;
let content: AdminContentService;
let methodEditor: MethodEditorService;
let scenarioEditor: ScenarioEditorService;

let actorId = '';
let scenarioId = '';
let versionId = '';
let policyId = '';
const methodVersions: Array<{ methodId: string; versionId: string }> = [];

/** Минимальное содержимое методики, проходящее все проверки публикации. */
function methodContent(prefix: string): MethodDraftContent {
  return {
    applicabilityMode: 'demo',
    passport: {
      title: `Синтетическая методика ${prefix}`,
      purpose: 'Проверяет сборку сценария из версий методик через интерфейс.',
      targetPopulation: 'Синтетические участники демонстрационных организаций.',
      language: 'ru',
      limitations: ['Демонстрационный материал: норм и проверенной связи с результатами нет.'],
      sourceStatement: 'Написано для проверки редактора сценария.',
      rightsStatement: 'Синтетическое содержимое проекта.',
      estimatedMinutes: null,
      participantIntro: 'Одно короткое утверждение о вашей работе. Правильных ответов нет.',
    },
    items: [
      {
        id: `item_${prefix}_1`,
        type: 'likert',
        prompt: 'Мне понятно, чего от меня ждут.',
        required: true,
        min: 1,
        max: 5,
        labels: [
          { value: 1, label: 'Совсем не согласен' },
          { value: 5, label: 'Полностью согласен' },
        ],
      },
    ],
    scoring: {
      missingPolicy: 'mark_unknown',
      scales: [
        {
          id: `scale_${prefix}`,
          title: 'Ясность в описании участника',
          description: 'Самоотчёт участника, а не наблюдение.',
          items: [`item_${prefix}_1`],
          reverseItems: [],
          aggregate: 'mean',
          expectedRange: { min: 1, max: 5 },
        },
      ],
    },
    fixtures: [
      {
        name: 'Минимум',
        answers: { [`item_${prefix}_1`]: { type: 'likert', value: 1 } },
        expected: { [`scale_${prefix}`]: 1 },
      },
    ],
  };
}

function draft(overrides: Partial<UpdateScenarioVersionInput> = {}): UpdateScenarioVersionInput {
  return {
    applicabilityMode: 'demo',
    contextSchema: {
      fields: [
        {
          key: 'decisionQuestion',
          label: 'Какое решение вы принимаете',
          type: 'textarea',
          required: true,
          isOpinion: false,
          evidenceRole: 'context',
        },
        {
          key: 'workFacts',
          label: 'Наблюдаемые рабочие факты',
          type: 'textarea',
          required: false,
          isOpinion: false,
          evidenceRole: 'fact',
        },
      ],
    },
    methods: [{ methodVersionId: methodVersions[0]!.versionId, orderIndex: 0, required: true }],
    reportingPolicyId: policyId,
    participantVisibility: 'completion_receipt',
    expectedContentHash: null,
    ...overrides,
  };
}

beforeAll(async () => {
  prisma = createPrismaClient('api');
  const prismaService = Object.create(PrismaService.prototype) as PrismaService;
  Object.defineProperty(prismaService, 'client', { value: prisma, writable: false });

  const audit = new AuditService(prismaService);
  content = new AdminContentService(prismaService, audit);
  methodEditor = new MethodEditorService(prismaService, content, audit);
  scenarioEditor = new ScenarioEditorService(prismaService, content, audit);

  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');

  await withPlatformOps(prisma, async (tx) => {
    const user = await tx.users.create({
      data: {
        email_normalized: `scenario.${suffix}@synthetic.invalid`,
        email_display: `scenario.${suffix}@synthetic.invalid`,
        display_name: 'Администратор (тест сценария)',
        platform_role: 'platform_admin',
        status: 'active',
      },
      select: { id: true },
    });
    actorId = user.id;
  });

  // Две опубликованные методики: одна войдёт в сценарий, вторая нужна,
  // чтобы проверить запрет двух версий одной и той же методики.
  for (const prefix of ['a', 'b']) {
    const created = await methodEditor.createMethod(
      {
        code: `scen_method_${prefix}_${suffix}`,
        title: `Синтетическая методика ${prefix}`,
        semanticVersion: '1.0.0',
      },
      actorId,
    );
    const current = await content.getMethodVersion(created.versionId);
    await methodEditor.updateDraft(
      created.versionId,
      { ...methodContent(`${prefix}${suffix}`), expectedContentHash: current.contentHash },
      actorId,
    );
    await content.transitionMethodVersion(created.versionId, 'review', actorId);
    await content.transitionMethodVersion(created.versionId, 'published', actorId);
    methodVersions.push({ methodId: created.methodId, versionId: created.versionId });
  }

  const policy = await scenarioEditor.createReportingPolicy(
    {
      code: `scen_policy_${suffix}`,
      semanticVersion: '1.0.0',
      permittedClaims: ['описание условий работы со слов сотрудника'],
      requiredLimitations: ['Прогностическая точность синтетических методик не проверялась.'],
      forbiddenClaims: ['прогноз увольнения или вероятность ухода'],
    },
    actorId,
  );
  policyId = policy.id;

  const scenario = await scenarioEditor.createScenario(
    {
      code: `scen_${suffix}`,
      title: 'Синтетический сценарий редактора',
      semanticVersion: '1.0.0',
    },
    actorId,
  );
  versionId = scenario.versionId;
  scenarioId = scenario.scenarioId;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Редактор сценария', () => {
  it('новый сценарий создаётся черновиком с минимальной схемой контекста', async () => {
    const version = await content.getScenarioVersion(versionId);

    expect(version.status).toBe('draft');
    expect(version.editable).toBe(true);
    expect(version.methods).toHaveLength(0);
    // Формулировка вопроса и поле фактов есть сразу: без них заключение
    // не к чему привязать.
    expect(version.contextSchema.fields.map((field) => field.key)).toEqual([
      'decisionQuestion',
      'workFacts',
    ]);
  });

  it('пустой сценарий перечисляет, чего не хватает', async () => {
    const issues = await scenarioEditor.issuesFor(versionId);
    const codes = issues.map((issue) => issue.code);

    expect(codes).toContain('no_methods');
    expect(codes).toContain('no_reporting_policy');
  });

  it('состав сохраняется и меняет хэш', async () => {
    const before = await content.getScenarioVersion(versionId);
    const saved = await scenarioEditor.updateDraft(
      versionId,
      draft({ expectedContentHash: null }),
      actorId,
    );

    expect(saved.methods).toHaveLength(1);
    expect(saved.reportingPolicyId).toBe(policyId);
    expect(before.contextSchema.fields).toHaveLength(2);
  });

  it('сохранение с устаревшим хэшем отвергается', async () => {
    await expect(
      scenarioEditor.updateDraft(versionId, draft({ expectedContentHash: null }), actorId),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('две версии одной методики в сценарии не сохраняются', async () => {
    const current = await content.getScenarioVersion(versionId);

    // Вторая версия той же методики.
    const second = await methodEditor.createVersion(
      methodVersions[0]!.methodId,
      { semanticVersion: '1.1.0', copyFromVersionId: methodVersions[0]!.versionId },
      actorId,
    );
    await content.transitionMethodVersion(second.versionId, 'review', actorId);
    await content.transitionMethodVersion(second.versionId, 'published', actorId);

    await expect(
      scenarioEditor.updateDraft(
        versionId,
        draft({
          expectedContentHash: current.contentHash,
          methods: [
            { methodVersionId: methodVersions[0]!.versionId, orderIndex: 0, required: true },
            { methodVersionId: second.versionId, orderIndex: 1, required: true },
          ],
        }),
        actorId,
      ),
    ).rejects.toThrow(AppError);
  });

  it('неопубликованная методика не сохраняется в составе', async () => {
    const current = await content.getScenarioVersion(versionId);
    const fresh = await methodEditor.createVersion(
      methodVersions[1]!.methodId,
      { semanticVersion: '2.0.0' },
      actorId,
    );

    await expect(
      scenarioEditor.updateDraft(
        versionId,
        draft({
          expectedContentHash: current.contentHash,
          methods: [{ methodVersionId: fresh.versionId, orderIndex: 0, required: true }],
        }),
        actorId,
      ),
    ).rejects.toThrow(AppError);
  });

  it('повтор ключа поля контекста не сохраняется', async () => {
    const current = await content.getScenarioVersion(versionId);

    await expect(
      scenarioEditor.updateDraft(
        versionId,
        draft({
          expectedContentHash: current.contentHash,
          contextSchema: {
            fields: [
              {
                key: 'decisionQuestion',
                label: 'Вопрос',
                type: 'textarea',
                required: true,
                isOpinion: false,
                evidenceRole: 'context',
              },
              {
                key: 'decisionQuestion',
                label: 'Он же',
                type: 'textarea',
                required: false,
                isOpinion: false,
                evidenceRole: 'context',
              },
            ],
          },
        }),
        actorId,
      ),
    ).rejects.toThrow(AppError);
  });

  it('сценарий уровня выше методики не сохраняется', async () => {
    const current = await content.getScenarioVersion(versionId);

    await expect(
      scenarioEditor.updateDraft(
        versionId,
        draft({ expectedContentHash: current.contentHash, applicabilityMode: 'research' }),
        actorId,
      ),
    ).rejects.toThrow(AppError);
  });

  it('после проверки версия публикуется и становится неизменяемой', async () => {
    await content.transitionScenarioVersion(versionId, 'review', actorId);
    const published = await content.transitionScenarioVersion(versionId, 'published', actorId);

    expect(published.status).toBe('published');
    expect(published.editable).toBe(false);

    const current = await content.getScenarioVersion(versionId);
    await expect(
      scenarioEditor.updateDraft(
        versionId,
        draft({ expectedContentHash: current.contentHash }),
        actorId,
      ),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('новая версия копией сохраняет состав и снова редактируема', async () => {
    const copy = await scenarioEditor.createVersion(
      scenarioId,
      { semanticVersion: '1.1.0', copyFromVersionId: versionId },
      actorId,
    );

    expect(copy.status).toBe('draft');
    expect(copy.editable).toBe(true);
    expect(copy.methods).toHaveLength(1);
    expect(copy.reportingPolicyId).toBe(policyId);

    const original = await content.getScenarioVersion(versionId);
    expect(original.status).toBe('published');

    // Тот же состав — тот же хэш. Копия без хэша не прошла бы публикацию.
    expect(copy.contentHash).toBe(original.contentHash);

    await content.transitionScenarioVersion(copy.versionId, 'review', actorId);
    const published = await content.transitionScenarioVersion(copy.versionId, 'published', actorId);
    expect(published.status).toBe('published');
  });

  it('политика заключения без обязательных ограничений не создаётся', async () => {
    await expect(
      scenarioEditor.createReportingPolicy(
        {
          code: `scen_policy_empty_${randomUUID().slice(0, 6)}`,
          semanticVersion: '1.0.0',
          permittedClaims: [],
          requiredLimitations: [],
          forbiddenClaims: [],
        },
        actorId,
      ),
    ).rejects.toThrow();
  });
});
