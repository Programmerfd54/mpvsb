import { describe, expect, it } from 'vitest';

import {
  hasScenarioBlockers,
  validateScenarioStructure,
  type ScenarioMethodBinding,
} from './scenario-validation';
import type { ContextSchema } from './scenarios';

function field(
  key: string,
  overrides: Partial<ContextSchema['fields'][number]> = {},
): ContextSchema['fields'][number] {
  return {
    key,
    label: `Поле ${key}`,
    type: 'text',
    required: false,
    isOpinion: false,
    evidenceRole: 'context',
    ...overrides,
  };
}

function method(overrides: Partial<ScenarioMethodBinding> = {}): ScenarioMethodBinding {
  return {
    methodId: 'method-1',
    methodVersionId: 'version-1',
    title: 'Методика',
    semanticVersion: '1.0.0',
    status: 'published',
    applicabilityMode: 'demo',
    orderIndex: 0,
    required: true,
    ...overrides,
  };
}

function base(overrides: Partial<Parameters<typeof validateScenarioStructure>[0]> = {}) {
  return validateScenarioStructure({
    contextSchema: {
      fields: [
        field('decisionQuestion', { type: 'textarea', required: true }),
        field('workFacts', { type: 'textarea', evidenceRole: 'fact' }),
      ],
    },
    methods: [method()],
    applicabilityMode: 'demo',
    hasReportingPolicy: true,
    requiredLimitationCount: 2,
    ...overrides,
  });
}

describe('Структурная проверка сценария', () => {
  it('корректная версия не даёт блокировок', () => {
    expect(hasScenarioBlockers(base())).toBe(false);
  });

  it('повтор ключа поля блокирует сохранение', () => {
    const issues = base({
      contextSchema: {
        fields: [
          field('decisionQuestion'),
          field('decisionQuestion'),
          field('workFacts', { evidenceRole: 'fact' }),
        ],
      },
    });
    expect(issues.map((issue) => issue.code)).toContain('duplicate_field_key');
  });

  it('недопустимый ключ поля блокирует сохранение', () => {
    const issues = base({
      contextSchema: {
        fields: [
          field('decisionQuestion'),
          field('Плохой Ключ'),
          field('workFacts', { evidenceRole: 'fact' }),
        ],
      },
    });
    expect(issues.map((issue) => issue.code)).toContain('invalid_field_key');
  });

  it('поле выбора без вариантов блокирует сохранение', () => {
    const issues = base({
      contextSchema: {
        fields: [
          field('decisionQuestion'),
          field('situationType', { type: 'select', options: [] }),
          field('workFacts', { evidenceRole: 'fact' }),
        ],
      },
    });
    expect(issues.map((issue) => issue.code)).toContain('select_without_options');
  });

  it('отсутствие поля вопроса блокирует сохранение', () => {
    const issues = base({
      contextSchema: { fields: [field('workFacts', { evidenceRole: 'fact' })] },
    });
    expect(issues.map((issue) => issue.code)).toContain('no_decision_question');
  });

  it('отсутствие поля рабочих фактов — предупреждение, а не блокировка', () => {
    const issues = base({ contextSchema: { fields: [field('decisionQuestion')] } });
    const warning = issues.find((issue) => issue.code === 'no_fact_field');

    expect(warning?.severity).toBe('warning');
    expect(hasScenarioBlockers(issues)).toBe(false);
  });

  it('две версии одной методики в сценарии недопустимы', () => {
    const issues = base({
      methods: [
        method({ methodVersionId: 'v1', semanticVersion: '1.0.0' }),
        method({ methodVersionId: 'v2', semanticVersion: '1.1.0', orderIndex: 1 }),
      ],
    });
    expect(issues.map((issue) => issue.code)).toContain('duplicate_method');
  });

  it('разные методики допустимы', () => {
    const issues = base({
      methods: [
        method({ methodId: 'method-1', methodVersionId: 'v1' }),
        method({ methodId: 'method-2', methodVersionId: 'v2', orderIndex: 1 }),
      ],
    });
    expect(issues.map((issue) => issue.code)).not.toContain('duplicate_method');
  });

  it('неопубликованная методика блокирует сохранение', () => {
    const issues = base({ methods: [method({ status: 'draft' })] });
    expect(issues.map((issue) => issue.code)).toContain('unpublished_method');
  });

  it('методика уровня ниже сценария блокирует сохранение', () => {
    const issues = base({
      applicabilityMode: 'research',
      methods: [method({ applicabilityMode: 'demo' })],
    });
    expect(issues.map((issue) => issue.code)).toContain('method_mode_below_scenario');
  });

  it('методика уровня выше сценария допустима', () => {
    const issues = base({
      applicabilityMode: 'demo',
      methods: [method({ applicabilityMode: 'validated_use' })],
    });
    expect(issues.map((issue) => issue.code)).not.toContain('method_mode_below_scenario');
  });

  it('сценарий без методик блокируется', () => {
    const issues = base({ methods: [] });
    expect(issues.map((issue) => issue.code)).toContain('no_methods');
  });

  it('отсутствие обязательных методик — предупреждение', () => {
    const issues = base({ methods: [method({ required: false })] });
    expect(issues.find((issue) => issue.code === 'no_required_method')?.severity).toBe('warning');
  });

  it('сценарий без политики заключения блокируется', () => {
    const issues = base({ hasReportingPolicy: false });
    expect(issues.map((issue) => issue.code)).toContain('no_reporting_policy');
  });

  it('политика без обязательных ограничений блокируется', () => {
    const issues = base({ requiredLimitationCount: 0 });
    expect(issues.map((issue) => issue.code)).toContain('policy_without_limitations');
  });
});
