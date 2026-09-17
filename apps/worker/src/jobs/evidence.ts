import {
  answerResponseSchema,
  contextValuesSchema,
  methodItemSchema,
  methodPassportSchema,
  type AnswerResponse,
  type MethodItem,
} from '@context/contracts';
import type { TenantTransaction } from '@context/database';
import { EVIDENCE_KIND_LIMITS, type EvidenceKind } from '@context/domain';
import { contentHash } from '@context/scoring';
import { z } from 'zod';

const itemsSchema = z.array(methodItemSchema);

const scaleResultSchema = z.object({
  scaleId: z.string(),
  title: z.string(),
  description: z.string(),
  value: z.number().nullable(),
  itemsUsed: z.number(),
  itemsExpected: z.number(),
  expectedRange: z.object({ min: z.number(), max: z.number() }),
  unresolved: z.array(z.string()),
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

export interface BuiltEvidence {
  readonly code: string;
  readonly kind: EvidenceKind;
  readonly collectedAt: Date;
  readonly content: string;
  readonly limitations: string[];
  readonly sourceRef: string | null;
}

/**
 * Сбор свидетельств для заключения.
 *
 * Правила (ТЗ 09.4):
 *   * источники разделены по типу: самоотчёт, мнение руководителя, рабочий факт,
 *     результат методики — и не смешиваются в одном утверждении;
 *   * неопределённое значение шкалы отражается как отсутствие сведений,
 *     а не как низкий результат;
 *   * имя, email и идентификатор сотрудника в свидетельства не попадают —
 *     роль worker вообще не имеет доступа к схеме identity.
 */
export async function buildEvidence(
  tx: TenantTransaction,
  organizationId: string,
  assignmentId: string,
): Promise<BuiltEvidence[]> {
  const assignment = await tx.assignments.findFirstOrThrow({
    where: { id: assignmentId, organization_id: organizationId },
    select: {
      created_at: true,
      context_snapshot: true,
      scenario_versions: { select: { context_schema_json: true } },
      attempts: {
        orderBy: { order_index: 'asc' },
        select: {
          id: true,
          submitted_at: true,
          method_versions: { select: { passport_json: true, items_json: true } },
          submission_snapshots: { select: { answers_snapshot_json: true, submitted_at: true } },
          score_results: {
            orderBy: { created_at: 'desc' },
            take: 1,
            select: { result_json: true, missing_json: true, created_at: true },
          },
        },
      },
    },
  });

  const evidence: BuiltEvidence[] = [];
  let counter = 0;
  const nextCode = (): string => `ev_${++counter}`;

  // 1. Контекст решения от руководителя.
  //
  // Свидетельствами становятся только поля, помеченные как наблюдаемый факт или
  // мнение. Параметры самой задачи — формулировка вопроса, целевая роль, срок —
  // это условия решения, а не наблюдения о человеке, и подтверждением служить
  // не могут.
  const context = contextValuesSchema.parse(assignment.context_snapshot);
  const schema = contextFieldSchema.parse(assignment.scenario_versions.context_schema_json);

  for (const field of schema.fields) {
    if (field.evidenceRole === 'context') {
      continue;
    }
    const value = context[field.key];
    if (value === null || value === undefined || String(value).trim() === '') {
      continue;
    }
    const kind: EvidenceKind = field.evidenceRole === 'opinion' ? 'manager_opinion' : 'work_fact';
    evidence.push({
      code: nextCode(),
      kind,
      collectedAt: assignment.created_at,
      content: `${field.label}: ${String(value)}`,
      limitations: [EVIDENCE_KIND_LIMITS[kind]],
      sourceRef: `context.${field.key}`,
    });
  }

  // 2. Ответы участника и результаты методик.
  for (const attempt of assignment.attempts) {
    const passport = methodPassportSchema.parse(attempt.method_versions.passport_json);
    const items = itemsSchema.parse(attempt.method_versions.items_json);
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const collectedAt = attempt.submission_snapshots?.submitted_at ?? attempt.submitted_at;

    if (!collectedAt) {
      continue;
    }

    // Свободный текст участника — отдельные свидетельства самоотчёта.
    if (attempt.submission_snapshots) {
      const answers = z
        .record(z.string(), answerResponseSchema)
        .parse(attempt.submission_snapshots.answers_snapshot_json);

      for (const [itemId, answer] of Object.entries(answers)) {
        const item = itemsById.get(itemId);
        if (!item) {
          continue;
        }
        const text = textualAnswer(item, answer);
        if (text === null) {
          continue;
        }
        evidence.push({
          code: nextCode(),
          kind: 'self_report',
          collectedAt,
          content: `${item.prompt} — ${text}`,
          limitations: [EVIDENCE_KIND_LIMITS.self_report],
          sourceRef: `attempt.${attempt.id}.${itemId}`,
        });
      }
    }

    const score = attempt.score_results[0];
    if (!score) {
      continue;
    }

    const scales = z.array(scaleResultSchema).parse(score.result_json);
    for (const scale of scales) {
      const limitations = [EVIDENCE_KIND_LIMITS.method_result, ...passport.limitations];

      if (scale.value === null) {
        // Отсутствие результата — отсутствие сведений, а не низкий балл.
        evidence.push({
          code: nextCode(),
          kind: 'method_result',
          collectedAt: score.created_at,
          content: `«${passport.title}», ${scale.title}: результат не определён (ответов ${scale.itemsUsed} из ${scale.itemsExpected}).`,
          limitations: [
            ...limitations,
            'Отсутствие значения означает нехватку ответов, а не низкий результат.',
          ],
          sourceRef: `score.${attempt.id}.${scale.scaleId}`,
        });
        continue;
      }

      evidence.push({
        code: nextCode(),
        kind: 'method_result',
        collectedAt: score.created_at,
        content: `«${passport.title}», ${scale.title}: ${scale.value} в диапазоне от ${scale.expectedRange.min} до ${scale.expectedRange.max}. ${scale.description}`,
        limitations,
        sourceRef: `score.${attempt.id}.${scale.scaleId}`,
      });
    }
  }

  return evidence;
}

/** Текстовое представление ответа для свидетельства самоотчёта. */
function textualAnswer(item: MethodItem, answer: AnswerResponse): string | null {
  if (item.type === 'short_text' && answer.type === 'short_text') {
    const text = answer.text.trim();
    return text.length > 0 ? text : null;
  }
  if (item.type === 'situational' && answer.type === 'situational') {
    if (item.response.kind === 'short_text') {
      const text = (answer.text ?? '').trim();
      return text.length > 0 ? text : null;
    }
    const option = item.response.options.find((candidate) => candidate.id === answer.optionId);
    return option ? option.label : null;
  }
  // Ответы шкал попадают в заключение через результаты методики, а не поштучно.
  return null;
}

export function evidenceHash(evidence: readonly BuiltEvidence[]): string {
  return contentHash(
    evidence.map((item) => ({
      code: item.code,
      kind: item.kind,
      content: item.content,
      limitations: item.limitations,
    })),
  );
}
