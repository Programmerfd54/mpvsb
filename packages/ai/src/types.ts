import type { ReportContent } from '@context/contracts';
import type { EvidenceKind, GenerationMode, ScenarioCode } from '@context/domain';

/** Одно свидетельство в payload провайдера. Персональных данных здесь нет. */
export interface ReportEvidence {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly collectedAt: string;
  /** Нормализованное содержание: текст ответа, значение шкалы, рабочий факт. */
  readonly content: string;
  readonly limitations: readonly string[];
}

/**
 * Вход подготовки заключения.
 *
 * Содержит только то, что нужно для вывода: код случая вместо имени, контекст
 * решения по allowlist, свидетельства и правила отчёта. Сырые записи БД,
 * идентификаторы сотрудников и исходы исследования сюда не попадают.
 */
export interface ReportInput {
  readonly caseCode: string;
  readonly scenarioCode: ScenarioCode;
  readonly scenarioVersion: string;
  readonly decisionContext: Readonly<Record<string, string>>;
  readonly evidence: readonly ReportEvidence[];
  readonly limitations: readonly string[];
  readonly permittedClaims: readonly string[];
  readonly forbiddenClaims: readonly string[];
  readonly reportingPolicyVersion: string;
  readonly outputSchemaVersion: string;
  /**
   * Возможность прогноза для конкретной цели. Пустой список означает, что поле
   * prediction обязано остаться null — модель не вправе его придумать.
   */
  readonly registeredPredictionCapabilities: readonly string[];
}

export interface ReportDraft {
  readonly content: ReportContent;
  readonly generationMode: GenerationMode;
  readonly modelVersion: string | null;
  readonly promptVersion: string | null;
}

export interface ReportProvider {
  readonly name: string;
  readonly generationMode: GenerationMode;
  generate(input: ReportInput, signal: AbortSignal): Promise<ReportDraft>;
}
