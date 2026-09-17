import { answerResponseSchema, methodItemSchema, scoringConfigSchema } from '@context/contracts';
import type { AnswerResponse, MethodItem, ScoringConfig } from '@context/contracts';
import { SYNTHETIC_METHODS } from '@context/testing';
import { describe, expect, it } from 'vitest';

import { scoreAttempt, SCORER_VERSION } from './engine';
import { ScoringConfigError, ScoringInputError } from './errors';
import { contentHash } from './hash';

function toAnswerMap(raw: Readonly<Record<string, unknown>>): Map<string, AnswerResponse> {
  return new Map(
    Object.entries(raw).map(([itemId, value]) => [itemId, answerResponseSchema.parse(value)]),
  );
}

describe('Контрольные примеры синтетических методик', () => {
  for (const method of SYNTHETIC_METHODS) {
    describe(method.code, () => {
      it('содержимое соответствует схеме вопросов и подсчёта', () => {
        for (const item of method.items) {
          expect(() => methodItemSchema.parse(item)).not.toThrow();
        }
        expect(() => scoringConfigSchema.parse(method.scoring)).not.toThrow();
      });

      it('все вопросы шкал существуют в версии методики', () => {
        const ids = new Set(method.items.map((item) => item.id));
        for (const scale of method.scoring.scales) {
          for (const itemId of scale.items) {
            expect(ids.has(itemId), `${scale.id} ссылается на ${itemId}`).toBe(true);
          }
          for (const itemId of scale.reverseItems) {
            expect(scale.items.includes(itemId), `${itemId} обратный, но не входит в шкалу`).toBe(
              true,
            );
          }
        }
      });

      for (const fixture of method.fixtures) {
        it(`контрольный пример: ${fixture.name}`, () => {
          const result = scoreAttempt(method.items, method.scoring, toAnswerMap(fixture.answers));

          for (const [scaleId, expected] of Object.entries(fixture.expected)) {
            const scale = result.scales.find((item) => item.scaleId === scaleId);
            expect(scale, `шкала ${scaleId} отсутствует в результате`).toBeDefined();
            expect(scale!.value, `шкала ${scaleId}`).toBe(expected);
          }
        });
      }
    });
  }
});

const items: MethodItem[] = [
  {
    id: 'item_a',
    type: 'likert',
    prompt: 'Прямой вопрос',
    required: true,
    min: 1,
    max: 5,
    labels: [
      { value: 1, label: 'Нет' },
      { value: 5, label: 'Да' },
    ],
  },
  {
    id: 'item_b',
    type: 'likert',
    prompt: 'Обратный вопрос',
    required: true,
    min: 1,
    max: 5,
    labels: [
      { value: 1, label: 'Нет' },
      { value: 5, label: 'Да' },
    ],
  },
];

const config: ScoringConfig = {
  missingPolicy: 'mark_unknown',
  scales: [
    {
      id: 'scale_demo',
      title: 'Демонстрационная шкала',
      description: 'Проверка правил подсчёта.',
      items: ['item_a', 'item_b'],
      reverseItems: ['item_b'],
      aggregate: 'mean',
      expectedRange: { min: 1, max: 5 },
    },
  ],
};

describe('Правила подсчёта', () => {
  it('обратный вопрос пересчитывается как min + max - ответ', () => {
    const result = scoreAttempt(
      items,
      config,
      toAnswerMap({
        item_a: { type: 'likert', value: 4 },
        item_b: { type: 'likert', value: 2 },
      }),
    );
    // item_b: 1 + 5 - 2 = 4; среднее (4 + 4) / 2 = 4
    expect(result.scales[0]!.value).toBe(4);
  });

  it('пропуск при mark_unknown оставляет значение неопределённым, а не нулём', () => {
    const result = scoreAttempt(
      items,
      config,
      toAnswerMap({ item_a: { type: 'likert', value: 3 } }),
    );
    expect(result.scales[0]!.value).toBeNull();
    expect(result.scales[0]!.value).not.toBe(0);
    expect(result.missing).toEqual([{ itemId: 'item_b', reason: 'no_answer' }]);
  });

  it('политика reject не допускает подсчёт по неполным данным', () => {
    expect(() =>
      scoreAttempt(
        items,
        { ...config, missingPolicy: 'reject' },
        toAnswerMap({ item_a: { type: 'likert', value: 3 } }),
      ),
    ).toThrow(ScoringInputError);
  });

  it('exclude_item считает по имеющимся ответам и сообщает их число', () => {
    const result = scoreAttempt(
      items,
      { ...config, missingPolicy: 'exclude_item' },
      toAnswerMap({ item_a: { type: 'likert', value: 3 } }),
    );
    expect(result.scales[0]!.value).toBe(3);
    expect(result.scales[0]!.itemsUsed).toBe(1);
    expect(result.scales[0]!.itemsExpected).toBe(2);
  });

  it('значение вне объявленной шкалы отвергается', () => {
    expect(() =>
      scoreAttempt(
        items,
        config,
        toAnswerMap({
          item_a: { type: 'likert', value: 9 },
          item_b: { type: 'likert', value: 2 },
        }),
      ),
    ).toThrow(ScoringInputError);
  });

  it('вариант из другой версии методики отвергается', () => {
    const method = SYNTHETIC_METHODS[0]!;
    expect(() =>
      scoreAttempt(
        method.items,
        method.scoring,
        toAnswerMap({ item_wc_7: { type: 'single_choice', optionId: 'opt_wc7_unknown' } }),
      ),
    ).toThrow(ScoringInputError);
  });

  it('вопрос свободного текста не может входить в шкалу', () => {
    const method = SYNTHETIC_METHODS[0]!;
    const broken: ScoringConfig = {
      ...method.scoring,
      scales: [
        {
          id: 'scale_broken',
          title: 'Ошибочная шкала',
          description: 'Ссылается на свободный текст.',
          items: ['item_wc_8'],
          reverseItems: [],
          aggregate: 'sum',
          expectedRange: { min: 0, max: 1 },
        },
      ],
    };
    expect(() =>
      scoreAttempt(
        method.items,
        broken,
        toAnswerMap({ item_wc_8: { type: 'short_text', text: 'Синтетический ответ' } }),
      ),
    ).toThrow(ScoringConfigError);
  });

  it('ссылка на несуществующий вопрос — ошибка конфигурации', () => {
    const broken: ScoringConfig = {
      ...config,
      scales: [{ ...config.scales[0]!, items: ['item_absent'], reverseItems: [] }],
    };
    expect(() => scoreAttempt(items, broken, new Map())).toThrow(ScoringConfigError);
  });

  it('одинаковый вход даёт одинаковый результат и одинаковый хэш', () => {
    const answers = {
      item_a: { type: 'likert' as const, value: 4 },
      item_b: { type: 'likert' as const, value: 2 },
    };
    const first = scoreAttempt(items, config, toAnswerMap(answers));
    const second = scoreAttempt(items, config, toAnswerMap(answers));

    expect(first).toEqual(second);
    expect(contentHash(first)).toBe(contentHash(second));
  });

  it('хэш не зависит от порядка ключей в исходных данных', () => {
    expect(contentHash({ a: 1, b: { c: 2, d: 3 } })).toBe(contentHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('результат помечен версией алгоритма', () => {
    const result = scoreAttempt(
      items,
      config,
      toAnswerMap({
        item_a: { type: 'likert', value: 3 },
        item_b: { type: 'likert', value: 3 },
      }),
    );
    expect(result.scorerVersion).toBe(SCORER_VERSION);
  });
});
