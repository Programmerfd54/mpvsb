import { reportContentSchema, type ReportContent } from '@context/contracts';
import { SUPPORT_LEVELS } from '@context/domain';

import type { ReportInput } from './types';

export interface ValidationIssue {
  readonly code:
    | 'schema_invalid'
    | 'unknown_evidence'
    | 'forbidden_claim'
    | 'unsupported_prediction'
    | 'missing_limitation'
    | 'scenario_mismatch'
    | 'case_mismatch'
    | 'unsupported_number';
  readonly detail: string;
}

/**
 * Числа, похожие на проценты и вероятности, в тексте заключения.
 * Модель не вправе выдавать их без зарегистрированной проверенной возможности.
 */
const PERCENT_RE = /\b\d{1,3}\s?%/u;
const PROBABILITY_RE = /\b(?:вероятност|шанс|риск)\w*\s+(?:в\s+)?\d/iu;

/**
 * Проверка черновика заключения перед сохранением.
 *
 * Детерминированные проверки не находят ложные рассуждения — они закрывают
 * конкретные известные способы навредить: выдуманная ссылка на источник,
 * запрещённое утверждение, самовольный прогноз, потерянное ограничение.
 * Рецензент-человек остаётся обязательным (ТЗ 09.7).
 */
export function validateReportContent(
  raw: unknown,
  input: ReportInput,
):
  | { content: ReportContent; issues: ValidationIssue[] }
  | { content: null; issues: ValidationIssue[] } {
  const parsed = reportContentSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      content: null,
      issues: parsed.error.issues.map((issue) => ({
        code: 'schema_invalid' as const,
        detail: `${issue.path.join('.') || '(корень)'}: ${issue.message}`,
      })),
    };
  }

  const content = parsed.data;
  const issues: ValidationIssue[] = [];

  if (content.scenarioCode !== input.scenarioCode) {
    issues.push({
      code: 'scenario_mismatch',
      detail: `Заключение относится к сценарию ${content.scenarioCode}, а назначение — к ${input.scenarioCode}.`,
    });
  }

  if (content.caseCode !== input.caseCode) {
    issues.push({
      code: 'case_mismatch',
      detail: 'Код случая в заключении не совпадает с обрабатываемым назначением.',
    });
  }

  // Ссылка на несуществующее свидетельство блокирует публикацию.
  const knownEvidence = new Set(input.evidence.map((item) => item.id));
  const referenced: Array<{ where: string; ids: readonly string[] }> = [
    ...content.findings.map((finding) => ({
      where: `finding ${finding.id}`,
      ids: finding.evidenceIds,
    })),
    ...content.contradictions.map((item, index) => ({
      where: `contradiction ${index + 1}`,
      ids: item.evidenceIds,
    })),
    ...content.nextActions.map((action) => ({
      where: `action «${action.title}»`,
      ids: action.evidenceIds,
    })),
  ];

  for (const entry of referenced) {
    for (const id of entry.ids) {
      if (!knownEvidence.has(id)) {
        issues.push({
          code: 'unknown_evidence',
          detail: `${entry.where} ссылается на несуществующее свидетельство ${id}.`,
        });
      }
    }
  }

  // Утверждение о факте обязано на что-то опираться.
  for (const finding of content.findings) {
    if (finding.kind !== 'data_gap' && finding.evidenceIds.length === 0) {
      issues.push({
        code: 'unknown_evidence',
        detail: `Утверждение ${finding.id} не ссылается ни на одно свидетельство.`,
      });
    }
  }

  // Обязательные ограничения политики отчёта должны присутствовать дословно.
  for (const required of input.limitations) {
    if (!content.limitations.includes(required)) {
      issues.push({
        code: 'missing_limitation',
        detail: `В заключении отсутствует обязательное ограничение: «${required}»`,
      });
    }
  }

  // Запрещённые темы ищем по ключевым словам политики.
  const haystack = [
    content.summary,
    ...content.decisionNotes,
    ...content.findings.map((finding) => finding.statement),
    ...content.nextActions.map((action) => `${action.title} ${action.why}`),
    ...content.reconsiderWhen,
  ]
    .join(' ')
    .toLowerCase();

  for (const forbidden of input.forbiddenClaims) {
    const keywords = forbidden
      .toLowerCase()
      .split(/[\s,:]+/u)
      .filter((word) => word.length > 5);
    const hits = keywords.filter((word) => haystack.includes(word));
    if (keywords.length > 0 && hits.length === keywords.length) {
      issues.push({
        code: 'forbidden_claim',
        detail: `Текст затрагивает запрещённое политикой утверждение: «${forbidden}»`,
      });
    }
  }

  if (PERCENT_RE.test(haystack) || PROBABILITY_RE.test(haystack)) {
    issues.push({
      code: 'unsupported_number',
      detail:
        'В тексте есть процент или указание вероятности. Такие числа допустимы только при зарегистрированной проверенной модели.',
    });
  }

  // Прогноз без зарегистрированной возможности не принимается.
  if (content.prediction !== null) {
    const capability = content.prediction.capabilityId;
    if (!input.registeredPredictionCapabilities.includes(capability)) {
      issues.push({
        code: 'unsupported_prediction',
        detail: `Прогноз опирается на незарегистрированную возможность «${capability}». Поле prediction должно остаться пустым.`,
      });
    }
  }

  if (!SUPPORT_LEVELS.includes(content.supportLevel)) {
    issues.push({ code: 'schema_invalid', detail: 'Недопустимый уровень достаточности сведений.' });
  }

  return { content, issues };
}
