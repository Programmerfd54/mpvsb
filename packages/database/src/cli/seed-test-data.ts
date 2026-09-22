/** Repeatable synthetic assignments for local UI and API testing. */
import { SYNTHETIC_SCENARIOS } from '@context/testing';

import { createPrismaClient, withPlatformOps, withTenant } from '../client';
import { isProductionLike } from '../env';
import { toJson } from '../json';

const MARKER = '[synthetic-test-data:v1]';
const CASES = [
  { organization: 'demo_alpha', employee: 'A-001', scenario: 'development_investment', days: 14 },
  { organization: 'demo_alpha', employee: 'A-002', scenario: 'development_investment', days: 21 },
  { organization: 'demo_alpha', employee: 'A-003', scenario: 'retention_conditions', days: 10 },
  { organization: 'demo_alpha', employee: 'A-004', scenario: 'role_readiness', days: 28 },
  { organization: 'demo_beta', employee: 'B-001', scenario: 'development_investment', days: 14 },
  { organization: 'demo_beta', employee: 'B-002', scenario: 'role_readiness', days: 21 },
] as const;

async function main(): Promise<void> {
  if (isProductionLike()) {
    throw new Error('Синтетическое наполнение запрещено при APP_ENV=production|staging.');
  }

  const prisma = createPrismaClient('api');
  let created = 0;
  let existing = 0;
  try {
    for (const item of CASES) {
      const organization = await withPlatformOps(prisma, (tx) =>
        tx.organizations.findUnique({
          where: { code: item.organization },
          select: { id: true, mode: true },
        }),
      );
      if (!organization || organization.mode !== 'demo') {
        throw new Error(
          `Нет demo-организации ${item.organization}; сначала выполните db:seed:demo.`,
        );
      }

      await withTenant(prisma, { organizationId: organization.id }, async (tx) => {
        const employee = await tx.employees.findFirst({
          where: { organization_id: organization.id, external_code: item.employee },
          select: { id: true, job_title: true },
        });
        const manager = await tx.users.findUnique({
          where: {
            email_normalized: `manager.${item.organization === 'demo_alpha' ? 'a' : 'b'}@synthetic.context.invalid`,
          },
          select: { id: true },
        });
        const scenario = SYNTHETIC_SCENARIOS.find((entry) => entry.code === item.scenario);
        const scenarioRow = await tx.scenarios.findUnique({
          where: { stable_code: item.scenario },
          select: { current_published_version_id: true },
        });
        if (!employee || !manager || !scenario || !scenarioRow?.current_published_version_id) {
          throw new Error(
            `Не хватает базовых demo-данных для ${item.organization}/${item.employee}.`,
          );
        }

        const prior = await tx.assignments.findFirst({
          where: {
            organization_id: organization.id,
            employee_id: employee.id,
            scenario_version_id: scenarioRow.current_published_version_id,
            context_snapshot: { path: ['decisionQuestion'], string_contains: MARKER },
          },
          select: { id: true },
        });
        if (prior) {
          existing++;
          return;
        }

        const context: Record<string, string> = {
          decisionQuestion: `${MARKER} Проверить демонстрационный сценарий для рабочего решения по сотруднику.`,
          decisionHorizon: new Date(Date.now() + item.days * 86_400_000).toISOString().slice(0, 10),
          currentRole: employee.job_title ?? 'Синтетическая роль',
          workFacts: 'Вымышленный пример: сотрудник выполнил учебную задачу в тестовом проекте.',
          managerOpinion: 'Вымышленное мнение руководителя для проверки интерфейса.',
          constraints: 'Только синтетические данные; решение не применяется к людям.',
          trainingName: 'Учебная программа по рабочим процессам',
          targetTask: 'Выполнить учебную задачу в тестовом проекте.',
          targetRole: 'Старший специалист учебного проекта',
          newResponsibilities: 'Координировать учебные задачи тестовой команды.',
          successCriteria: 'Учебные задачи завершены в согласованный срок.',
          situationType: 'workload',
          plannedChanges: 'Перераспределить задачи в учебном проекте.',
        };
        const assignment = await tx.assignments.create({
          data: {
            organization_id: organization.id,
            employee_id: employee.id,
            scenario_version_id: scenarioRow.current_published_version_id,
            context_snapshot: toJson(context),
            mode: 'demo',
            state: 'draft',
            due_at: new Date(Date.now() + item.days * 86_400_000),
            created_by: manager.id,
          },
          select: { id: true },
        });
        const methods = await tx.scenario_methods.findMany({
          where: { scenario_version_id: scenarioRow.current_published_version_id },
          orderBy: { order_index: 'asc' },
          select: { method_version_id: true, order_index: true, required: true },
        });
        await tx.attempts.createMany({
          data: methods.map((method) => ({
            organization_id: organization.id,
            assignment_id: assignment.id,
            method_version_id: method.method_version_id,
            order_index: method.order_index,
            required: method.required,
            state: 'not_started',
          })),
        });
        created++;
      });
    }
    process.stdout.write(
      `Синтетические назначения: создано ${created}, уже было ${existing}. Пароли не изменены.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
