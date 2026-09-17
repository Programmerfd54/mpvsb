import { Injectable } from '@nestjs/common';

import {
  answerResponseSchema,
  draftMethodPassportSchema,
  draftScoringConfigSchema,
  methodItemSchema,
  methodPassportSchema,
  missingPassportFields,
  type AdminMethod,
  type AdminMethodVersion,
  type AdminScenario,
  type AdminScenarioVersion,
  type AnswerResponse,
  type MethodCheckResult,
} from '@context/contracts';
import { contextSchemaSchema } from '@context/contracts';
import { validateMethodStructure } from '@context/contracts';
import {
  contentVersionStateMachine,
  isContentAllowedInMode,
  type ApplicabilityMode,
  type ContentVersionState,
} from '@context/domain';
import { ScoringConfigError, ScoringInputError, scoreAttempt } from '@context/scoring';
import { z } from 'zod';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';

const itemsSchema = z.array(methodItemSchema);
const fixturesSchema = z.array(
  z.object({
    name: z.string(),
    answers: z.record(z.string(), z.unknown()),
    expected: z.record(z.string(), z.number().nullable()),
  }),
);

/**
 * Библиотека содержимого: методики и сценарии.
 *
 * Опубликованная версия неизменяема — это гарантирует, что старое назначение
 * всегда считается по тем же правилам, по которым создавалось. Исправление
 * оформляется новой версией (ТЗ 01.5, 07.4).
 */
@Injectable()
export class AdminContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listMethods(): Promise<AdminMethod[]> {
    return this.prisma.platformOps(async (tx) => {
      const rows = await tx.methods.findMany({
        orderBy: { stable_code: 'asc' },
        select: {
          id: true,
          stable_code: true,
          title: true,
          versions: {
            orderBy: { created_at: 'desc' },
            select: {
              id: true,
              semantic_version: true,
              status: true,
              applicability_mode: true,
              items_json: true,
              validation_metadata: true,
              content_hash: true,
              published_at: true,
              created_at: true,
            },
          },
        },
      });

      return rows.map((row) => ({
        methodId: row.id,
        code: row.stable_code,
        title: row.title,
        versions: row.versions.map((version) => ({
          versionId: version.id,
          semanticVersion: version.semantic_version,
          status: version.status as ContentVersionState,
          applicabilityMode: version.applicability_mode as ApplicabilityMode,
          itemCount: itemsSchema.safeParse(version.items_json).data?.length ?? 0,
          // Статус проверки применимости отделён от факта публикации.
          validationStatus:
            (version.validation_metadata as { status?: string } | null)?.status ?? 'not_validated',
          contentHash: version.content_hash,
          publishedAt: version.published_at?.toISOString() ?? null,
          createdAt: version.created_at.toISOString(),
        })),
      }));
    });
  }

  async getMethodVersion(versionId: string): Promise<AdminMethodVersion> {
    return this.prisma.platformOps(async (tx) => {
      const version = await tx.method_versions.findUnique({
        where: { id: versionId },
        select: {
          id: true,
          method_id: true,
          semantic_version: true,
          status: true,
          applicability_mode: true,
          passport_json: true,
          items_json: true,
          scoring_config_json: true,
          fixtures_json: true,
          validation_metadata: true,
          license_metadata: true,
          content_hash: true,
          published_at: true,
          method: { select: { stable_code: true } },
        },
      });

      if (!version) {
        throw AppError.notFound(`Версия методики ${versionId} не найдена`);
      }

      const status = version.status as ContentVersionState;

      return {
        versionId: version.id,
        methodId: version.method_id,
        code: version.method.stable_code,
        semanticVersion: version.semantic_version,
        status,
        applicabilityMode: version.applicability_mode as ApplicabilityMode,
        // Черновик читается мягкой схемой: незаполненные поля — это нормально
        // до публикации, а полноту требует проверка перед ней.
        passport: draftMethodPassportSchema.parse(version.passport_json),
        items: itemsSchema.parse(version.items_json),
        scoring: draftScoringConfigSchema.parse(version.scoring_config_json),
        fixtures: fixturesSchema.parse(version.fixtures_json),
        validationMetadata: (version.validation_metadata ?? {}) as Record<string, unknown>,
        licenseMetadata: (version.license_metadata ?? {}) as Record<string, unknown>,
        contentHash: version.content_hash,
        publishedAt: version.published_at?.toISOString() ?? null,
        editable: status === 'draft',
      };
    });
  }

  /**
   * Прогон контрольных примеров методики.
   *
   * Это проверка того, что заявленные ключи дают заявленные значения, а не
   * подтверждение, что методика что-то измеряет.
   */
  async checkMethodVersion(versionId: string): Promise<MethodCheckResult> {
    const version = await this.getMethodVersion(versionId);
    const blockers: string[] = [];

    if (version.items.length === 0) {
      blockers.push('В методике нет ни одного вопроса.');
    }
    if (version.scoring.scales.length === 0) {
      blockers.push('Не задано ни одной шкалы подсчёта.');
    }
    if (version.fixtures.length === 0) {
      blockers.push('Нет контрольных примеров: публикация без них не допускается.');
    }

    // Паспорт обязан быть полным: пустое научное обоснование не заполняется
    // ни автоматически, ни языковой моделью (ТЗ A05).
    const missing = missingPassportFields(version.passport);
    if (missing.length > 0) {
      blockers.push(`Паспорт заполнен не полностью: ${missing.join(', ')}.`);
    }

    const structural = validateMethodStructure(version.items, version.scoring);
    for (const issue of structural) {
      if (issue.severity === 'blocker') {
        blockers.push(issue.message);
      }
    }

    const itemIds = new Set(version.items.map((item) => item.id));
    for (const scale of version.scoring.scales) {
      for (const itemId of scale.items) {
        if (!itemIds.has(itemId)) {
          blockers.push(`Шкала ${scale.id} ссылается на несуществующий вопрос ${itemId}.`);
        }
      }
    }

    const fixtures: MethodCheckResult['fixtures'] = [];

    for (const fixture of version.fixtures) {
      try {
        const answers = new Map<string, AnswerResponse>(
          Object.entries(fixture.answers).map(([itemId, raw]) => [
            itemId,
            answerResponseSchema.parse(raw),
          ]),
        );

        const result = scoreAttempt(version.items, version.scoring, answers);
        const details = Object.entries(fixture.expected).map(([scaleId, expected]) => {
          const actual = result.scales.find((scale) => scale.scaleId === scaleId)?.value ?? null;
          return { scaleId, expected, actual, matches: actual === expected };
        });

        fixtures.push({
          name: fixture.name,
          passed: details.every((detail) => detail.matches),
          details,
          error: null,
        });
      } catch (error) {
        const message =
          error instanceof ScoringConfigError || error instanceof ScoringInputError
            ? error.message
            : 'Не удалось выполнить подсчёт по этому примеру.';
        fixtures.push({ name: fixture.name, passed: false, details: [], error: message });
      }
    }

    const ok = blockers.length === 0 && fixtures.every((fixture) => fixture.passed);
    return { ok, fixtures, blockers };
  }

  /**
   * Смена состояния версии методики.
   *
   * Переходы проверяются конечным автоматом; публикация дополнительно требует
   * прохождения контрольных примеров.
   */
  async transitionMethodVersion(
    versionId: string,
    next: ContentVersionState,
    actorId: string,
  ): Promise<AdminMethodVersion> {
    const version = await this.getMethodVersion(versionId);
    contentVersionStateMachine.assert(version.status, next);

    if (next === 'published') {
      const check = await this.checkMethodVersion(versionId);
      if (!check.ok) {
        throw AppError.businessRule(
          `Публикация невозможна: ${[...check.blockers, ...check.fixtures.filter((f) => !f.passed).map((f) => `контрольный пример «${f.name}» не сошёлся`)].join('; ')}`,
        );
      }
    }

    await this.prisma.platformOps(async (tx) => {
      await tx.method_versions.update({
        where: { id: versionId },
        data: {
          status: next,
          ...(next === 'published' ? { published_at: new Date(), published_by: actorId } : {}),
        },
      });

      if (next === 'published') {
        await tx.methods.update({
          where: { id: version.methodId },
          data: { current_published_version_id: versionId },
        });
      }

      await this.audit.recordIn(tx, {
        action: 'method_version.transitioned',
        outcome: 'success',
        resourceType: 'method_version',
        resourceId: versionId,
        metadata: { from: version.status, to: next },
      });
    });

    return this.getMethodVersion(versionId);
  }

  async listScenarios(): Promise<AdminScenario[]> {
    return this.prisma.platformOps(async (tx) => {
      const rows = await tx.scenarios.findMany({
        orderBy: { stable_code: 'asc' },
        select: {
          id: true,
          stable_code: true,
          title: true,
          versions: {
            orderBy: { created_at: 'desc' },
            select: {
              id: true,
              semantic_version: true,
              status: true,
              applicability_mode: true,
              context_schema_json: true,
              published_at: true,
              _count: { select: { scenario_methods: true } },
            },
          },
        },
      });

      return rows.map((row) => ({
        scenarioId: row.id,
        code: row.stable_code,
        title: row.title,
        versions: row.versions.map((version) => ({
          versionId: version.id,
          semanticVersion: version.semantic_version,
          status: version.status as ContentVersionState,
          applicabilityMode: version.applicability_mode as ApplicabilityMode,
          methodCount: version._count.scenario_methods,
          contextFieldCount:
            contextSchemaSchema.safeParse(version.context_schema_json).data?.fields.length ?? 0,
          publishedAt: version.published_at?.toISOString() ?? null,
        })),
      }));
    });
  }

  async getScenarioVersion(versionId: string): Promise<AdminScenarioVersion> {
    return this.prisma.platformOps(async (tx) => {
      const version = await tx.scenario_versions.findUnique({
        where: { id: versionId },
        select: {
          id: true,
          scenario_id: true,
          semantic_version: true,
          status: true,
          applicability_mode: true,
          context_schema_json: true,
          participant_visibility: true,
          content_hash: true,
          published_at: true,
          reporting_policy_id: true,
          scenario: { select: { stable_code: true, title: true } },
          reporting_policies: {
            select: {
              stable_code: true,
              semantic_version: true,
              permitted_claims: true,
              required_limitations: true,
              forbidden_claims: true,
            },
          },
          scenario_methods: {
            orderBy: { order_index: 'asc' },
            select: {
              order_index: true,
              required: true,
              method_versions: {
                select: {
                  id: true,
                  method_id: true,
                  semantic_version: true,
                  status: true,
                  applicability_mode: true,
                  passport_json: true,
                  items_json: true,
                  method: { select: { stable_code: true } },
                },
              },
            },
          },
        },
      });

      if (!version) {
        throw AppError.notFound(`Версия сценария ${versionId} не найдена`);
      }

      const status = version.status as ContentVersionState;
      const stringArray = z.array(z.string());

      return {
        versionId: version.id,
        scenarioId: version.scenario_id,
        code: version.scenario.stable_code,
        title: version.scenario.title,
        semanticVersion: version.semantic_version,
        status,
        applicabilityMode: version.applicability_mode as ApplicabilityMode,
        contextSchema: contextSchemaSchema.parse(version.context_schema_json),
        methods: version.scenario_methods.map((link) => {
          const passport = methodPassportSchema.parse(link.method_versions.passport_json);
          return {
            methodId: link.method_versions.method_id,
            methodVersionId: link.method_versions.id,
            code: link.method_versions.method.stable_code,
            title: passport.title,
            semanticVersion: link.method_versions.semantic_version,
            status: link.method_versions.status,
            applicabilityMode: link.method_versions.applicability_mode as ApplicabilityMode,
            orderIndex: link.order_index,
            required: link.required,
            itemCount: itemsSchema.safeParse(link.method_versions.items_json).data?.length ?? 0,
          };
        }),
        reportingPolicyId: version.reporting_policy_id,
        reportingPolicy: version.reporting_policies
          ? {
              code: version.reporting_policies.stable_code,
              semanticVersion: version.reporting_policies.semantic_version,
              permittedClaims: stringArray.parse(version.reporting_policies.permitted_claims),
              requiredLimitations: stringArray.parse(
                version.reporting_policies.required_limitations,
              ),
              forbiddenClaims: stringArray.parse(version.reporting_policies.forbidden_claims),
            }
          : null,
        participantVisibility:
          version.participant_visibility as AdminScenarioVersion['participantVisibility'],
        contentHash: version.content_hash,
        publishedAt: version.published_at?.toISOString() ?? null,
        editable: status === 'draft',
      };
    });
  }

  /**
   * Смена состояния версии сценария.
   *
   * Публикация проверяет вложенные методики: нельзя опубликовать сценарий,
   * который ссылается на неопубликованную версию или на содержимое более
   * низкого уровня готовности, чем сам сценарий.
   */
  async transitionScenarioVersion(
    versionId: string,
    next: ContentVersionState,
    actorId: string,
  ): Promise<AdminScenarioVersion> {
    const version = await this.getScenarioVersion(versionId);
    contentVersionStateMachine.assert(version.status, next);

    if (next === 'published') {
      const problems: string[] = [];

      if (version.methods.length === 0) {
        problems.push('в сценарии нет ни одной методики');
      }
      if (!version.reportingPolicy) {
        problems.push('не задана политика отчёта с обязательными ограничениями');
      }

      for (const method of version.methods) {
        if (method.status !== 'published') {
          problems.push(`методика «${method.title}» не опубликована`);
        }
        if (!isContentAllowedInMode(method.applicabilityMode, version.applicabilityMode)) {
          problems.push(
            `методика «${method.title}» уровня «${method.applicabilityMode}» ниже уровня сценария «${version.applicabilityMode}»`,
          );
        }
      }

      if (problems.length > 0) {
        throw AppError.businessRule(`Публикация невозможна: ${problems.join('; ')}.`);
      }
    }

    await this.prisma.platformOps(async (tx) => {
      await tx.scenario_versions.update({
        where: { id: versionId },
        data: {
          status: next,
          ...(next === 'published' ? { published_at: new Date(), published_by: actorId } : {}),
        },
      });

      if (next === 'published') {
        await tx.scenarios.update({
          where: { id: version.scenarioId },
          data: { current_published_version_id: versionId },
        });
      }

      await this.audit.recordIn(tx, {
        action: 'scenario_version.transitioned',
        outcome: 'success',
        resourceType: 'scenario_version',
        resourceId: versionId,
        metadata: { from: version.status, to: next },
      });
    });

    return this.getScenarioVersion(versionId);
  }
}
