/**
 * Сроки назначений в фоновой обработке (ТЗ 01.7, M05).
 *
 * Проверяется, что задание действительно работает под ролью `context_worker`:
 * строгая политика RLS требует организацию в контексте транзакции, поэтому
 * обход идёт по организациям. Проверяются перевод просроченного назначения,
 * отзыв сессии участника, предупреждение о скором сроке и его дедупликация.
 *
 * Все участники синтетические.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, toJson, withPlatformOps, withTenant } from '@context/database';
import type { PrismaClient } from '@context/database';
import { assignmentExpiryEventKey } from '@context/domain';
import { contentHash } from '@context/scoring';

import {
  runAssignmentExpiryNotices,
  runExpireInvitations,
} from '../src/jobs/expire-invitations.js';

/** Клиент API используется только для подготовки и чтения фикстур. */
let prisma: PrismaClient;
let workerPrisma: PrismaClient;

const ids = {
  organizationId: '',
  managerId: '',
  employeeId: '',
  scenarioVersionId: '',
  /** Срок через сутки: попадает в окно предупреждения. */
  expiringAssignmentId: '',
  /** Срок в далёком будущем: предупреждать рано. */
  distantAssignmentId: '',
  /** Срок уже прошёл: назначение закрывается. */
  overdueAssignmentId: '',
  overdueSessionId: '',
  /** Автор с отозванным membership: предупреждать его некуда. */
  revokedManagerId: '',
  revokedAssignmentId: '',
};

const HOUR = 60 * 60 * 1000;

async function notificationsFor(
  type: string,
  recipientUserId = ids.managerId,
): Promise<Array<{ resource_id: string | null; event_key: string }>> {
  return withTenant(prisma, { organizationId: ids.organizationId }, async (tx) =>
    tx.notifications.findMany({
      where: {
        organization_id: ids.organizationId,
        recipient_user_id: recipientUserId,
        type,
      },
      select: { resource_id: true, event_key: true },
    }),
  );
}

beforeAll(async () => {
  prisma = createPrismaClient('api');
  workerPrisma = createPrismaClient('worker');

  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');

  await withPlatformOps(prisma, async (tx) => {
    const organization = await tx.organizations.create({
      data: { name: 'ООО «Синтетика Сроков»', code: `expiry_${suffix}`, mode: 'demo' },
      select: { id: true },
    });
    ids.organizationId = organization.id;

    const manager = await tx.users.create({
      data: {
        email_normalized: `expiry.manager.${suffix}@synthetic.invalid`,
        email_display: `expiry.manager.${suffix}@synthetic.invalid`,
        display_name: 'Руководитель (тест сроков)',
        status: 'active',
      },
      select: { id: true },
    });
    ids.managerId = manager.id;

    const revokedManager = await tx.users.create({
      data: {
        email_normalized: `expiry.revoked.${suffix}@synthetic.invalid`,
        email_display: `expiry.revoked.${suffix}@synthetic.invalid`,
        display_name: 'Руководитель с отозванным доступом (тест сроков)',
        status: 'active',
      },
      select: { id: true },
    });
    ids.revokedManagerId = revokedManager.id;

    await tx.memberships.createMany({
      data: [
        {
          organization_id: organization.id,
          user_id: manager.id,
          permissions: ['assessments.manage', 'reports.read'],
          status: 'active',
        },
        {
          // Доступ отозван: уведомление ему создавать незачем.
          organization_id: organization.id,
          user_id: revokedManager.id,
          permissions: ['assessments.manage'],
          status: 'revoked',
        },
      ],
    });

    const policy = await tx.reporting_policies.create({
      data: {
        stable_code: `expiry_policy_${suffix}`,
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
        content_hash: contentHash({ scenario: 'expiry', suffix }),
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
        external_code: `EXPIRY-${suffix}`,
      },
      select: { id: true },
    });
    ids.employeeId = employee.id;

    const create = async (
      state: string,
      dueAt: Date,
      createdBy = ids.managerId,
    ): Promise<string> => {
      const assignment = await tx.assignments.create({
        data: {
          organization_id: ids.organizationId,
          employee_id: employee.id,
          scenario_version_id: ids.scenarioVersionId,
          context_snapshot: toJson({ decisionQuestion: 'Синтетический вопрос руководителя.' }),
          mode: 'demo',
          state,
          due_at: dueAt,
          created_by: createdBy,
        },
        select: { id: true },
      });
      return assignment.id;
    };

    ids.expiringAssignmentId = await create('invited', new Date(Date.now() + 24 * HOUR));
    ids.distantAssignmentId = await create('invited', new Date(Date.now() + 30 * 24 * HOUR));
    ids.overdueAssignmentId = await create('in_progress', new Date(Date.now() - HOUR));
    ids.revokedAssignmentId = await create(
      'invited',
      new Date(Date.now() + 12 * HOUR),
      ids.revokedManagerId,
    );

    const invitation = await tx.invitations.create({
      data: {
        organization_id: ids.organizationId,
        assignment_id: ids.overdueAssignmentId,
        // Синтетический хэш: настоящая ссылка в тестах не выпускается.
        token_hash: contentHash({ invitation: ids.overdueAssignmentId, suffix }),
        expires_at: new Date(Date.now() - HOUR),
        issued_by: ids.managerId,
      },
      select: { id: true },
    });

    const session = await tx.participant_sessions.create({
      data: {
        organization_id: ids.organizationId,
        assignment_id: ids.overdueAssignmentId,
        invitation_id: invitation.id,
        session_hash: contentHash({ session: ids.overdueAssignmentId, suffix }),
        idle_expires_at: new Date(Date.now() + HOUR),
        absolute_expires_at: new Date(Date.now() + 6 * HOUR),
      },
      select: { id: true },
    });
    ids.overdueSessionId = session.id;
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await workerPrisma.$disconnect();
});

describe('Предупреждение о скором истечении срока', () => {
  it('создаётся автору назначения и только для ближайших сроков', async () => {
    await runAssignmentExpiryNotices(workerPrisma);

    const created = await notificationsFor('assignment_expiring');
    const resources = created.map((row) => row.resource_id);

    expect(resources).toContain(ids.expiringAssignmentId);
    expect(resources).not.toContain(ids.distantAssignmentId);
    expect(resources).not.toContain(ids.overdueAssignmentId);
  });

  it('повторный запуск второго предупреждения не создаёт', async () => {
    const before = await notificationsFor('assignment_expiring');

    await runAssignmentExpiryNotices(workerPrisma);
    await runAssignmentExpiryNotices(workerPrisma);

    const after = await notificationsFor('assignment_expiring');
    expect(after).toHaveLength(before.length);
  });

  it('автору с отозванным membership предупреждение не создаётся', async () => {
    await runAssignmentExpiryNotices(workerPrisma);

    const created = await notificationsFor('assignment_expiring', ids.revokedManagerId);
    // Мёртвая запись не нужна: ManagerGuard ответит такому адресату 404.
    expect(created).toHaveLength(0);
  });

  it('продление срока даёт новое предупреждение', async () => {
    const before = await notificationsFor('assignment_expiring');
    const extended = new Date(Date.now() + 12 * HOUR);

    // Руководитель продлил срок: приближается новый срок, и о нём нужно
    // предупредить заново — это отдельное событие, а не повтор доставки.
    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      await tx.assignments.update({
        where: { id: ids.expiringAssignmentId },
        data: { due_at: extended, revision: { increment: 1 } },
      });
    });

    await runAssignmentExpiryNotices(workerPrisma);

    const after = await notificationsFor('assignment_expiring');
    expect(after.length).toBe(before.length + 1);
    expect(after.map((row) => row.event_key)).toContain(
      assignmentExpiryEventKey(ids.expiringAssignmentId, extended),
    );

    // Повторный прогон с тем же сроком ничего не добавляет.
    await runAssignmentExpiryNotices(workerPrisma);
    expect(await notificationsFor('assignment_expiring')).toHaveLength(after.length);
  });
});

describe('Перевод просроченных назначений', () => {
  it('закрывает назначение и отзывает сессию участника', async () => {
    const processed = await runExpireInvitations(workerPrisma);
    expect(processed).toBeGreaterThan(0);

    await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) => {
      const overdue = await tx.assignments.findFirst({
        where: { id: ids.overdueAssignmentId, organization_id: ids.organizationId },
        select: { state: true },
      });
      const untouched = await tx.assignments.findFirst({
        where: { id: ids.expiringAssignmentId, organization_id: ids.organizationId },
        select: { state: true },
      });
      const session = await tx.participant_sessions.findFirst({
        where: { id: ids.overdueSessionId, organization_id: ids.organizationId },
        select: { revoked_at: true },
      });

      expect(overdue?.state).toBe('expired');
      // Назначение с ещё не наступившим сроком задание не трогает.
      expect(untouched?.state).toBe('invited');
      expect(session?.revoked_at).not.toBeNull();
    });
  });

  it('повторный запуск уже закрытое назначение не трогает', async () => {
    await runExpireInvitations(workerPrisma);

    const revision = await withTenant(prisma, { organizationId: ids.organizationId }, async (tx) =>
      tx.assignments.findFirst({
        where: { id: ids.overdueAssignmentId, organization_id: ids.organizationId },
        select: { revision: true, state: true },
      }),
    );

    expect(revision?.state).toBe('expired');
    // Счётчик ревизий не растёт: повторной записи не было.
    expect(revision?.revision).toBe(2);
  });
});
