import { Injectable } from '@nestjs/common';

import {
  contextSchemaSchema,
  hasScenarioBlockers,
  methodItemSchema,
  methodPassportSchema,
  validateScenarioStructure,
  type AdminScenarioVersion,
  type AvailableMethodVersion,
  type CreateReportingPolicyInput,
  type CreateScenarioInput,
  type CreateScenarioVersionInput,
  type ReportingPolicy,
  type ScenarioIssue,
  type ScenarioMethodBinding,
  type UpdateScenarioVersionInput,
} from '@context/contracts';
import { toJson } from '@context/database';
import type { ApplicabilityMode } from '@context/domain';
import { contentHash } from '@context/scoring';
import { z } from 'zod';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';
import { AdminContentService } from './admin-content.service';

const itemsSchema = z.array(methodItemSchema);
const stringArray = z.array(z.string());

/** Схема контекста нового сценария: минимум, без которого заключение бессмысленно. */
const STARTER_CONTEXT = {
  fields: [
    {
      key: 'decisionQuestion',
      label: 'Какое решение вы принимаете',
      hint: 'Опишите конкретный вопрос по этому сотруднику и срок.',
      type: 'textarea' as const,
      required: true,
      minLength: 20,
      maxLength: 2000,
      isOpinion: false,
      evidenceRole: 'context' as const,
    },
    {
      key: 'workFacts',
      label: 'Наблюдаемые рабочие факты',
      hint: 'Конкретные события и результаты. Без оценок личности.',
      type: 'textarea' as const,
      required: false,
      maxLength: 4000,
      isOpinion: false,
      evidenceRole: 'fact' as const,
    },
  ],
};

/**
 * Редактирование сценария.
 *
 * Версия сценария закрепляет набор версий методик: назначение, созданное по ней,
 * всегда проходит те же тесты в том же порядке. Правится только черновик
 * (ТЗ 01.4, 01.5).
 */
@Injectable()
export class ScenarioEditorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: AdminContentService,
    private readonly audit: AuditService,
  ) {}

  /** Версии методик, которые можно включить в сценарий. */
  async availableMethods(): Promise<AvailableMethodVersion[]> {
    return this.prisma.platformOps(async (tx) => {
      const rows = await tx.method_versions.findMany({
        where: { status: 'published' },
        orderBy: [{ created_at: 'desc' }],
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
      });

      return rows.map((row) => ({
        methodId: row.method_id,
        methodVersionId: row.id,
        code: row.method.stable_code,
        title:
          methodPassportSchema.partial().parse(row.passport_json).title ?? row.method.stable_code,
        semanticVersion: row.semantic_version,
        status: row.status,
        applicabilityMode: row.applicability_mode as ApplicabilityMode,
        itemCount: itemsSchema.safeParse(row.items_json).data?.length ?? 0,
      }));
    });
  }

  async listReportingPolicies(): Promise<ReportingPolicy[]> {
    return this.prisma.platformOps(async (tx) => {
      const rows = await tx.reporting_policies.findMany({
        orderBy: [{ stable_code: 'asc' }, { semantic_version: 'desc' }],
        select: {
          id: true,
          stable_code: true,
          semantic_version: true,
          permitted_claims: true,
          required_limitations: true,
          forbidden_claims: true,
          participant_visibility: true,
        },
      });

      return rows.map((row) => ({
        id: row.id,
        code: row.stable_code,
        semanticVersion: row.semantic_version,
        permittedClaims: stringArray.parse(row.permitted_claims),
        requiredLimitations: stringArray.parse(row.required_limitations),
        forbiddenClaims: stringArray.parse(row.forbidden_claims),
        participantVisibility:
          row.participant_visibility as ReportingPolicy['participantVisibility'],
      }));
    });
  }

  /**
   * Новая политика заключения.
   *
   * Обязательные ограничения — не формальность: именно их наличие в тексте
   * проверяется после подготовки заключения, и без них публикация блокируется.
   */
  async createReportingPolicy(
    input: CreateReportingPolicyInput,
    actorId: string,
  ): Promise<ReportingPolicy> {
    // Проверка повторяется в сервисе, а не только в схеме контроллера:
    // политика без обязательных ограничений позволила бы опубликовать
    // заключение, в котором ограничений нет вообще (ТЗ 09.7).
    const limitations = input.requiredLimitations.filter((item) => item.trim().length > 0);
    if (limitations.length === 0) {
      throw AppError.validation(
        [
          {
            field: 'requiredLimitations',
            message: 'Нужно хотя бы одно обязательное ограничение',
          },
        ],
        'Политика заключения без обязательных ограничений недопустима',
      );
    }

    const id = await this.prisma.platformOps(async (tx) => {
      const existing = await tx.reporting_policies.findFirst({
        where: { stable_code: input.code, semantic_version: input.semanticVersion },
        select: { id: true },
      });
      if (existing) {
        throw AppError.validation(
          [{ field: 'semanticVersion', message: 'Такая версия политики уже существует' }],
          'Код и версия политики должны быть уникальны',
        );
      }

      const created = await tx.reporting_policies.create({
        data: {
          stable_code: input.code,
          semantic_version: input.semanticVersion,
          permitted_claims: toJson(input.permittedClaims),
          required_limitations: toJson(limitations),
          forbidden_claims: toJson(input.forbiddenClaims),
          participant_visibility: 'completion_receipt',
        },
        select: { id: true },
      });

      await this.audit.recordIn(tx, {
        action: 'reporting_policy.created',
        outcome: 'success',
        resourceType: 'reporting_policy',
        resourceId: created.id,
        metadata: { code: input.code, actorId },
      });

      return created.id;
    });

    const policies = await this.listReportingPolicies();
    const policy = policies.find((item) => item.id === id);
    if (!policy) {
      throw AppError.notFound('Политика заключения не найдена после создания');
    }
    return policy;
  }

  async createScenario(input: CreateScenarioInput, actorId: string): Promise<AdminScenarioVersion> {
    const versionId = await this.prisma.platformOps(async (tx) => {
      const existing = await tx.scenarios.findUnique({
        where: { stable_code: input.code },
        select: { id: true },
      });
      if (existing) {
        throw AppError.validation(
          [{ field: 'code', message: 'Сценарий с таким кодом уже существует' }],
          'Код сценария должен быть уникальным',
        );
      }

      const scenario = await tx.scenarios.create({
        data: { stable_code: input.code, title: input.title },
        select: { id: true },
      });

      const version = await tx.scenario_versions.create({
        data: {
          scenario_id: scenario.id,
          semantic_version: input.semanticVersion || '1.0.0',
          status: 'draft',
          applicability_mode: 'demo',
          context_schema_json: toJson(STARTER_CONTEXT),
          participant_visibility: 'completion_receipt',
        },
        select: { id: true },
      });

      await this.audit.recordIn(tx, {
        action: 'scenario.created',
        outcome: 'success',
        resourceType: 'scenario_version',
        resourceId: version.id,
        metadata: { code: input.code, actorId },
      });

      return version.id;
    });

    return this.content.getScenarioVersion(versionId);
  }

  async createVersion(
    scenarioId: string,
    input: CreateScenarioVersionInput,
    actorId: string,
  ): Promise<AdminScenarioVersion> {
    const versionId = await this.prisma.platformOps(async (tx) => {
      const scenario = await tx.scenarios.findUnique({
        where: { id: scenarioId },
        select: { id: true },
      });
      if (!scenario) {
        throw AppError.notFound(`Сценарий ${scenarioId} не найден`);
      }

      const duplicate = await tx.scenario_versions.findFirst({
        where: { scenario_id: scenarioId, semantic_version: input.semanticVersion },
        select: { id: true },
      });
      if (duplicate) {
        throw AppError.validation(
          [{ field: 'semanticVersion', message: 'Такая версия уже существует' }],
          'Номер версии должен быть уникальным внутри сценария',
        );
      }

      const source = input.copyFromVersionId
        ? await tx.scenario_versions.findFirst({
            where: { id: input.copyFromVersionId, scenario_id: scenarioId },
            select: {
              context_schema_json: true,
              applicability_mode: true,
              reporting_policy_id: true,
              participant_visibility: true,
              scenario_methods: {
                select: { method_version_id: true, order_index: true, required: true },
              },
            },
          })
        : null;

      if (input.copyFromVersionId && !source) {
        throw AppError.notFound('Исходная версия не найдена в этом сценарии');
      }

      const contextSchema = source?.context_schema_json ?? toJson(STARTER_CONTEXT);

      const version = await tx.scenario_versions.create({
        data: {
          scenario_id: scenarioId,
          semantic_version: input.semanticVersion,
          status: 'draft',
          applicability_mode: source?.applicability_mode ?? 'demo',
          context_schema_json: contextSchema,
          reporting_policy_id: source?.reporting_policy_id ?? null,
          participant_visibility: source?.participant_visibility ?? 'completion_receipt',
          // Хэш копии считается сразу: без него публикация нарушила бы
          // ограничение неизменяемости опубликованной версии.
          content_hash: source
            ? contentHash({
                contextSchema,
                methods: source.scenario_methods.map((link) => ({
                  methodVersionId: link.method_version_id,
                  orderIndex: link.order_index,
                  required: link.required,
                })),
                reportingPolicyId: source.reporting_policy_id,
              })
            : null,
        },
        select: { id: true },
      });

      if (source && source.scenario_methods.length > 0) {
        await tx.scenario_methods.createMany({
          data: source.scenario_methods.map((link) => ({
            scenario_version_id: version.id,
            method_version_id: link.method_version_id,
            order_index: link.order_index,
            required: link.required,
          })),
        });
      }

      await this.audit.recordIn(tx, {
        action: 'scenario_version.created',
        outcome: 'success',
        resourceType: 'scenario_version',
        resourceId: version.id,
        metadata: {
          semanticVersion: input.semanticVersion,
          copiedFrom: input.copyFromVersionId ?? null,
          actorId,
        },
      });

      return version.id;
    });

    return this.content.getScenarioVersion(versionId);
  }

  /**
   * Сохранение черновика сценария.
   *
   * Структура проверяется до записи: две версии одной методики, неопубликованная
   * методика и отсутствие политики заключения не сохраняются.
   */
  async updateDraft(
    versionId: string,
    input: UpdateScenarioVersionInput,
    actorId: string,
  ): Promise<AdminScenarioVersion> {
    const issues = await this.evaluate(versionId, input);

    if (hasScenarioBlockers(issues)) {
      throw AppError.validation(
        issues
          .filter((issue) => issue.severity === 'blocker')
          .map((issue) => ({ field: issue.target, message: issue.message })),
        'Сценарий нельзя сохранить: есть противоречия в составе или схеме контекста',
      );
    }

    await this.prisma.platformOps(async (tx) => {
      const version = await tx.scenario_versions.findUnique({
        where: { id: versionId },
        select: { id: true, status: true, content_hash: true },
      });

      if (!version) {
        throw AppError.notFound(`Версия сценария ${versionId} не найдена`);
      }
      if (version.status !== 'draft') {
        throw AppError.conflict(
          'Эта версия уже не черновик. Создайте новую версию, чтобы внести изменения.',
        );
      }
      if (version.content_hash !== input.expectedContentHash) {
        throw AppError.revisionConflict(
          'Версия была изменена в другом окне. Обновите страницу, чтобы не потерять чужую правку.',
        );
      }

      const nextHash = contentHash({
        contextSchema: input.contextSchema,
        methods: input.methods,
        reportingPolicyId: input.reportingPolicyId,
      });

      await tx.scenario_versions.update({
        where: { id: versionId },
        data: {
          applicability_mode: input.applicabilityMode,
          context_schema_json: toJson(input.contextSchema),
          reporting_policy_id: input.reportingPolicyId,
          participant_visibility: input.participantVisibility,
          content_hash: nextHash,
        },
      });

      // Состав методик переписывается целиком: порядок и обязательность —
      // это единое свойство версии, а не набор независимых записей.
      await tx.scenario_methods.deleteMany({ where: { scenario_version_id: versionId } });
      if (input.methods.length > 0) {
        await tx.scenario_methods.createMany({
          data: input.methods
            .slice()
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((link, index) => ({
              scenario_version_id: versionId,
              method_version_id: link.methodVersionId,
              order_index: index,
              required: link.required,
            })),
        });
      }

      await this.audit.recordIn(tx, {
        action: 'scenario_version.updated',
        outcome: 'success',
        resourceType: 'scenario_version',
        resourceId: versionId,
        metadata: {
          methodCount: input.methods.length,
          fieldCount: input.contextSchema.fields.length,
          warnings: issues.length,
          actorId,
        },
      });
    });

    return this.content.getScenarioVersion(versionId);
  }

  /** Замечания по предполагаемому составу версии. Ничего не записывает. */
  async evaluate(
    versionId: string,
    input: Pick<
      UpdateScenarioVersionInput,
      'applicabilityMode' | 'contextSchema' | 'methods' | 'reportingPolicyId'
    >,
  ): Promise<ScenarioIssue[]> {
    const parsedSchema = contextSchemaSchema.safeParse(input.contextSchema);
    if (!parsedSchema.success) {
      return [
        {
          code: 'invalid_field_key',
          severity: 'blocker',
          message: 'Схема контекста не соответствует формату.',
          target: 'contextSchema',
        },
      ];
    }

    const available = await this.availableMethods();
    const byVersion = new Map(available.map((item) => [item.methodVersionId, item]));

    const bindings: ScenarioMethodBinding[] = [];
    for (const link of input.methods) {
      const method = byVersion.get(link.methodVersionId);
      if (!method) {
        // Версия неизвестна или не опубликована: подробности даст общая проверка.
        bindings.push({
          methodId: link.methodVersionId,
          methodVersionId: link.methodVersionId,
          title: 'Неизвестная версия методики',
          semanticVersion: '—',
          status: 'unknown',
          applicabilityMode: 'demo',
          orderIndex: link.orderIndex,
          required: link.required,
        });
        continue;
      }
      bindings.push({
        methodId: method.methodId,
        methodVersionId: method.methodVersionId,
        title: method.title,
        semanticVersion: method.semanticVersion,
        status: method.status,
        applicabilityMode: method.applicabilityMode,
        orderIndex: link.orderIndex,
        required: link.required,
      });
    }

    const policies = await this.listReportingPolicies();
    const policy = input.reportingPolicyId
      ? policies.find((item) => item.id === input.reportingPolicyId)
      : undefined;

    // Версия сценария не может быть выше уровня, чем она сама объявлена:
    // проверка сравнивает уровни методик именно с ним.
    return validateScenarioStructure({
      contextSchema: parsedSchema.data,
      methods: bindings,
      applicabilityMode: input.applicabilityMode,
      hasReportingPolicy: policy !== undefined,
      requiredLimitationCount: policy?.requiredLimitations.length ?? 0,
    });
  }

  /** Замечания по сохранённой версии: показываются в редакторе при открытии. */
  async issuesFor(versionId: string): Promise<ScenarioIssue[]> {
    const version = await this.content.getScenarioVersion(versionId);

    return this.evaluate(versionId, {
      applicabilityMode: version.applicabilityMode,
      contextSchema: version.contextSchema,
      methods: version.methods.map((method) => ({
        methodVersionId: method.methodVersionId,
        orderIndex: method.orderIndex,
        required: method.required,
      })),
      reportingPolicyId: version.reportingPolicyId,
    });
  }
}
