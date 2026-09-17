'use client';

import { ArrowDown, ArrowUp, ListPlus, Trash2 } from 'lucide-react';
import { useId } from 'react';

import { CONTEXT_FIELD_TYPES, type ContextField, type ContextFieldType } from '@context/contracts';

import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/states';

const TYPE_LABELS: Record<ContextFieldType, string> = {
  text: 'Строка',
  textarea: 'Текст',
  date: 'Дата',
  select: 'Выбор из списка',
  money: 'Сумма',
  number: 'Число',
};

const ROLE_LABELS: Record<ContextField['evidenceRole'], string> = {
  context: 'Параметр решения',
  fact: 'Наблюдаемый рабочий факт',
  opinion: 'Мнение руководителя',
};

const ROLE_HINTS: Record<ContextField['evidenceRole'], string> = {
  context:
    'Условие задачи: вопрос, роль, срок. В заключение как свидетельство не попадает — формулировка вопроса не доказывает ответ.',
  fact: 'Наблюдаемое событие или результат. Попадает в заключение как свидетельство руководителя.',
  opinion: 'Оценка руководителя. Помечается в заключении отдельным типом свидетельства.',
};

const ROLE_BADGE_TONE: Record<ContextField['evidenceRole'], 'success' | 'warning' | 'neutral'> = {
  fact: 'success',
  opinion: 'warning',
  context: 'neutral',
};

/**
 * Редактор схемы контекста решения.
 *
 * Ключ поля — часть содержимого версии: по нему сохранены ответы прошлых
 * назначений, поэтому у опубликованной версии он неизменяем, а здесь
 * переименование ключа означает новое поле (ТЗ M05, 09.4).
 *
 * Поля о здоровье, взглядах и семейных обстоятельствах в схему не добавляются:
 * такие сведения платформа не собирает.
 */
export function ContextSchemaEditor({
  fields,
  onChange,
  disabled,
}: {
  fields: readonly ContextField[];
  onChange: (next: ContextField[]) => void;
  disabled: boolean;
}) {
  const addFieldId = useId();

  function update(index: number, next: ContextField): void {
    const copy = [...fields];
    copy[index] = next;
    onChange(copy);
  }

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= fields.length) {
      return;
    }
    const copy = [...fields];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved!);
    onChange(copy);
  }

  function add(type: ContextFieldType): void {
    onChange([
      ...fields,
      blankField(
        type,
        fields.map((field) => field.key),
      ),
    ]);
  }

  return (
    <Card>
      <CardHeader
        icon={<ListPlus strokeWidth={1.75} />}
        title={`Поля контекста (${fields.length})`}
        description="Руководитель заполняет их до назначения. Роль поля решает, станет ли значение свидетельством в заключении."
        action={
          disabled ? null : (
            <div className="flex items-center gap-2">
              <label htmlFor={addFieldId} className="sr-only">
                Тип нового поля
              </label>
              <Select
                id={addFieldId}
                defaultValue=""
                wrapperClassName="min-w-[200px]"
                onChange={(event) => {
                  if (event.target.value) {
                    add(event.target.value as ContextFieldType);
                    event.target.value = '';
                  }
                }}
              >
                <option value="">Добавить поле…</option>
                {CONTEXT_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </div>
          )
        }
      />
      <CardBody>
        {fields.length === 0 ? (
          <EmptyState
            compact
            icon={<ListPlus strokeWidth={1.75} />}
            title="Полей контекста нет"
            description={
              <>
                Без поля <code>decisionQuestion</code> сценарий не сохранится: заключению будет не к
                чему относиться. Добавьте первое поле через список выше.
              </>
            }
          />
        ) : (
          <ol className="flex list-none flex-col gap-4 p-0">
            {fields.map((field, index) => (
              <li
                key={index}
                className="rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-4 sm:p-5"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-[var(--text-secondary)]">
                      {index + 1}.
                    </span>
                    <code className="rounded-md bg-[var(--bg-muted)] px-1.5 py-0.5 text-xs">
                      {field.key}
                    </code>
                    <Badge tone="neutral">{TYPE_LABELS[field.type]}</Badge>
                    <Badge tone={ROLE_BADGE_TONE[field.evidenceRole]}>
                      {ROLE_LABELS[field.evidenceRole]}
                    </Badge>
                  </div>

                  {disabled ? null : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <IconButton
                        label={`Переместить поле ${field.label || field.key} выше`}
                        icon={<ArrowUp aria-hidden="true" strokeWidth={1.75} />}
                        variant="ghost"
                        size="sm"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                      />
                      <IconButton
                        label={`Переместить поле ${field.label || field.key} ниже`}
                        icon={<ArrowDown aria-hidden="true" strokeWidth={1.75} />}
                        variant="ghost"
                        size="sm"
                        onClick={() => move(index, 1)}
                        disabled={index === fields.length - 1}
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        icon={<Trash2 aria-hidden="true" strokeWidth={1.75} />}
                        aria-label={`Удалить поле ${field.label || field.key}`}
                        onClick={() => onChange(fields.filter((_, at) => at !== index))}
                      >
                        Удалить
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      label="Ключ поля"
                      hint="Латиница, начинается с буквы. По ключу сохранены ответы прошлых назначений."
                    >
                      {({ inputId, describedBy }) => (
                        <TextInput
                          id={inputId}
                          aria-describedby={describedBy}
                          value={field.key}
                          disabled={disabled}
                          maxLength={49}
                          onChange={(event) => update(index, { ...field, key: event.target.value })}
                        />
                      )}
                    </Field>

                    <Field label="Название для руководителя">
                      {({ inputId }) => (
                        <TextInput
                          id={inputId}
                          value={field.label}
                          disabled={disabled}
                          maxLength={200}
                          onChange={(event) =>
                            update(index, { ...field, label: event.target.value })
                          }
                        />
                      )}
                    </Field>
                  </div>

                  <Field label="Подсказка" hint="Объясняет, что именно вводить. Необязательна.">
                    {({ inputId, describedBy }) => (
                      <TextArea
                        id={inputId}
                        aria-describedby={describedBy}
                        rows={2}
                        maxLength={400}
                        value={field.hint ?? ''}
                        disabled={disabled}
                        onChange={(event) =>
                          update(index, {
                            ...field,
                            hint: event.target.value.length > 0 ? event.target.value : undefined,
                          })
                        }
                      />
                    )}
                  </Field>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Тип поля">
                      {({ inputId }) => (
                        <Select
                          id={inputId}
                          value={field.type}
                          disabled={disabled}
                          onChange={(event) =>
                            update(index, {
                              ...field,
                              type: event.target.value as ContextFieldType,
                              options:
                                event.target.value === 'select' ? (field.options ?? []) : undefined,
                            })
                          }
                        >
                          {CONTEXT_FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {TYPE_LABELS[type]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>

                    <Field label="Роль в заключении" hint={ROLE_HINTS[field.evidenceRole]}>
                      {({ inputId, describedBy }) => (
                        <Select
                          id={inputId}
                          aria-describedby={describedBy}
                          value={field.evidenceRole}
                          disabled={disabled}
                          onChange={(event) => {
                            const role = event.target.value as ContextField['evidenceRole'];
                            update(index, {
                              ...field,
                              evidenceRole: role,
                              // Признак мнения хранится отдельно для обратной
                              // совместимости старых схем — держим их согласованными.
                              isOpinion: role === 'opinion',
                            });
                          }}
                        >
                          {(Object.keys(ROLE_LABELS) as Array<ContextField['evidenceRole']>).map(
                            (role) => (
                              <option key={role} value={role}>
                                {ROLE_LABELS[role]}
                              </option>
                            ),
                          )}
                        </Select>
                      )}
                    </Field>
                  </div>

                  <Checkbox
                    checked={field.required}
                    disabled={disabled}
                    onChange={(checked) => update(index, { ...field, required: checked })}
                    label="Обязательное поле"
                  />

                  {field.type === 'select' ? (
                    <Field
                      label="Варианты"
                      hint="Формат «значение = подпись», по одному в строке. Значение сохраняется, подпись видит руководитель."
                    >
                      {({ inputId, describedBy }) => (
                        <TextArea
                          id={inputId}
                          aria-describedby={describedBy}
                          rows={4}
                          disabled={disabled}
                          value={(field.options ?? [])
                            .map((option) => `${option.value} = ${option.label}`)
                            .join('\n')}
                          onChange={(event) =>
                            update(index, {
                              ...field,
                              options: event.target.value
                                .split('\n')
                                .map((line) => {
                                  const [rawValue, ...rest] = line.split('=');
                                  return {
                                    value: (rawValue ?? '').trim(),
                                    label: rest.join('=').trim() || (rawValue ?? '').trim(),
                                  };
                                })
                                .filter((option) => option.value.length > 0),
                            })
                          }
                        />
                      )}
                    </Field>
                  ) : null}

                  {field.type === 'text' || field.type === 'textarea' ? (
                    <div className="flex flex-wrap gap-4">
                      <Field label="Минимум символов">
                        {({ inputId }) => (
                          <TextInput
                            id={inputId}
                            type="number"
                            min={0}
                            className="max-w-[140px]"
                            value={field.minLength ?? ''}
                            disabled={disabled}
                            onChange={(event) =>
                              update(index, {
                                ...field,
                                minLength:
                                  event.target.value === ''
                                    ? undefined
                                    : Number(event.target.value),
                              })
                            }
                          />
                        )}
                      </Field>
                      <Field label="Максимум символов">
                        {({ inputId }) => (
                          <TextInput
                            id={inputId}
                            type="number"
                            min={1}
                            className="max-w-[140px]"
                            value={field.maxLength ?? ''}
                            disabled={disabled}
                            onChange={(event) =>
                              update(index, {
                                ...field,
                                maxLength:
                                  event.target.value === ''
                                    ? undefined
                                    : Number(event.target.value),
                              })
                            }
                          />
                        )}
                      </Field>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

/** Новое поле: ключ не повторяет существующие, чтобы схема осталась валидной. */
function blankField(type: ContextFieldType, taken: readonly string[]): ContextField {
  let index = taken.length + 1;
  let key = `field${index}`;
  while (taken.includes(key)) {
    index += 1;
    key = `field${index}`;
  }

  return {
    key,
    label: '',
    type,
    required: false,
    isOpinion: false,
    evidenceRole: 'context',
    ...(type === 'select' ? { options: [] } : {}),
  };
}
