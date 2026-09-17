import { describe, expect, it } from 'vitest';

import type { MethodItem, ScoringConfig } from './methods';
import {
  hasBlockers,
  nextItemId,
  nextOptionId,
  validateMethodStructure,
} from './method-validation';

function likert(id: string): MethodItem {
  return {
    id,
    type: 'likert',
    prompt: 'Утверждение',
    required: true,
    min: 1,
    max: 5,
    labels: [
      { value: 1, label: 'Нет' },
      { value: 5, label: 'Да' },
    ],
  };
}

function choice(id: string, optionIds: readonly string[]): MethodItem {
  return {
    id,
    type: 'single_choice',
    prompt: 'Вопрос с выбором',
    required: true,
    options: optionIds.map((optionId) => ({ id: optionId, label: optionId })),
  };
}

function scale(items: string[], overrides: Partial<ScoringConfig['scales'][number]> = {}) {
  return {
    id: 'scale_main',
    title: 'Шкала',
    description: 'Описание',
    items,
    reverseItems: [],
    aggregate: 'mean' as const,
    expectedRange: { min: 1, max: 5 },
    ...overrides,
  };
}

describe('Структурная проверка методики', () => {
  it('корректное содержимое не даёт блокировок', () => {
    const items = [likert('item_a'), likert('item_b')];
    const scoring: ScoringConfig = {
      missingPolicy: 'mark_unknown',
      scales: [scale(['item_a', 'item_b'])],
    };

    const issues = validateMethodStructure(items, scoring);
    expect(hasBlockers(issues)).toBe(false);
  });

  it('вопрос без формулировки блокирует сохранение', () => {
    const items = [{ ...likert('item_a'), prompt: '   ' }];
    const issues = validateMethodStructure(items, {
      missingPolicy: 'reject',
      scales: [scale(['item_a'])],
    });
    expect(issues.map((issue) => issue.code)).toContain('empty_prompt');
  });

  it('вариант без текста блокирует сохранение', () => {
    const items = [{ ...choice('item_c', ['opt_1']), options: [{ id: 'opt_1', label: '' }] }];
    const issues = validateMethodStructure(items, {
      missingPolicy: 'reject',
      scales: [scale(['item_c'], { expectedRange: { min: 0, max: 2 } })],
      optionScores: { item_c: { opt_1: 1 } },
    });
    expect(issues.map((issue) => issue.code)).toContain('empty_option_label');
  });

  it('повтор идентификатора вопроса блокирует сохранение', () => {
    const items = [likert('item_a'), likert('item_a')];
    const scoring: ScoringConfig = { missingPolicy: 'reject', scales: [scale(['item_a'])] };

    const issues = validateMethodStructure(items, scoring);
    expect(issues.map((issue) => issue.code)).toContain('duplicate_item_id');
    expect(hasBlockers(issues)).toBe(true);
  });

  it('повтор идентификатора варианта блокирует сохранение', () => {
    const items = [choice('item_c', ['opt_x', 'opt_x'])];
    const scoring: ScoringConfig = {
      missingPolicy: 'reject',
      scales: [scale(['item_c'], { expectedRange: { min: 0, max: 1 } })],
      optionScores: { item_c: { opt_x: 1 } },
    };

    const issues = validateMethodStructure(items, scoring);
    expect(issues.map((issue) => issue.code)).toContain('duplicate_option_id');
  });

  it('ссылка шкалы на несуществующий вопрос блокирует сохранение', () => {
    const issues = validateMethodStructure([likert('item_a')], {
      missingPolicy: 'reject',
      scales: [scale(['item_absent'])],
    });
    expect(issues.map((issue) => issue.code)).toContain('scale_unknown_item');
  });

  it('свободный текст не может входить в шкалу', () => {
    const items: MethodItem[] = [
      { id: 'item_text', type: 'short_text', prompt: 'Опишите', required: false, maxLength: 500 },
    ];
    const issues = validateMethodStructure(items, {
      missingPolicy: 'reject',
      scales: [scale(['item_text'])],
    });
    expect(issues.map((issue) => issue.code)).toContain('scale_not_scorable_item');
  });

  it('вопрос с выбором без баллов вариантов блокирует сохранение', () => {
    const items = [choice('item_c', ['opt_1', 'opt_2'])];
    const issues = validateMethodStructure(items, {
      missingPolicy: 'reject',
      scales: [scale(['item_c'], { expectedRange: { min: 0, max: 2 } })],
    });
    expect(issues.map((issue) => issue.code)).toContain('missing_option_scores');
  });

  it('балл несуществующего варианта блокирует сохранение', () => {
    const items = [choice('item_c', ['opt_1'])];
    const issues = validateMethodStructure(items, {
      missingPolicy: 'reject',
      scales: [scale(['item_c'], { expectedRange: { min: 0, max: 2 } })],
      optionScores: { item_c: { opt_1: 1, opt_ghost: 2 } },
    });
    expect(issues.map((issue) => issue.code)).toContain('unknown_option_score');
  });

  it('обратный вопрос вне шкалы блокирует сохранение', () => {
    const items = [likert('item_a'), likert('item_b')];
    const issues = validateMethodStructure(items, {
      missingPolicy: 'reject',
      scales: [scale(['item_a'], { reverseItems: ['item_b'] })],
    });
    expect(issues.map((issue) => issue.code)).toContain('reverse_item_not_in_scale');
  });

  it('перевёрнутый диапазон блокирует сохранение', () => {
    const issues = validateMethodStructure([likert('item_a')], {
      missingPolicy: 'reject',
      scales: [scale(['item_a'], { expectedRange: { min: 5, max: 1 } })],
    });
    expect(issues.map((issue) => issue.code)).toContain('invalid_range');
  });

  it('вопрос вне шкалы — предупреждение, а не блокировка', () => {
    const items: MethodItem[] = [
      likert('item_a'),
      { id: 'item_text', type: 'short_text', prompt: 'Опишите', required: false, maxLength: 500 },
    ];
    const issues = validateMethodStructure(items, {
      missingPolicy: 'reject',
      scales: [scale(['item_a'])],
    });

    const orphan = issues.find((issue) => issue.code === 'orphan_item');
    expect(orphan?.severity).toBe('warning');
    expect(hasBlockers(issues)).toBe(false);
  });

  it('веса без оператора weighted_sum — предупреждение', () => {
    const issues = validateMethodStructure([likert('item_a')], {
      missingPolicy: 'reject',
      scales: [scale(['item_a'], { weights: { item_a: 2 } })],
    });
    expect(issues.find((issue) => issue.code === 'weight_without_operator')?.severity).toBe(
      'warning',
    );
  });

  it('новые идентификаторы не переиспользуют удалённые', () => {
    // item_q_1 удалён, но следующий идентификатор его не занимает:
    // иначе старый сохранённый ответ сопоставился бы с другим вопросом.
    expect(nextItemId(['item_q_2'])).toBe('item_q_3');
    expect(nextItemId(['item_q_1', 'item_q_2'])).toBe('item_q_3');
    expect(nextOptionId(['opt_q_1_1'], 'item_q_1')).toBe('opt_q_1_2');
  });
});
