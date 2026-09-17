import {
  REPORT_OUTPUT_SCHEMA_VERSION,
  contextValuesSchema,
  type ReportContent,
} from '@context/contracts';
import { toJson, withTenant, type PrismaClient, type TenantTransaction } from '@context/database';
import { caseCodeFor, type OrganizationMode, type ScenarioCode } from '@context/domain';
import {
  assertProviderAllowedInMode,
  createReportProvider,
  validateReportContent,
  type ReportInput,
} from '@context/ai';
import { contentHash } from '@context/scoring';
import { z } from 'zod';

import { loadWorkerConfig } from '../env.js';
import { workerLogger } from '../logger.js';
import { buildEvidence, evidenceHash, type BuiltEvidence } from './evidence.js';

const policySchema = z.object({
  permitted_claims: z.array(z.string()).default([]),
  required_limitations: z.array(z.string()).default([]),
  forbidden_claims: z.array(z.string()).default([]),
});

const contextFieldSchema = z.object({
  fields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      isOpinion: z.boolean().default(false),
      evidenceRole: z.enum(['context', 'fact', 'opinion']).default('context'),
    }),
  ),
});

export interface GenerateReportJob {
  readonly organizationId: string;
  readonly entityId: string;
  readonly dataGeneration: string;
}

export interface GenerateReportResult {
  readonly status: 'drafted' | 'skipped' | 'failed';
  readonly reason?: string;
  readonly reportId?: string;
  /** Стабильный код неудачи для журнала обработки. Текст исключения туда не попадает. */
  readonly failureCode?: string;
}

/**
 * Подготовка черновика заключения.
 *
 * Порядок важен: провайдер вызывается вне длинной транзакции, а перед записью
 * результата поколение данных проверяется повторно. Если между вызовом и записью
 * назначение отменили, черновик не сохраняется (ТЗ 06.6).
 */
export async function runGenerateReport(
  prisma: PrismaClient,
  job: GenerateReportJob,
): Promise<GenerateReportResult> {
  const config = loadWorkerConfig();
  const logger = workerLogger();

  // 1. Сбор входных данных в короткой транзакции.
  const prepared = await withTenant(prisma, { organizationId: job.organizationId }, async (tx) => {
    const assignment = await tx.assignments.findFirst({
      where: { id: job.entityId, organization_id: job.organizationId },
      select: {
        id: true,
        state: true,
        mode: true,
        data_generation: true,
        processing_hold: true,
        context_snapshot: true,
        reports: { select: { id: true } },
        scenario_versions: {
          select: {
            semantic_version: true,
            context_schema_json: true,
            prompt_version_id: true,
            scenario: { select: { stable_code: true } },
            reporting_policies: {
              select: {
                stable_code: true,
                semantic_version: true,
                permitted_claims: true,
                required_limitations: true,
                forbidden_claims: true,
              },
            },
          },
        },
      },
    });

    if (!assignment) {
      return null;
    }
    if (assignment.data_generation.toString() !== job.dataGeneration) {
      return { skip: 'Поколение данных изменилось после постановки задачи' } as const;
    }
    if (assignment.processing_hold) {
      return { skip: 'Обработка приостановлена по запросу о данных' } as const;
    }
    if (assignment.state !== 'completed') {
      return { skip: `Назначение в состоянии ${assignment.state}` } as const;
    }
    if (assignment.reports) {
      return { skip: 'Заключение уже создано' } as const;
    }

    const evidence = await buildEvidence(tx, job.organizationId, assignment.id);
    const policy = policySchema.parse(assignment.scenario_versions.reporting_policies ?? {});

    return {
      assignmentId: assignment.id,
      mode: assignment.mode as OrganizationMode,
      scenarioCode: assignment.scenario_versions.scenario.stable_code as ScenarioCode,
      scenarioVersion: assignment.scenario_versions.semantic_version,
      promptVersionId: assignment.scenario_versions.prompt_version_id,
      policyVersion: assignment.scenario_versions.reporting_policies
        ? `${assignment.scenario_versions.reporting_policies.stable_code}@${assignment.scenario_versions.reporting_policies.semantic_version}`
        : 'unspecified',
      policy,
      evidence,
      decisionContext: buildDecisionContext(
        assignment.context_snapshot,
        assignment.scenario_versions.context_schema_json,
      ),
    };
  });

  if (prepared === null) {
    return { status: 'skipped', reason: 'Назначение не найдено' };
  }
  if ('skip' in prepared) {
    return { status: 'skipped', reason: prepared.skip };
  }

  // 2. Вызов провайдера вне транзакции БД.
  const provider = createReportProvider(config.REPORT_PROVIDER);
  assertProviderAllowedInMode(provider, prepared.mode);

  const input: ReportInput = {
    caseCode: caseCodeFor(prepared.assignmentId),
    scenarioCode: prepared.scenarioCode,
    scenarioVersion: prepared.scenarioVersion,
    decisionContext: prepared.decisionContext,
    evidence: prepared.evidence.map((item) => ({
      id: item.code,
      kind: item.kind,
      collectedAt: item.collectedAt.toISOString(),
      content: item.content,
      limitations: item.limitations,
    })),
    limitations: prepared.policy.required_limitations,
    permittedClaims: prepared.policy.permitted_claims,
    forbiddenClaims: prepared.policy.forbidden_claims,
    reportingPolicyVersion: prepared.policyVersion,
    outputSchemaVersion: REPORT_OUTPUT_SCHEMA_VERSION,
    // Проверенных моделей прогноза нет: поле prediction обязано остаться пустым.
    registeredPredictionCapabilities: [],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.REPORT_PROVIDER_TIMEOUT_MS);

  let draft;
  try {
    draft = await provider.generate(input, controller.signal);
  } catch (error) {
    logger.error(
      { err: error, assignmentId: prepared.assignmentId },
      'Провайдер не вернул черновик',
    );
    await markFailed(prisma, job, 'provider_error');
    return { status: 'failed', reason: (error as Error).message, failureCode: 'provider_error' };
  } finally {
    clearTimeout(timeout);
  }

  // 3. Проверка выхода. Несоответствие блокирует публикацию, а не правится молча.
  const validation = validateReportContent(draft.content, input);
  if (validation.content === null || validation.issues.length > 0) {
    logger.error(
      { assignmentId: prepared.assignmentId, issues: validation.issues },
      'Черновик заключения не прошёл проверку',
    );
    const failureCode = validation.issues[0]?.code ?? 'validation_failed';
    await markFailed(prisma, job, failureCode);
    return {
      status: 'failed',
      reason: validation.issues.map((issue) => issue.detail).join('; '),
      failureCode,
    };
  }

  // 4. Запись черновика с повторной проверкой ограды поколения.
  return withTenant(prisma, { organizationId: job.organizationId }, async (tx) => {
    const fresh = await tx.assignments.findFirst({
      where: { id: prepared.assignmentId, organization_id: job.organizationId },
      select: {
        state: true,
        data_generation: true,
        processing_hold: true,
        reports: { select: { id: true } },
      },
    });

    if (
      !fresh ||
      fresh.data_generation.toString() !== job.dataGeneration ||
      fresh.processing_hold ||
      fresh.state !== 'completed'
    ) {
      return { status: 'skipped', reason: 'Состояние изменилось во время подготовки' };
    }
    if (fresh.reports) {
      return { status: 'skipped', reason: 'Заключение уже создано' };
    }

    await persistEvidence(tx, job.organizationId, prepared.assignmentId, prepared.evidence);

    const report = await tx.reports.create({
      data: {
        organization_id: job.organizationId,
        assignment_id: prepared.assignmentId,
        status: 'pending_review',
      },
      select: { id: true },
    });

    const content: ReportContent = validation.content;

    await tx.report_revisions.create({
      data: {
        organization_id: job.organizationId,
        report_id: report.id,
        revision_no: 1,
        state: 'pending_review',
        input_hash: contentHash(input),
        evidence_snapshot_hash: evidenceHash(prepared.evidence),
        prompt_version_id: prepared.promptVersionId,
        output_schema_version: REPORT_OUTPUT_SCHEMA_VERSION,
        model_version: draft.modelVersion,
        generation_mode: draft.generationMode,
        content_json: toJson(content),
        content_hash: contentHash(content),
      },
    });

    return { status: 'drafted', reportId: report.id };
  });
}

async function markFailed(
  prisma: PrismaClient,
  job: GenerateReportJob,
  failureCode: string,
): Promise<void> {
  await withTenant(prisma, { organizationId: job.organizationId }, async (tx) => {
    const existing = await tx.reports.findFirst({
      where: { organization_id: job.organizationId, assignment_id: job.entityId },
      select: { id: true },
    });

    const report =
      existing ??
      (await tx.reports.create({
        data: {
          organization_id: job.organizationId,
          assignment_id: job.entityId,
          status: 'generation_failed',
        },
        select: { id: true },
      }));

    if (existing) {
      await tx.reports.update({ where: { id: report.id }, data: { status: 'generation_failed' } });
    }

    const last = await tx.report_revisions.findFirst({
      where: { organization_id: job.organizationId, report_id: report.id },
      orderBy: { revision_no: 'desc' },
      select: { revision_no: true },
    });

    await tx.report_revisions.create({
      data: {
        organization_id: job.organizationId,
        report_id: report.id,
        revision_no: (last?.revision_no ?? 0) + 1,
        state: 'generation_failed',
        failure_code: failureCode,
      },
    });
  });
}

async function persistEvidence(
  tx: TenantTransaction,
  organizationId: string,
  assignmentId: string,
  evidence: readonly BuiltEvidence[],
): Promise<void> {
  for (const item of evidence) {
    await tx.evidence_items.upsert({
      where: {
        organization_id_assignment_id_evidence_code: {
          organization_id: organizationId,
          assignment_id: assignmentId,
          evidence_code: item.code,
        },
      },
      create: {
        organization_id: organizationId,
        assignment_id: assignmentId,
        evidence_code: item.code,
        kind: item.kind,
        source_ref: item.sourceRef,
        collected_at: item.collectedAt,
        normalized_content: toJson({ text: item.content }),
        limitations: toJson(item.limitations),
        content_hash: contentHash({ content: item.content, limitations: item.limitations }),
      },
      update: {},
    });
  }
}

/** Контекст решения по allowlist схемы сценария. Произвольные поля не проходят. */
function buildDecisionContext(snapshot: unknown, schemaJson: unknown): Record<string, string> {
  const context = contextValuesSchema.parse(snapshot);
  const schema = contextFieldSchema.parse(schemaJson);
  const result: Record<string, string> = {};

  for (const field of schema.fields) {
    const value = context[field.key];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      result[field.label] = String(value);
    }
  }

  return result;
}
