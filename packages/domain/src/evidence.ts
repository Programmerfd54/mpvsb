/**
 * Типы свидетельств в заключении (ТЗ 09.4).
 * Факт и самоотчёт различаются явно и не смешиваются в одном утверждении.
 */
export const EVIDENCE_KINDS = [
  'self_report',
  'manager_opinion',
  'work_fact',
  'method_result',
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_KIND_LABELS: Readonly<Record<EvidenceKind, string>> = {
  self_report: 'Ответ сотрудника',
  manager_opinion: 'Мнение руководителя',
  work_fact: 'Рабочий факт',
  method_result: 'Результат методики',
};

/** Пояснение к источнику, которое видит руководитель рядом с утверждением. */
export const EVIDENCE_KIND_LIMITS: Readonly<Record<EvidenceKind, string>> = {
  self_report: 'Это то, что сообщил сам сотрудник, а не проверенный факт.',
  manager_opinion: 'Это оценка руководителя, а не независимое наблюдение.',
  work_fact: 'Факт указан руководителем; система его не проверяла.',
  method_result: 'Результат расчёта по зафиксированной версии методики.',
};

/** Вид утверждения в заключении (ТЗ 09.6). */
export const FINDING_KINDS = ['observed', 'self_report', 'interpretation', 'data_gap'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const FINDING_KIND_LABELS: Readonly<Record<FindingKind, string>> = {
  observed: 'Наблюдение',
  self_report: 'Со слов сотрудника',
  interpretation: 'Интерпретация',
  data_gap: 'Нет сведений',
};

/**
 * Отсутствие сведений не является отрицательным качеством человека.
 * Текст используется в отчёте и в проверках рецензента.
 */
export const DATA_GAP_DISCLAIMER =
  'Отсутствие сведений означает, что материалов не было предоставлено, а не отсутствие способности.';
