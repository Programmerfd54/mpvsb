import { REPORT_OUTPUT_SCHEMA_VERSION, type ReportDetail } from '@context/contracts';

interface Check {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Формулировки, из-за которых стоит вручную свериться с источником. */
const NUMERIC_CLAIM_PATTERN = /\d+\s?%|вероятн|процент/iu;

/**
 * Автоматические проверки черновика (ТЗ M15): подсказки для рецензента,
 * а не гарантия отсутствия ошибок. Каждая проверка — реальное вычисление
 * над уже загруженным черновиком, без обращения к внешним источникам
 * научной валидности и без придуманных чисел.
 */
export function computeChecks(report: ReportDetail): readonly Check[] {
  const content = report.content;
  const evidenceCodes = new Set(report.evidence.map((item) => item.evidenceCode));

  const findingsMissingSource = content.findings.filter((finding) =>
    finding.evidenceIds.some((code) => !evidenceCodes.has(code)),
  );
  const findingsWithoutAnySource = content.findings.filter(
    (finding) => finding.evidenceIds.length === 0 && finding.kind !== 'data_gap',
  );

  const textsToScan = [
    content.summary,
    ...content.findings.map((finding) => finding.statement),
    ...content.decisionNotes,
    ...content.nextActions.flatMap((action) => [action.title, action.why]),
    ...content.reconsiderWhen,
  ];
  const flaggedTexts = textsToScan.filter((text) => NUMERIC_CLAIM_PATTERN.test(text));

  return [
    {
      id: 'schema',
      label: 'Формат черновика',
      ok: content.schemaVersion === REPORT_OUTPUT_SCHEMA_VERSION,
      detail:
        content.schemaVersion === REPORT_OUTPUT_SCHEMA_VERSION
          ? `Содержимое соответствует ожидаемой версии схемы (${REPORT_OUTPUT_SCHEMA_VERSION}).`
          : `Версия схемы черновика (${content.schemaVersion}) отличается от текущей (${REPORT_OUTPUT_SCHEMA_VERSION}).`,
    },
    {
      id: 'sources',
      label: 'Полнота источников',
      ok: findingsMissingSource.length === 0 && findingsWithoutAnySource.length === 0,
      detail:
        findingsMissingSource.length === 0 && findingsWithoutAnySource.length === 0
          ? 'Каждое утверждение либо ссылается на существующий источник, либо помечено как «нет сведений».'
          : [
              findingsMissingSource.length > 0
                ? `${findingsMissingSource.length} утв. ссылаются на источник, которого нет в перечне.`
                : null,
              findingsWithoutAnySource.length > 0
                ? `${findingsWithoutAnySource.length} утв. без единого источника.`
                : null,
            ]
              .filter(Boolean)
              .join(' '),
    },
    {
      id: 'limitations',
      label: 'Ограничения указаны',
      ok: content.limitations.length > 0,
      detail:
        content.limitations.length > 0
          ? `Указано ограничений: ${content.limitations.length}.`
          : 'Список ограничений пуст — без него заключение публиковать нельзя.',
    },
    {
      id: 'numbers',
      label: 'Числа и вероятностные формулировки',
      ok: flaggedTexts.length === 0,
      detail:
        flaggedTexts.length === 0
          ? 'Явных процентов или слов о вероятности не найдено.'
          : `Найдено формулировок с процентом или вероятностью: ${flaggedTexts.length}. Проверьте, что это не выдуманное число.`,
    },
    {
      id: 'contradictions',
      label: 'Противоречия в источниках',
      ok: content.contradictions.length === 0,
      detail:
        content.contradictions.length === 0
          ? 'Противоречий между источниками не отмечено.'
          : `Отмечено противоречий: ${content.contradictions.length}. Они показаны во вкладке «Заключение».`,
    },
  ];
}
