/**
 * Редактирование содержимого методики.
 *
 * Проверяется главный инвариант библиотеки: черновик можно править, а
 * опубликованная версия неизменяема — иначе назначение считалось бы не по тем
 * правилам, по которым создавалось (ТЗ 01.5, 07.4).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MethodDraftContent, UpdateMethodVersionInput } from '@context/contracts';
import { createPrismaClient, withPlatformOps, type PrismaClient } from '@context/database';

import { AdminContentService } from '../src/modules/admin/admin-content.service';
import { MethodEditorService } from '../src/modules/admin/method-editor.service';
import { AuditService } from '../src/platform/audit/audit.service';
import { PrismaService } from '../src/platform/database/prisma.service';
import { AppError } from '../src/platform/errors/app-error';

let prisma: PrismaClient;
let prismaService: PrismaService;
let content: AdminContentService;
let editor: MethodEditorService;

let actorId = '';
let methodId = '';
let versionId = '';

/** Заполненное содержимое, которое проходит все проверки публикации. */
function completeContent(): MethodDraftContent {
  return {
    applicabilityMode: 'demo',
    passport: {
      title: 'Синтетическая анкета редактора',
      purpose: 'Проверяет, что содержимое собирается через интерфейс без правки кода.',
      targetPopulation: 'Синтетические участники демонстрационных организаций.',
      language: 'ru',
      limitations: [
        'Демонстрационный материал: норм и проверенной связи с рабочими результатами нет.',
      ],
      sourceStatement: 'Вопросы написаны для проверки редактора.',
      rightsStatement: 'Синтетическое содержимое проекта.',
      estimatedMinutes: null,
      participantIntro: 'Два коротких утверждения о вашей работе. Правильных ответов нет.',
    },
    items: [
      {
        id: 'item_ed_1',
        type: 'likert',
        prompt: 'Мне понятно, чего от меня ждут на этой неделе.',
        required: true,
        min: 1,
        max: 5,
        labels: [
          { value: 1, label: 'Совсем не согласен' },
          { value: 5, label: 'Полностью согласен' },
        ],
      },
      {
        id: 'item_ed_2',
        type: 'single_choice',
        prompt: 'Как часто вы сверяете приоритеты?',
        required: true,
        options: [
          { id: 'opt_ed_2_1', label: 'Практически не сверяю' },
          { id: 'opt_ed_2_2', label: 'Раз в месяц' },
          { id: 'opt_ed_2_3', label: 'Раз в неделю или чаще' },
        ],
      },
    ],
    scoring: {
      missingPolicy: 'mark_unknown',
      optionScores: { item_ed_2: { opt_ed_2_1: 1, opt_ed_2_2: 2, opt_ed_2_3: 3 } },
      scales: [
        {
          id: 'scale_ed_clarity',
          title: 'Ясность ожиданий в описании участника',
          description: 'Самоотчёт участника, а не наблюдение.',
          items: ['item_ed_1', 'item_ed_2'],
          reverseItems: [],
          aggregate: 'sum',
          expectedRange: { min: 2, max: 8 },
        },
      ],
    },
    fixtures: [
      {
        name: 'Минимум',
        answers: {
          item_ed_1: { type: 'likert', value: 1 },
          item_ed_2: { type: 'single_choice', optionId: 'opt_ed_2_1' },
        },
        expected: { scale_ed_clarity: 2 },
      },
      {
        name: 'Максимум',
        answers: {
          item_ed_1: { type: 'likert', value: 5 },
          item_ed_2: { type: 'single_choice', optionId: 'opt_ed_2_3' },
        },
        expected: { scale_ed_clarity: 8 },
      },
    ],
  };
}

function withHash(body: MethodDraftContent, hash: string | null): UpdateMethodVersionInput {
  return { ...body, expectedContentHash: hash };
}

beforeAll(async () => {
  prisma = createPrismaClient('api');
  prismaService = Object.assign(Object.create(PrismaService.prototype) as PrismaService, {
    client: prisma,
  });
  // PrismaService хранит клиент в приватном поле; для теста подменяем его напрямую,
  // чтобы не поднимать весь модуль Nest ради двух сервисов.
  Object.defineProperty(prismaService, 'client', { value: prisma, writable: false });

  const audit = new AuditService(prismaService);
  content = new AdminContentService(prismaService, audit);
  editor = new MethodEditorService(prismaService, content, audit);

  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');

  await withPlatformOps(prisma, async (tx) => {
    const user = await tx.users.create({
      data: {
        email_normalized: `editor.${suffix}@synthetic.invalid`,
        email_display: `editor.${suffix}@synthetic.invalid`,
        display_name: 'Администратор (тест)',
        platform_role: 'platform_admin',
        status: 'active',
      },
      select: { id: true },
    });
    actorId = user.id;
  });

  const created = await editor.createMethod(
    {
      code: `synthetic_editor_${suffix}`,
      title: 'Синтетическая анкета редактора',
      semanticVersion: '1.0.0',
    },
    actorId,
  );
  versionId = created.versionId;
  methodId = created.methodId;
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Редактор методики', () => {
  it('новая методика создаётся пустым черновиком demo-уровня', async () => {
    const version = await content.getMethodVersion(versionId);

    expect(version.status).toBe('draft');
    expect(version.editable).toBe(true);
    expect(version.items).toHaveLength(0);
    expect(version.scoring.scales).toHaveLength(0);
    // Заявление о применимости требует основания, а не галочки при создании.
    expect(version.applicabilityMode).toBe('demo');
  });

  it('пустой черновик перечисляет всё, что мешает публикации', async () => {
    const check = await content.checkMethodVersion(versionId);

    expect(check.ok).toBe(false);
    expect(check.blockers.join(' ')).toContain('нет ни одного вопроса');
    expect(check.blockers.join(' ')).toContain('шкалы подсчёта');
    expect(check.blockers.join(' ')).toContain('контрольных примеров');
    expect(check.blockers.join(' ')).toContain('Паспорт заполнен не полностью');
  });

  it('содержимое сохраняется и меняет хэш', async () => {
    const before = await content.getMethodVersion(versionId);
    const saved = await editor.updateDraft(
      versionId,
      withHash(completeContent(), before.contentHash),
      actorId,
    );

    expect(saved.items).toHaveLength(2);
    expect(saved.scoring.scales).toHaveLength(1);
    expect(saved.contentHash).not.toBeNull();
    expect(saved.contentHash).not.toBe(before.contentHash);
  });

  it('сохранение с устаревшим хэшем отвергается', async () => {
    await expect(
      editor.updateDraft(versionId, withHash(completeContent(), null), actorId),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('шкала со ссылкой на несуществующий вопрос не сохраняется', async () => {
    const current = await content.getMethodVersion(versionId);
    const broken = completeContent();
    broken.scoring.scales[0]!.items = ['item_ed_1', 'item_ghost'];

    await expect(
      editor.updateDraft(versionId, withHash(broken, current.contentHash), actorId),
    ).rejects.toThrow(AppError);

    // Содержимое осталось прежним: частичной записи не произошло.
    const after = await content.getMethodVersion(versionId);
    expect(after.scoring.scales[0]!.items).toEqual(['item_ed_1', 'item_ed_2']);
  });

  it('вопрос с выбором без баллов вариантов не сохраняется', async () => {
    const current = await content.getMethodVersion(versionId);
    const broken = completeContent();
    delete broken.scoring.optionScores;

    await expect(
      editor.updateDraft(versionId, withHash(broken, current.contentHash), actorId),
    ).rejects.toThrow(AppError);
  });

  it('контрольные примеры сходятся на заполненном содержимом', async () => {
    const check = await content.checkMethodVersion(versionId);

    expect(check.blockers).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.fixtures.every((fixture) => fixture.passed)).toBe(true);
  });

  it('прямая публикация из черновика невозможна: нужна проверка человеком', async () => {
    await expect(
      content.transitionMethodVersion(versionId, 'published', actorId),
    ).rejects.toMatchObject({ code: 'ILLEGAL_STATE_TRANSITION' });
  });

  it('после проверки версия публикуется и становится неизменяемой', async () => {
    await content.transitionMethodVersion(versionId, 'review', actorId);
    const published = await content.transitionMethodVersion(versionId, 'published', actorId);

    expect(published.status).toBe('published');
    expect(published.editable).toBe(false);
    expect(published.publishedAt).not.toBeNull();

    const current = await content.getMethodVersion(versionId);
    await expect(
      editor.updateDraft(versionId, withHash(completeContent(), current.contentHash), actorId),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('новая версия создаётся копией опубликованной и снова редактируема', async () => {
    const copy = await editor.createVersion(
      methodId,
      { semanticVersion: '1.1.0', copyFromVersionId: versionId },
      actorId,
    );

    expect(copy.status).toBe('draft');
    expect(copy.editable).toBe(true);
    expect(copy.items).toHaveLength(2);
    // Опубликованная версия при этом не изменилась.
    const original = await content.getMethodVersion(versionId);
    expect(original.status).toBe('published');

    // Копия — то же содержимое, значит тот же хэш. Без него публикация копии
    // нарушила бы инвариант неизменяемости, который доказывается хэшем.
    expect(copy.contentHash).toBe(original.contentHash);
  });

  it('копия публикуется без правок: хэш содержимого у неё уже есть', async () => {
    const copy = await editor.createVersion(
      methodId,
      { semanticVersion: '1.2.0', copyFromVersionId: versionId },
      actorId,
    );

    await content.transitionMethodVersion(copy.versionId, 'review', actorId);
    const published = await content.transitionMethodVersion(copy.versionId, 'published', actorId);

    expect(published.status).toBe('published');
    expect(published.contentHash).toBe(copy.contentHash);
  });

  it('повтор номера версии отвергается', async () => {
    await expect(
      editor.createVersion(methodId, { semanticVersion: '1.1.0' }, actorId),
    ).rejects.toThrow(AppError);
  });

  it('импорт JSON разбирается без записи и показывает проблемы', () => {
    const accepted = editor.previewImport(completeContent());
    expect(accepted.accepted).toBe(true);
    expect(accepted.summary?.itemCount).toBe(2);
    expect(accepted.schemaErrors).toEqual([]);

    const broken = completeContent();
    broken.scoring.scales[0]!.items = ['item_ghost'];
    const rejected = editor.previewImport(broken);
    expect(rejected.accepted).toBe(false);
    expect(rejected.issues.map((issue) => issue.code)).toContain('scale_unknown_item');

    const malformed = editor.previewImport({ passport: { title: 5 } });
    expect(malformed.accepted).toBe(false);
    expect(malformed.schemaErrors.length).toBeGreaterThan(0);
    expect(malformed.summary).toBeNull();
  });
});
