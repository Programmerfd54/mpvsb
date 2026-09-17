/**
 * Наполнение демонстрационной среды синтетическими данными.
 *
 * В базе появляются только вымышленные организации, учётные записи и сотрудники.
 * Реальные персональные данные, чужие методики и настоящие адреса запрещены.
 *
 * Скрипт отказывается работать в production-подобном окружении.
 */
import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';

import { contentHash } from '@context/scoring';
import {
  SYNTHETIC_ACCOUNTS,
  SYNTHETIC_EMPLOYEES_A,
  SYNTHETIC_EMPLOYEES_B,
  SYNTHETIC_METHODS,
  SYNTHETIC_ORGANIZATIONS,
  SYNTHETIC_REPORTING_POLICIES,
  SYNTHETIC_SCENARIOS,
} from '@context/testing';

import { createPrismaClient, withPlatformOps, withTenant } from '../client';
import { toJson } from '../json';
import { isProductionLike } from '../env';
import type { TenantTransaction } from '../client';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

function generatePassword(): string {
  // Длина соответствует минимуму политики; значение случайное и живёт только локально.
  return `Synthetic-${randomBytes(9).toString('base64url')}`;
}

/** Образец документа информирования. В реальном режиме требуется утверждённая версия. */
const CONSENT_DOCUMENT = {
  key: 'participation_notice',
  version: '1.0.0',
  title: 'Информирование об участии в оценке (образец)',
  purpose: 'assessment_participation',
  body: [
    '# Образец. Не для реальных данных.',
    '',
    'Этот текст — демонстрационный шаблон. Он не является утверждённым документом',
    'и не может использоваться для оценки реальных сотрудников.',
    '',
    '## Что предстоит',
    'Вам предложено пройти несколько анкет. Правильных ответов нет.',
    '',
    '## Как используются ответы',
    'Ответы обрабатываются на сервере платформы и входят в заключение,',
    'которое видит ваш руководитель. Отдельные ответы руководителю не показываются.',
    '',
    '## Кто увидит результат',
    'Руководитель, создавший оценку, и назначенный рецензент заключения.',
    '',
    '## Ваши возможности',
    'Вы можете отказаться от участия, запросить копию своих данных,',
    'исправление или прекращение обработки.',
  ].join('\n'),
};

async function main(): Promise<void> {
  if (isProductionLike()) {
    throw new Error(
      'Демонстрационный seed запрещён в production-подобном окружении (APP_ENV=production|staging).',
    );
  }

  const prisma = createPrismaClient('api');
  const passwords = new Map<string, string>();

  try {
    // ——— Глобальное содержимое: документы, методики, политики, сценарии ———
    const documentId = await withPlatformOps(prisma, async (tx) => {
      const hash = contentHash(CONSENT_DOCUMENT.body);
      const existing = await tx.legal_document_versions.findFirst({
        where: {
          key: CONSENT_DOCUMENT.key,
          locale: 'ru',
          semantic_version: CONSENT_DOCUMENT.version,
        },
        select: { id: true },
      });
      if (existing) {
        return existing.id;
      }
      const created = await tx.legal_document_versions.create({
        data: {
          key: CONSENT_DOCUMENT.key,
          locale: 'ru',
          semantic_version: CONSENT_DOCUMENT.version,
          // Статус draft: production-шлюз не допустит запуск реальной оценки с образцом.
          status: 'draft',
          title: CONSENT_DOCUMENT.title,
          body: CONSENT_DOCUMENT.body,
          purpose: CONSENT_DOCUMENT.purpose,
          content_hash: hash,
          effective_from: new Date(),
        },
        select: { id: true },
      });
      return created.id;
    });

    const methodVersionIds = await withPlatformOps(prisma, async (tx) => {
      const map = new Map<string, string>();
      for (const method of SYNTHETIC_METHODS) {
        const existingMethod = await tx.methods.findUnique({
          where: { stable_code: method.code },
          select: { id: true },
        });

        const methodRow =
          existingMethod ??
          (await tx.methods.create({
            data: { stable_code: method.code, title: method.passport.title },
            select: { id: true },
          }));

        const existingVersion = await tx.method_versions.findFirst({
          where: { method_id: methodRow.id, semantic_version: method.semanticVersion },
          select: { id: true },
        });

        if (existingVersion) {
          map.set(method.code, existingVersion.id);
          continue;
        }

        const hash = contentHash({
          passport: method.passport,
          items: method.items,
          scoring: method.scoring,
        });

        const version = await tx.method_versions.create({
          data: {
            method_id: methodRow.id,
            semantic_version: method.semanticVersion,
            status: 'published',
            // Синтетическое содержимое допустимо только в demo-режиме.
            applicability_mode: 'demo',
            passport_json: toJson(method.passport),
            items_json: toJson(method.items),
            scoring_config_json: toJson(method.scoring),
            scorer_id: 'declarative',
            scorer_version: '1.0.0',
            interpretation_rules_json: toJson({ limitations: method.passport.limitations }),
            missing_policy: method.scoring.missingPolicy,
            license_metadata: toJson({
              source: method.passport.sourceStatement,
              rights: method.passport.rightsStatement,
            }),
            validation_metadata: toJson({
              status: 'not_validated',
              note: 'Синтетическое содержимое. Прогностическая или конструктная валидность не проверялась.',
            }),
            fixtures_json: toJson(method.fixtures),
            content_hash: hash,
            published_at: new Date(),
          },
          select: { id: true },
        });

        await tx.methods.update({
          where: { id: methodRow.id },
          data: { current_published_version_id: version.id },
        });

        map.set(method.code, version.id);
      }
      return map;
    });

    const policyIds = await withPlatformOps(prisma, async (tx) => {
      const map = new Map<string, string>();
      for (const policy of SYNTHETIC_REPORTING_POLICIES) {
        const existing = await tx.reporting_policies.findFirst({
          where: { stable_code: policy.code, semantic_version: policy.semanticVersion },
          select: { id: true },
        });
        if (existing) {
          map.set(policy.code, existing.id);
          continue;
        }
        const created = await tx.reporting_policies.create({
          data: {
            stable_code: policy.code,
            semantic_version: policy.semanticVersion,
            permitted_claims: toJson(policy.permittedClaims),
            required_limitations: toJson(policy.requiredLimitations),
            forbidden_claims: toJson(policy.forbiddenClaims),
            participant_visibility: 'completion_receipt',
          },
          select: { id: true },
        });
        map.set(policy.code, created.id);
      }
      return map;
    });

    const scenarioVersionIds = await withPlatformOps(prisma, async (tx) => {
      const map = new Map<string, string>();
      for (const scenario of SYNTHETIC_SCENARIOS) {
        const existingScenario = await tx.scenarios.findUnique({
          where: { stable_code: scenario.code },
          select: { id: true },
        });
        const scenarioRow =
          existingScenario ??
          (await tx.scenarios.create({
            data: { stable_code: scenario.code, title: scenario.title },
            select: { id: true },
          }));

        const existingVersion = await tx.scenario_versions.findFirst({
          where: { scenario_id: scenarioRow.id, semantic_version: scenario.semanticVersion },
          select: { id: true },
        });
        if (existingVersion) {
          map.set(scenario.code, existingVersion.id);
          continue;
        }

        const methodIds = scenario.methodCodes.map((code) => {
          const id = methodVersionIds.get(code);
          if (!id) {
            throw new Error(`Сценарий ${scenario.code} ссылается на неизвестную методику ${code}.`);
          }
          return id;
        });

        const hash = contentHash({
          code: scenario.code,
          version: scenario.semanticVersion,
          contextSchema: scenario.contextSchema,
          methodCodes: scenario.methodCodes,
        });

        const version = await tx.scenario_versions.create({
          data: {
            scenario_id: scenarioRow.id,
            semantic_version: scenario.semanticVersion,
            status: 'published',
            applicability_mode: 'demo',
            context_schema_json: toJson(scenario.contextSchema),
            reporting_policy_id: policyIds.get(scenario.reportingPolicyCode) ?? null,
            participant_visibility: 'completion_receipt',
            content_hash: hash,
            published_at: new Date(),
          },
          select: { id: true },
        });

        await tx.scenario_methods.createMany({
          data: methodIds.map((methodVersionId, index) => ({
            scenario_version_id: version.id,
            method_version_id: methodVersionId,
            order_index: index,
            required: true,
          })),
        });

        await tx.scenarios.update({
          where: { id: scenarioRow.id },
          data: { current_published_version_id: version.id },
        });

        map.set(scenario.code, version.id);
      }
      return map;
    });

    // ——— Организации ———
    const organizationIds = await withPlatformOps(prisma, async (tx) => {
      const map = new Map<string, string>();
      for (const org of SYNTHETIC_ORGANIZATIONS) {
        const existing = await tx.organizations.findUnique({
          where: { code: org.code },
          select: { id: true },
        });
        if (existing) {
          map.set(org.code, existing.id);
          continue;
        }
        const created = await tx.organizations.create({
          data: {
            code: org.code,
            name: org.name,
            timezone: org.timezone,
            mode: 'demo',
            participant_contact: 'demo-support@synthetic.context.invalid',
          },
          select: { id: true },
        });
        map.set(org.code, created.id);
      }
      return map;
    });

    // ——— Учётные записи и членство ———
    await withPlatformOps(prisma, async (tx) => {
      for (const account of SYNTHETIC_ACCOUNTS) {
        const password = generatePassword();
        const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

        const existing = await tx.users.findUnique({
          where: { email_normalized: account.email },
          select: { id: true },
        });

        const user = existing
          ? await tx.users.update({
              where: { id: existing.id },
              data: { password_hash: passwordHash, status: 'active' },
              select: { id: true },
            })
          : await tx.users.create({
              data: {
                email_normalized: account.email,
                email_display: account.email,
                display_name: account.displayName,
                password_hash: passwordHash,
                platform_role: account.role === 'platform_admin' ? 'platform_admin' : null,
                status: 'active',
                mfa_required: account.role === 'platform_admin',
              },
              select: { id: true },
            });

        passwords.set(account.email, password);

        if (account.organizationCode) {
          const organizationId = organizationIds.get(account.organizationCode);
          if (!organizationId) {
            throw new Error(`Неизвестная организация ${account.organizationCode}.`);
          }
          const membership = await tx.memberships.findFirst({
            where: { organization_id: organizationId, user_id: user.id },
            select: { id: true },
          });
          if (membership) {
            await tx.memberships.update({
              where: { id: membership.id },
              data: { permissions: [...(account.permissions ?? [])], status: 'active' },
            });
          } else {
            await tx.memberships.create({
              data: {
                organization_id: organizationId,
                user_id: user.id,
                permissions: [...(account.permissions ?? [])],
                status: 'active',
              },
            });
          }
        }
      }
    });

    // ——— Сотрудники: пишутся уже в контексте своей организации ———
    const orgAlpha = organizationIds.get('demo_alpha')!;
    const orgBeta = organizationIds.get('demo_beta')!;

    await seedEmployees(prisma, orgAlpha, SYNTHETIC_EMPLOYEES_A);
    await seedEmployees(prisma, orgBeta, SYNTHETIC_EMPLOYEES_B);

    // ——— Готовность: demo-организации остаются с незакрытыми пунктами ———
    await withPlatformOps(prisma, async (tx) => {
      for (const organizationId of [orgAlpha, orgBeta]) {
        const existing = await tx.readiness_checks.count({
          where: { organization_id: organizationId },
        });
        if (existing > 0) {
          continue;
        }
        await tx.readiness_checks.createMany({
          data: [
            'method_content_rights',
            'method_scope_reviewed',
            'consent_documents_approved',
            'retention_policy_approved',
            'processing_agreement',
            'infrastructure_location',
            'ai_provider_policy',
            'reviewer_assigned',
            'isolation_tests_passed',
            'backup_restore_verified',
            'support_contact',
          ].map((key) => ({ organization_id: organizationId, check_key: key, state: 'pending' })),
        });
      }
    });

    report(passwords, {
      organizations: organizationIds.size,
      methods: methodVersionIds.size,
      scenarios: scenarioVersionIds.size,
      employees: SYNTHETIC_EMPLOYEES_A.length + SYNTHETIC_EMPLOYEES_B.length,
      consentDocumentId: documentId,
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function seedEmployees(
  prisma: ReturnType<typeof createPrismaClient>,
  organizationId: string,
  people: readonly {
    externalCode: string;
    displayName: string;
    jobTitle: string;
    department: string;
  }[],
): Promise<void> {
  await withTenant(prisma, { organizationId }, async (tx: TenantTransaction) => {
    for (const person of people) {
      const existing = await tx.employees.findFirst({
        where: { organization_id: organizationId, external_code: person.externalCode },
        select: { id: true },
      });
      if (existing) {
        continue;
      }
      await tx.employees.create({
        data: {
          organization_id: organizationId,
          display_name: person.displayName,
          external_code: person.externalCode,
          job_title: person.jobTitle,
          department: person.department,
        },
      });
    }
  });
}

function report(
  passwords: ReadonlyMap<string, string>,
  summary: {
    organizations: number;
    methods: number;
    scenarios: number;
    employees: number;
    consentDocumentId: string;
  },
): void {
  const lines = [
    '',
    'Демонстрационные данные загружены.',
    `  Организации: ${summary.organizations}`,
    `  Версии методик: ${summary.methods} (все синтетические, режим demo)`,
    `  Версии сценариев: ${summary.scenarios}`,
    `  Сотрудники: ${summary.employees} (вымышленные)`,
    '',
    'Учётные записи для локального входа:',
  ];

  for (const [email, password] of passwords) {
    lines.push(`  ${email}`);
    lines.push(`    пароль: ${password}`);
  }

  lines.push(
    '',
    'Пароли сгенерированы для этого запуска и нигде не сохранены.',
    'Повторный запуск seed выпустит новые пароли.',
    'Документ информирования имеет статус «образец» и не допускает реальных участников.',
    '',
  );

  process.stdout.write(lines.join('\n'));
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
