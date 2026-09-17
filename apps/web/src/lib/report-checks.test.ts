import { describe, expect, it } from 'vitest';
import type { ReportDetail } from '@context/contracts';
import { computeChecks } from './report-checks';

function fixture(): ReportDetail {
  return {
    evidence: [],
    content: {
      schemaVersion: '1.0',
      summary: 'Вероятность 80%',
      decisionNotes: ['Вероятность 90%'],
      findings: [],
      limitations: ['Нет проверенных норм'],
      nextActions: [{ title: 'Обсудить', why: 'Вероятность 70%', evidenceIds: [], owner: 'joint' }],
      reconsiderWhen: [],
      contradictions: [],
    },
  } as unknown as ReportDetail;
}

describe('review checks', () => {
  it('counts consecutive flagged passages and includes decision notes and next actions', () => {
    const report = fixture();
    for (let index = 0; index < 3; index++) {
      const check = computeChecks(report).find((item) => item.id === 'numbers');
      expect(check?.ok).toBe(false);
      expect(check?.detail).toContain(': 3.');
    }
  });
  it('distinguishes a data gap from a claim without sources', () => {
    const report = fixture();
    report.content.findings = [
      {
        id: 'finding_gap',
        statement: 'Сведений недостаточно',
        kind: 'data_gap',
        evidenceIds: [],
        limitations: [],
      },
    ];
    expect(computeChecks(report).find((item) => item.id === 'sources')?.ok).toBe(true);
    report.content.findings[0]!.evidenceIds = ['ev_missing'];
    expect(computeChecks(report).find((item) => item.id === 'sources')?.ok).toBe(false);
  });
});
