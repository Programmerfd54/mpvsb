import type { ReportContent } from '@context/contracts';
import { DATA_GAP_DISCLAIMER, EVIDENCE_KIND_LABELS } from '@context/domain';

import type { ReportDraft, ReportInput, ReportProvider } from './types';

/**
 * Провайдер структурированной записки по явным правилам.
 *
 * Он ничего не «понимает»: он перечисляет собранные сведения, отмечает пробелы
 * и предлагает уточняющие действия. Свободной аналитики здесь нет — это честный
 * вариант по умолчанию, когда языковая модель недоступна или не разрешена.
 */
export class TemplateReportProvider implements ReportProvider {
  readonly name = 'template';
  readonly generationMode = 'template' as const;

  async generate(input: ReportInput, signal: AbortSignal): Promise<ReportDraft> {
    signal.throwIfAborted();

    const byKind = groupByKind(input.evidence);
    const methodResults = byKind.method_result ?? [];
    const selfReports = byKind.self_report ?? [];
    const workFacts = byKind.work_fact ?? [];
    const opinions = byKind.manager_opinion ?? [];

    const findings: ReportContent['findings'] = [];
    let counter = 0;
    const nextId = (): string => `finding_${++counter}`;

    for (const evidence of methodResults) {
      findings.push({
        id: nextId(),
        statement: evidence.content,
        evidenceIds: [evidence.id],
        kind: 'interpretation',
        limitations: [...evidence.limitations],
      });
    }

    for (const evidence of selfReports.slice(0, 6)) {
      findings.push({
        id: nextId(),
        statement: `Со слов сотрудника: ${evidence.content}`,
        evidenceIds: [evidence.id],
        kind: 'self_report',
        limitations: [...evidence.limitations],
      });
    }

    for (const evidence of workFacts) {
      findings.push({
        id: nextId(),
        statement: `Руководитель указал рабочий факт: ${evidence.content}`,
        evidenceIds: [evidence.id],
        kind: 'observed',
        limitations: [...evidence.limitations],
      });
    }

    // Пробелы отмечаются явно и опираются на реальные записи о нехватке сведений,
    // а не на выдуманную ссылку.
    const gaps = byKind_dataGaps(input);
    for (const gap of gaps) {
      findings.push({
        id: nextId(),
        statement: gap.statement,
        evidenceIds: gap.evidenceIds,
        kind: 'data_gap',
        limitations: [DATA_GAP_DISCLAIMER],
      });
    }

    const contradictions = findContradictions(opinions, selfReports);

    const supportLevel: ReportContent['supportLevel'] =
      workFacts.length === 0 && methodResults.length === 0
        ? 'insufficient'
        : workFacts.length === 0 || gaps.length > 0
          ? 'partial'
          : 'sufficient_for_stated_scope';

    const summary = buildSummary(supportLevel, {
      methods: methodResults.length,
      selfReports: selfReports.length,
      workFacts: workFacts.length,
      gaps: gaps.length,
    });

    const nextActions: ReportContent['nextActions'] = [];
    if (gaps.length > 0) {
      nextActions.push({
        title: 'Уточнить недостающие сведения в разговоре с сотрудником',
        why: 'По части вопросов решения материалов не предоставлено, и заключение их не заменяет.',
        evidenceIds: gaps[0]?.evidenceIds ?? [],
        owner: 'joint',
      });
    }
    if (contradictions.length > 0) {
      nextActions.push({
        title: 'Обсудить расхождение между вашей оценкой и ответом сотрудника',
        why: 'Расхождение видно в собранных сведениях и само по себе не означает, что кто-то неправ.',
        evidenceIds: contradictions[0]?.evidenceIds ?? [],
        owner: 'manager',
      });
    }
    if (workFacts.length > 0) {
      nextActions.push({
        title: 'Сверить названные рабочие факты с ожиданиями роли',
        why: 'Это относится напрямую к заданному вопросу решения.',
        evidenceIds: [workFacts[0]!.id],
        owner: 'manager',
      });
    }

    const content: ReportContent = {
      schemaVersion: '1.0',
      scenarioCode: input.scenarioCode,
      caseCode: input.caseCode,
      supportLevel,
      summary,
      decisionNotes: [
        'Решение принимает руководитель. Заключение перечисляет собранные сведения и их границы.',
        'Материалы описывают ситуацию на дату прохождения и могут измениться.',
      ],
      findings: findings.slice(0, 30),
      contradictions,
      limitations: [...input.limitations],
      nextActions: nextActions.slice(0, 3),
      reconsiderWhen: [
        'Появятся рабочие примеры по вопросам, где сведений не хватило.',
        'Изменятся обязанности, нагрузка или условия работы.',
      ],
      // Прогноз не выдаётся: проверенной модели для этих целей нет.
      prediction: null,
    };

    return {
      content,
      generationMode: this.generationMode,
      modelVersion: null,
      promptVersion: null,
    };
  }
}

function groupByKind(
  evidence: ReportInput['evidence'],
): Partial<Record<string, ReportInput['evidence'][number][]>> {
  const result: Partial<Record<string, ReportInput['evidence'][number][]>> = {};
  for (const item of evidence) {
    (result[item.kind] ??= []).push(item);
  }
  return result;
}

/** Записи о нехватке сведений формируются из самих свидетельств, а не придумываются. */
function byKind_dataGaps(input: ReportInput): Array<{ statement: string; evidenceIds: string[] }> {
  const gaps: Array<{ statement: string; evidenceIds: string[] }> = [];

  for (const evidence of input.evidence) {
    if (evidence.limitations.some((limit) => limit.includes('не определён'))) {
      gaps.push({
        statement: `По части «${evidence.content}» результат не определён: ответов оказалось недостаточно.`,
        evidenceIds: [evidence.id],
      });
    }
  }

  const hasWorkFacts = input.evidence.some((item) => item.kind === 'work_fact');
  if (!hasWorkFacts) {
    const anchor = input.evidence[0];
    if (anchor) {
      gaps.push({
        statement:
          'Руководитель не указал наблюдаемых рабочих фактов, поэтому заключение опирается только на самоотчёт.',
        evidenceIds: [anchor.id],
      });
    }
  }

  return gaps.slice(0, 6);
}

function findContradictions(
  opinions: ReportInput['evidence'][number][],
  selfReports: ReportInput['evidence'][number][],
): ReportContent['contradictions'] {
  if (opinions.length === 0 || selfReports.length === 0) {
    return [];
  }
  return [
    {
      statement: `${EVIDENCE_KIND_LABELS.manager_opinion} и ${EVIDENCE_KIND_LABELS.self_report.toLowerCase()} описывают ситуацию по-разному. Это повод для разговора, а не признак недостоверности одной из сторон.`,
      evidenceIds: [opinions[0]!.id, selfReports[0]!.id],
    },
  ];
}

function buildSummary(
  supportLevel: ReportContent['supportLevel'],
  counts: { methods: number; selfReports: number; workFacts: number; gaps: number },
): string {
  const parts = [
    `Собрано сведений: результатов методик — ${counts.methods}, ответов сотрудника — ${counts.selfReports}, рабочих фактов от руководителя — ${counts.workFacts}.`,
  ];

  if (supportLevel === 'insufficient') {
    parts.push(
      'Для заявленного вопроса этих сведений недостаточно: заключение перечисляет, чего не хватает.',
    );
  } else if (supportLevel === 'partial') {
    parts.push(
      `Часть сведений отсутствует (${counts.gaps}). Выводы ограничены тем, что фактически предоставлено.`,
    );
  } else {
    parts.push(
      'Сведений достаточно, чтобы описать ситуацию в заявленных границах. Это не оценка человека и не прогноз.',
    );
  }

  return parts.join(' ');
}
