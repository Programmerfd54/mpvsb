'use client';

import { FlaskConical, Trash2 } from 'lucide-react';

import type { MethodCheckResult, MethodDraftContent } from '@context/contracts';

import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, TextArea, TextInput } from '@/components/ui/field';
import { Callout, EmptyState } from '@/components/ui/states';

type Fixture = MethodDraftContent['fixtures'][number];

/**
 * Контрольные примеры.
 *
 * Это проверка того, что заявленные ключи дают заявленные значения. Она не
 * подтверждает, что методика что-то измеряет, и не заменяет методическую
 * экспертизу (ТЗ 09.3).
 */
export function FixturesEditor({
  fixtures,
  scaleIds,
  result,
  onChange,
  disabled,
}: {
  fixtures: readonly Fixture[];
  scaleIds: readonly string[];
  result: MethodCheckResult | null;
  onChange: (next: Fixture[]) => void;
  disabled: boolean;
}) {
  function update(index: number, next: Fixture): void {
    const copy = [...fixtures];
    copy[index] = next;
    onChange(copy);
  }

  return (
    <Card>
      <CardHeader
        icon={<FlaskConical aria-hidden="true" strokeWidth={1.75} />}
        title={`Контрольные примеры (${fixtures.length})`}
        description="Синтетические ответы и ожидаемые значения шкал. Без них публикация невозможна."
        action={
          disabled ? null : (
            <Button
              variant="secondary"
              onClick={() =>
                onChange([
                  ...fixtures,
                  {
                    name: `Пример ${fixtures.length + 1}`,
                    answers: {},
                    expected: Object.fromEntries(scaleIds.map((id) => [id, 0])),
                  },
                ])
              }
            >
              Добавить пример
            </Button>
          )
        }
      />
      <CardBody>
        {fixtures.length === 0 ? (
          <EmptyState
            compact
            icon={<FlaskConical strokeWidth={1.75} />}
            title="Примеров пока нет"
            description="Добавьте хотя бы граничные случаи: минимум и максимум каждой шкалы."
          />
        ) : (
          <ul className="flex list-none flex-col gap-4 p-0">
            {fixtures.map((fixture, index) => {
              const outcome = result?.fixtures.find((item) => item.name === fixture.name);

              return (
                <li
                  key={index}
                  className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <TextInput
                      className="max-w-[320px]"
                      value={fixture.name}
                      disabled={disabled}
                      aria-label={`Название примера ${index + 1}`}
                      onChange={(event) => update(index, { ...fixture, name: event.target.value })}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {outcome ? (
                        <Badge tone={outcome.passed ? 'success' : 'danger'}>
                          {outcome.passed ? 'Сошлось' : 'Расхождение'}
                        </Badge>
                      ) : null}
                      {disabled ? null : (
                        <IconButton
                          label={`Удалить пример ${index + 1}`}
                          icon={<Trash2 aria-hidden="true" strokeWidth={1.75} />}
                          size="sm"
                          onClick={() =>
                            onChange(fixtures.filter((_, position) => position !== index))
                          }
                        />
                      )}
                    </div>
                  </div>

                  <Field
                    label="Ответы"
                    hint="JSON вида { «item_a»: { «type»: «likert», «value»: 3 } }."
                  >
                    {({ inputId, describedBy }) => (
                      <TextArea
                        id={inputId}
                        aria-describedby={describedBy}
                        rows={4}
                        className="font-mono text-xs"
                        disabled={disabled}
                        defaultValue={JSON.stringify(fixture.answers, null, 2)}
                        onBlur={(event) => {
                          try {
                            update(index, { ...fixture, answers: JSON.parse(event.target.value) });
                          } catch {
                            // Некорректный JSON не затирает сохранённое значение:
                            // человек увидит прежний текст и исправит его.
                          }
                        }}
                      />
                    )}
                  </Field>

                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Ожидаемые значения шкал</p>
                    <ul className="flex list-none flex-col gap-2 p-0">
                      {scaleIds.map((scaleId) => {
                        const detail = outcome?.details.find((item) => item.scaleId === scaleId);
                        const value = fixture.expected[scaleId];

                        return (
                          <li key={scaleId} className="flex flex-wrap items-center gap-2">
                            <code className="min-w-[200px] text-xs">{scaleId}</code>
                            <TextInput
                              type="number"
                              className="max-w-[120px]"
                              aria-label={`Ожидаемое значение шкалы ${scaleId}`}
                              value={value ?? ''}
                              disabled={disabled}
                              onChange={(event) =>
                                update(index, {
                                  ...fixture,
                                  expected: {
                                    ...fixture.expected,
                                    [scaleId]:
                                      event.target.value === '' ? null : Number(event.target.value),
                                  },
                                })
                              }
                            />
                            {disabled ? null : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  update(index, {
                                    ...fixture,
                                    expected: { ...fixture.expected, [scaleId]: null },
                                  })
                                }
                              >
                                Не определено
                              </Button>
                            )}
                            {detail && !detail.matches ? (
                              <span className="text-xs text-[var(--danger-text)]">
                                получено {String(detail.actual)}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {outcome?.error ? (
                    <Callout tone="danger" role="alert">
                      {outcome.error}
                    </Callout>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
