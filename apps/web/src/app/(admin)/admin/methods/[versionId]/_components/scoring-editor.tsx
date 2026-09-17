'use client';

import { Calculator, ListX, Sigma, Trash2 } from 'lucide-react';

import type { DraftScoringConfig, MethodItem } from '@context/contracts';
import { AGGREGATE_OPERATORS, MISSING_POLICIES } from '@context/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, Select, TextArea, TextInput } from '@/components/ui/field';

const OPERATOR_LABELS: Record<string, string> = {
  sum: 'Сумма',
  mean: 'Среднее',
  weighted_sum: 'Взвешенная сумма',
};

const MISSING_LABELS: Record<string, string> = {
  reject: 'Отвергать неполные данные',
  mark_unknown: 'Оставлять значение неопределённым',
  exclude_item: 'Считать по имеющимся ответам',
};

/** Типы вопросов, для которых нужны баллы вариантов. */
const NEEDS_SCORES = new Set(['single_choice', 'multiple_choice', 'situational']);

/**
 * Редактор ключей подсчёта.
 *
 * Операторы выбираются из закрытого списка: произвольная формула или код здесь
 * не задаются. Сложный алгоритм подключается отдельным проверенным scorer’ом
 * разработчиком, а не через эту форму (ТЗ 09.3).
 */
export function ScoringEditor({
  scoring,
  items,
  onChange,
  disabled,
}: {
  scoring: DraftScoringConfig;
  items: readonly MethodItem[];
  onChange: (next: DraftScoringConfig) => void;
  disabled: boolean;
}) {
  const scorableItems = items.filter(
    (item) =>
      item.type === 'likert' ||
      item.type === 'numeric' ||
      item.type === 'single_choice' ||
      item.type === 'multiple_choice' ||
      (item.type === 'situational' && item.response.kind === 'single_choice'),
  );

  const needsScores = items.filter((item) => NEEDS_SCORES.has(item.type));

  function updateScale(index: number, next: DraftScoringConfig['scales'][number]): void {
    const scales = [...scoring.scales];
    scales[index] = next;
    onChange({ ...scoring, scales });
  }

  function addScale(): void {
    const id = `scale_${scoring.scales.length + 1}`;
    onChange({
      ...scoring,
      scales: [
        ...scoring.scales,
        {
          id,
          title: '',
          description: '',
          items: [],
          reverseItems: [],
          aggregate: 'mean',
          expectedRange: { min: 1, max: 5 },
        },
      ],
    });
  }

  function setOptionScore(itemId: string, optionId: string, value: number): void {
    onChange({
      ...scoring,
      optionScores: {
        ...(scoring.optionScores ?? {}),
        [itemId]: { ...(scoring.optionScores?.[itemId] ?? {}), [optionId]: value },
      },
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          icon={<ListX aria-hidden="true" strokeWidth={1.75} />}
          title="Пропуски"
          description="Как считать, если на вопрос шкалы не ответили. Подстановка нуля или среднего недопустима."
        />
        <CardBody>
          <Field label="Политика пропусков">
            {({ inputId }) => (
              <Select
                id={inputId}
                wrapperClassName="max-w-[420px]"
                value={scoring.missingPolicy}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...scoring,
                    missingPolicy: event.target.value as DraftScoringConfig['missingPolicy'],
                  })
                }
              >
                {MISSING_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {MISSING_LABELS[policy]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      {needsScores.length > 0 ? (
        <Card>
          <CardHeader
            icon={<Sigma aria-hidden="true" strokeWidth={1.75} />}
            title="Баллы вариантов"
            description="Видны только администратору: в кабинет руководителя и участнику они не отдаются."
          />
          <CardBody className="flex flex-col gap-4">
            {needsScores.map((item) => {
              const options =
                item.type === 'single_choice' || item.type === 'multiple_choice'
                  ? item.options
                  : item.type === 'situational' && item.response.kind === 'single_choice'
                    ? item.response.options
                    : [];

              if (options.length === 0) {
                return null;
              }

              return (
                <div
                  key={item.id}
                  className="rounded-[var(--radius-control)] bg-[var(--bg-inset)] p-3"
                >
                  <p className="text-sm font-medium">{item.prompt || item.id}</p>
                  <ul className="mt-2 flex list-none flex-col gap-2 p-0">
                    {options.map((option) => (
                      <li key={option.id} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-[220px] flex-1 text-sm">
                          {option.label || option.id}
                        </span>
                        <TextInput
                          type="number"
                          className="max-w-[110px]"
                          aria-label={`Балл варианта «${option.label || option.id}»`}
                          value={scoring.optionScores?.[item.id]?.[option.id] ?? ''}
                          disabled={disabled}
                          onChange={(event) =>
                            setOptionScore(item.id, option.id, Number(event.target.value))
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          icon={<Calculator aria-hidden="true" strokeWidth={1.75} />}
          title={`Шкалы (${scoring.scales.length})`}
          description="Описание шкалы попадает в заключение рядом с числом: оно объясняет, что значение означает и чем не является."
          action={
            disabled ? null : (
              <Button variant="secondary" onClick={addScale}>
                Добавить шкалу
              </Button>
            )
          }
        />
        <CardBody>
          {scoring.scales.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">
              Шкал пока нет. Без хотя бы одной шкалы методику нельзя опубликовать.
            </p>
          ) : (
            <ul className="flex list-none flex-col gap-5 p-0">
              {scoring.scales.map((scale, index) => (
                <li
                  key={scale.id}
                  className="flex flex-col gap-4 rounded-[var(--radius-control)] border border-[var(--border-subtle)] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="text-xs">{scale.id}</code>
                    {disabled ? null : (
                      <Button
                        size="sm"
                        variant="destructive"
                        icon={<Trash2 aria-hidden="true" strokeWidth={1.75} />}
                        onClick={() =>
                          onChange({
                            ...scoring,
                            scales: scoring.scales.filter((_, position) => position !== index),
                          })
                        }
                      >
                        Удалить шкалу
                      </Button>
                    )}
                  </div>

                  <Field label="Название шкалы">
                    {({ inputId }) => (
                      <TextInput
                        id={inputId}
                        value={scale.title}
                        disabled={disabled}
                        onChange={(event) =>
                          updateScale(index, { ...scale, title: event.target.value })
                        }
                      />
                    )}
                  </Field>

                  <Field
                    label="Описание"
                    hint="Что значение означает и чем оно не является. Этот текст увидит руководитель."
                  >
                    {({ inputId, describedBy }) => (
                      <TextArea
                        id={inputId}
                        aria-describedby={describedBy}
                        rows={2}
                        value={scale.description}
                        disabled={disabled}
                        onChange={(event) =>
                          updateScale(index, { ...scale, description: event.target.value })
                        }
                      />
                    )}
                  </Field>

                  <fieldset className="m-0 border-0 p-0">
                    <legend className="mb-2 text-sm font-medium">Вопросы шкалы</legend>
                    {scorableItems.length === 0 ? (
                      <p className="text-sm text-[var(--text-secondary)]">
                        Подходящих вопросов нет: свободный текст в шкалу не входит.
                      </p>
                    ) : (
                      <ul className="flex list-none flex-col gap-1 p-0">
                        {scorableItems.map((item) => {
                          const included = scale.items.includes(item.id);
                          const reversed = scale.reverseItems.includes(item.id);
                          return (
                            <li
                              key={item.id}
                              className="flex flex-wrap items-center justify-between gap-3"
                            >
                              <Checkbox
                                className="flex-1"
                                checked={included}
                                disabled={disabled}
                                label={<span className="truncate">{item.prompt || item.id}</span>}
                                onChange={(checked) =>
                                  updateScale(index, {
                                    ...scale,
                                    items: checked
                                      ? [...scale.items, item.id]
                                      : scale.items.filter((id) => id !== item.id),
                                    reverseItems: checked
                                      ? scale.reverseItems
                                      : scale.reverseItems.filter((id) => id !== item.id),
                                  })
                                }
                              />

                              {included ? (
                                <Checkbox
                                  checked={reversed}
                                  disabled={disabled}
                                  label={<span className="text-xs">обратный</span>}
                                  onChange={(checked) =>
                                    updateScale(index, {
                                      ...scale,
                                      reverseItems: checked
                                        ? [...scale.reverseItems, item.id]
                                        : scale.reverseItems.filter((id) => id !== item.id),
                                    })
                                  }
                                />
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </fieldset>

                  <div className="flex flex-wrap gap-4">
                    <Field label="Оператор">
                      {({ inputId }) => (
                        <Select
                          id={inputId}
                          value={scale.aggregate}
                          disabled={disabled}
                          onChange={(event) =>
                            updateScale(index, {
                              ...scale,
                              aggregate: event.target.value as (typeof AGGREGATE_OPERATORS)[number],
                            })
                          }
                        >
                          {AGGREGATE_OPERATORS.map((operator) => (
                            <option key={operator} value={operator}>
                              {OPERATOR_LABELS[operator]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>

                    <Field label="Минимум диапазона">
                      {({ inputId }) => (
                        <TextInput
                          id={inputId}
                          type="number"
                          className="max-w-[120px]"
                          value={scale.expectedRange.min}
                          disabled={disabled}
                          onChange={(event) =>
                            updateScale(index, {
                              ...scale,
                              expectedRange: {
                                ...scale.expectedRange,
                                min: Number(event.target.value),
                              },
                            })
                          }
                        />
                      )}
                    </Field>

                    <Field label="Максимум диапазона">
                      {({ inputId }) => (
                        <TextInput
                          id={inputId}
                          type="number"
                          className="max-w-[120px]"
                          value={scale.expectedRange.max}
                          disabled={disabled}
                          onChange={(event) =>
                            updateScale(index, {
                              ...scale,
                              expectedRange: {
                                ...scale.expectedRange,
                                max: Number(event.target.value),
                              },
                            })
                          }
                        />
                      )}
                    </Field>
                  </div>

                  {scale.items.length > 0 ? (
                    <Badge tone="neutral">
                      Вопросов в шкале: {scale.items.length}
                      {scale.reverseItems.length > 0
                        ? ` · обратных: ${scale.reverseItems.length}`
                        : ''}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
