'use client';

import { useRef, useState } from 'react';

import { ArrowDown, ArrowUp, ChevronDown, Copy, Eye, ListChecks, Trash2 } from 'lucide-react';

import type { AnswerResponse, MethodItem, MethodItemType } from '@context/contracts';
import { methodItemSchema, nextItemId, nextOptionId } from '@context/contracts';

import { QuestionRenderer } from '@/components/assessment/question-renderer';
import { Sheet } from '@/components/ui/dialog';
import { cx } from '@/components/ui/tint';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/states';

const TYPE_LABELS: Record<MethodItemType, string> = {
  likert: 'Шкала согласия',
  single_choice: 'Один вариант',
  multiple_choice: 'Несколько вариантов',
  numeric: 'Число',
  short_text: 'Свободный текст',
  situational: 'Ситуация',
};

/**
 * Редактор вопросов.
 *
 * Идентификаторы вопросов и вариантов выдаются один раз и не переиспользуются
 * после удаления: сохранённый ответ должен оставаться сопоставимым именно с тем
 * вопросом, на который отвечали (ТЗ 07.4).
 *
 * Порядок меняется кнопками, а не перетаскиванием: перетаскивание недоступно
 * с клавиатуры.
 */
export function ItemsEditor({
  items,
  onChange,
  disabled,
}: {
  items: readonly MethodItem[];
  onChange: (next: MethodItem[]) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(items[0]?.id ?? null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewAnswer, setPreviewAnswer] = useState<AnswerResponse>();
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const previewItem = items.find((item) => item.id === previewId);
  const previewValid =
    previewItem &&
    methodItemSchema.safeParse(previewItem).success &&
    (previewItem.type !== 'likert' ||
      (previewItem.max >= previewItem.min && previewItem.max - previewItem.min < 100));

  function update(index: number, next: MethodItem): void {
    const copy = [...items];
    copy[index] = next;
    onChange(copy);
  }

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= items.length) {
      return;
    }
    const copy = [...items];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved!);
    onChange(copy);
  }

  function remove(index: number): void {
    onChange(items.filter((_, position) => position !== index));
  }

  function add(type: MethodItemType): void {
    const id = nextItemId(items.map((item) => item.id));
    onChange([...items, blankItem(id, type)]);
    setExpanded(id);
  }

  /**
   * Дублирует вопрос: новый вопрос получает собственный идентификатор и, если
   * есть варианты ответа, собственные идентификаторы вариантов. Баллы
   * вариантов в подсчёте не переносятся — их нужно задать заново на вкладке
   * «Подсчёт», как и для любого нового вопроса.
   */
  function duplicate(index: number): void {
    const source = items[index];
    if (!source) {
      return;
    }
    const id = nextItemId(items.map((item) => item.id));
    const copy = [...items];
    copy.splice(index + 1, 0, withFreshIds(source, id));
    setExpanded(id);
    onChange(copy);
  }

  return (
    <>
      <Card>
        <CardHeader
          icon={<ListChecks aria-hidden="true" strokeWidth={1.75} />}
          title={`Вопросы (${items.length})`}
          description="Откройте вопрос для редактирования. В предпросмотре можно попробовать ответить так, как это сделает участник."
          action={
            disabled ? null : (
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">Тип нового вопроса</span>
                <Select
                  wrapperClassName="w-56"
                  aria-label="Добавить вопрос"
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) {
                      add(event.target.value as MethodItemType);
                      event.target.value = '';
                    }
                  }}
                >
                  <option value="">Добавить вопрос…</option>
                  {(Object.keys(TYPE_LABELS) as MethodItemType[]).map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </label>
            )
          }
        />
        <CardBody>
          {items.length === 0 ? (
            <EmptyState
              compact
              icon={<ListChecks strokeWidth={1.75} />}
              title="Вопросов пока нет"
              description="Добавьте первый — тип можно выбрать в списке выше."
            />
          ) : (
            <ol className="flex list-none flex-col gap-4 p-0">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  className={cx(
                    'overflow-hidden rounded-[var(--radius-nested)] border',
                    expanded === item.id
                      ? 'border-[var(--accent-soft-border)] bg-[var(--bg-surface)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-hover)]',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <button
                      type="button"
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                      aria-expanded={expanded === item.id}
                      aria-controls={`editor-${item.id}`}
                      onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent)]">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">
                          {item.prompt || 'Новый вопрос'}
                        </span>
                        <span className="mt-1 block text-xs text-[var(--text-secondary)]">
                          {TYPE_LABELS[item.type]} ·{' '}
                          {item.required ? 'Обязательный' : 'Необязательный'}
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className={cx(
                          'size-4 shrink-0 transition-transform',
                          expanded === item.id && 'rotate-180',
                        )}
                      />
                    </button>
                    <IconButton
                      label={`Предпросмотр вопроса ${index + 1}`}
                      icon={<Eye aria-hidden="true" />}
                      onClick={(event) => {
                        previewTrigger.current = event.currentTarget;
                        setPreviewAnswer(undefined);
                        setPreviewId(item.id);
                      }}
                    />

                    {disabled ? null : (
                      <div className="flex flex-wrap items-center gap-1">
                        <IconButton
                          label={`Переместить вопрос ${index + 1} выше`}
                          icon={<ArrowUp aria-hidden="true" strokeWidth={1.75} />}
                          size="sm"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                        />
                        <IconButton
                          label={`Переместить вопрос ${index + 1} ниже`}
                          icon={<ArrowDown aria-hidden="true" strokeWidth={1.75} />}
                          size="sm"
                          onClick={() => move(index, 1)}
                          disabled={index === items.length - 1}
                        />
                        <IconButton
                          label={`Дублировать вопрос ${index + 1}`}
                          icon={<Copy aria-hidden="true" strokeWidth={1.75} />}
                          size="sm"
                          onClick={() => duplicate(index)}
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          icon={<Trash2 aria-hidden="true" strokeWidth={1.75} />}
                          onClick={() => remove(index)}
                          aria-label={`Удалить вопрос ${index + 1}`}
                        >
                          Удалить
                        </Button>
                      </div>
                    )}
                  </div>

                  <div
                    id={`editor-${item.id}`}
                    hidden={expanded !== item.id}
                    className="border-t border-[var(--border-subtle)] p-4 sm:p-5"
                  >
                    <div className="flex flex-col gap-4">
                      {item.type === 'situational' ? (
                        <Field label="Описание ситуации">
                          {({ inputId }) => (
                            <TextArea
                              id={inputId}
                              value={item.situation}
                              rows={3}
                              maxLength={2000}
                              disabled={disabled}
                              onChange={(event) =>
                                update(index, { ...item, situation: event.target.value })
                              }
                            />
                          )}
                        </Field>
                      ) : null}

                      <Field label="Формулировка вопроса">
                        {({ inputId }) => (
                          <TextArea
                            id={inputId}
                            value={item.prompt}
                            rows={2}
                            maxLength={1000}
                            disabled={disabled}
                            onChange={(event) =>
                              update(index, { ...item, prompt: event.target.value })
                            }
                          />
                        )}
                      </Field>

                      <Checkbox
                        checked={item.required}
                        disabled={disabled}
                        label="Обязательный вопрос"
                        onChange={(checked) => update(index, { ...item, required: checked })}
                      />

                      <p className="text-xs text-[var(--text-secondary)]">
                        Код вопроса: <code>{item.id}</code>
                      </p>
                      <ItemTypeFields
                        item={item}
                        disabled={disabled}
                        onChange={(next) => update(index, next)}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
      <Sheet
        open={Boolean(previewItem)}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
        title="Глазами участника"
        description="Предпросмотр вопроса. Пробные ответы не сохраняются."
        returnFocusRef={previewTrigger}
      >
        {previewItem && previewValid ? (
          <div className="flex flex-col gap-5">
            <Badge tone="info">Предпросмотр</Badge>
            {previewItem.type === 'situational' ? (
              <p className="rounded-2xl bg-[var(--bg-inset)] p-4 text-sm leading-relaxed">
                {previewItem.situation}
              </p>
            ) : null}
            <h3 className="text-xl font-semibold leading-snug">{previewItem.prompt}</h3>
            {previewItem.hint ? (
              <p className="text-sm text-[var(--text-secondary)]">{previewItem.hint}</p>
            ) : null}
            <QuestionRenderer
              key={previewItem.id}
              item={previewItem}
              value={previewAnswer}
              onChange={setPreviewAnswer}
            />
          </div>
        ) : (
          <EmptyState
            title="Сначала заполните вопрос"
            description="Добавьте формулировку, варианты и корректные границы шкалы — затем можно проверить, как вопрос выглядит для участника."
          />
        )}
      </Sheet>
    </>
  );
}

/** Поля, специфичные для типа вопроса. */
function ItemTypeFields({
  item,
  onChange,
  disabled,
}: {
  item: MethodItem;
  onChange: (next: MethodItem) => void;
  disabled: boolean;
}) {
  if (item.type === 'likert') {
    return (
      <div className="flex flex-wrap gap-4">
        <Field label="Минимум шкалы">
          {({ inputId }) => (
            <TextInput
              id={inputId}
              type="number"
              className="max-w-[120px]"
              value={item.min}
              disabled={disabled}
              onChange={(event) => onChange({ ...item, min: Number(event.target.value) })}
            />
          )}
        </Field>
        <Field label="Максимум шкалы">
          {({ inputId }) => (
            <TextInput
              id={inputId}
              type="number"
              className="max-w-[120px]"
              value={item.max}
              disabled={disabled}
              onChange={(event) => onChange({ ...item, max: Number(event.target.value) })}
            />
          )}
        </Field>
        <div className="w-full flex flex-col gap-3">
          <p className="text-sm font-medium">Подписи значений</p>
          <p className="text-xs text-[var(--text-secondary)]">
            Подпишите крайние значения, чтобы участнику было понятно, что означает шкала.
          </p>
          {item.labels.map((label, position) => (
            <div
              key={position}
              className="grid grid-cols-[56px_minmax(0,1fr)_44px] items-start gap-2 sm:grid-cols-[80px_minmax(0,1fr)_44px]"
            >
              <TextInput
                type="number"
                aria-label={`Значение шкалы ${position + 1}`}
                className="min-w-0"
                disabled={disabled}
                value={label.value}
                onChange={(event) =>
                  onChange({
                    ...item,
                    labels: item.labels.map((row, i) =>
                      i === position ? { ...row, value: Number(event.target.value) } : row,
                    ),
                  })
                }
              />
              <TextInput
                aria-label={`Подпись шкалы ${position + 1}`}
                disabled={disabled}
                value={label.label}
                maxLength={200}
                onChange={(event) =>
                  onChange({
                    ...item,
                    labels: item.labels.map((row, i) =>
                      i === position ? { ...row, label: event.target.value } : row,
                    ),
                  })
                }
              />
              {!disabled ? (
                <IconButton
                  label={`Удалить подпись ${position + 1}`}
                  icon={<Trash2 aria-hidden="true" />}
                  onClick={() =>
                    onChange({ ...item, labels: item.labels.filter((_, i) => i !== position) })
                  }
                />
              ) : null}
            </div>
          ))}
          {!disabled ? (
            <Button
              variant="secondary"
              onClick={() =>
                onChange({ ...item, labels: [...item.labels, { value: item.min, label: '' }] })
              }
            >
              Добавить подпись
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (item.type === 'numeric') {
    return (
      <div className="flex flex-wrap gap-4">
        <Field label="Минимум">
          {({ inputId }) => (
            <TextInput
              id={inputId}
              type="number"
              className="max-w-[120px]"
              value={item.min}
              disabled={disabled}
              onChange={(event) => onChange({ ...item, min: Number(event.target.value) })}
            />
          )}
        </Field>
        <Field label="Максимум">
          {({ inputId }) => (
            <TextInput
              id={inputId}
              type="number"
              className="max-w-[120px]"
              value={item.max}
              disabled={disabled}
              onChange={(event) => onChange({ ...item, max: Number(event.target.value) })}
            />
          )}
        </Field>
      </div>
    );
  }

  if (item.type === 'short_text') {
    return (
      <Field label="Максимальная длина ответа">
        {({ inputId }) => (
          <TextInput
            id={inputId}
            type="number"
            className="max-w-[160px]"
            value={item.maxLength}
            disabled={disabled}
            onChange={(event) => onChange({ ...item, maxLength: Number(event.target.value) })}
          />
        )}
      </Field>
    );
  }

  const options =
    item.type === 'single_choice' || item.type === 'multiple_choice'
      ? item.options
      : item.type === 'situational' && item.response.kind === 'single_choice'
        ? item.response.options
        : null;

  if (!options) {
    return (
      <Field label="Максимальная длина ответа">
        {({ inputId }) => (
          <TextInput
            id={inputId}
            type="number"
            className="max-w-[160px]"
            value={
              item.type === 'situational' && item.response.kind === 'short_text'
                ? item.response.maxLength
                : 1000
            }
            disabled={disabled}
            onChange={(event) => {
              if (item.type === 'situational' && item.response.kind === 'short_text') {
                onChange({
                  ...item,
                  response: { ...item.response, maxLength: Number(event.target.value) },
                });
              }
            }}
          />
        )}
      </Field>
    );
  }

  function setOptions(next: Array<{ id: string; label: string }>): void {
    if (item.type === 'single_choice' || item.type === 'multiple_choice') {
      onChange({ ...item, options: next });
    } else if (item.type === 'situational' && item.response.kind === 'single_choice') {
      onChange({ ...item, response: { ...item.response, options: next } });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {item.type === 'multiple_choice' ? (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Минимум выбранных">
            {({ inputId }) => (
              <TextInput
                id={inputId}
                type="number"
                min={0}
                max={options.length}
                value={item.minSelected}
                disabled={disabled}
                onChange={(event) => onChange({ ...item, minSelected: Number(event.target.value) })}
              />
            )}
          </Field>
          <Field label="Максимум выбранных">
            {({ inputId }) => (
              <TextInput
                id={inputId}
                type="number"
                min={1}
                max={options.length}
                value={item.maxSelected}
                disabled={disabled}
                onChange={(event) => onChange({ ...item, maxSelected: Number(event.target.value) })}
              />
            )}
          </Field>
        </div>
      ) : null}
      <p className="text-sm font-medium">Варианты ответа</p>
      <ul className="flex list-none flex-col gap-2 p-0">
        {options.map((option, position) => (
          <li key={option.id} className="flex flex-wrap items-center gap-2">
            <code className="w-full text-xs text-[var(--text-secondary)]">{option.id}</code>
            <TextInput
              className="min-w-0 flex-1"
              value={option.label}
              disabled={disabled}
              aria-label={`Текст варианта ${position + 1}`}
              onChange={(event) => {
                const next = [...options];
                next[position] = { ...option, label: event.target.value };
                setOptions(next);
              }}
            />
            {disabled ? null : (
              <IconButton
                label={`Удалить вариант ${position + 1}`}
                icon={<Trash2 aria-hidden="true" strokeWidth={1.75} />}
                size="sm"
                onClick={() => setOptions(options.filter((_, index) => index !== position))}
              />
            )}
          </li>
        ))}
      </ul>
      {disabled ? null : (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setOptions([
                ...options,
                {
                  id: nextOptionId(
                    options.map((option) => option.id),
                    item.id,
                  ),
                  label: '',
                },
              ])
            }
          >
            Добавить вариант
          </Button>
        </div>
      )}
    </div>
  );
}

/** Заготовка вопроса выбранного типа. */
function blankItem(id: string, type: MethodItemType): MethodItem {
  const base = { id, prompt: '', required: true } as const;

  switch (type) {
    case 'likert':
      return {
        ...base,
        type: 'likert',
        min: 1,
        max: 5,
        labels: [
          { value: 1, label: 'Совсем не согласен' },
          { value: 5, label: 'Полностью согласен' },
        ],
      };
    case 'single_choice':
      return {
        ...base,
        type: 'single_choice',
        options: [
          { id: nextOptionId([], id), label: '' },
          { id: nextOptionId([nextOptionId([], id)], id), label: '' },
        ],
      };
    case 'multiple_choice':
      return {
        ...base,
        type: 'multiple_choice',
        minSelected: 1,
        maxSelected: 2,
        options: [
          { id: nextOptionId([], id), label: '' },
          { id: nextOptionId([nextOptionId([], id)], id), label: '' },
        ],
      };
    case 'numeric':
      return { ...base, type: 'numeric', min: 0, max: 10, step: 1 };
    case 'short_text':
      return { ...base, type: 'short_text', maxLength: 1000 };
    case 'situational':
      return {
        ...base,
        type: 'situational',
        situation: '',
        response: {
          kind: 'single_choice',
          options: [
            { id: nextOptionId([], id), label: '' },
            { id: nextOptionId([nextOptionId([], id)], id), label: '' },
          ],
        },
      };
  }
}

/**
 * Копия вопроса с новым идентификатором. Варианты (если есть) получают
 * идентификаторы, заново пронумерованные относительно нового вопроса —
 * иначе дубликат сохранял бы код исходного вопроса в своих вариантах.
 */
function withFreshIds(item: MethodItem, id: string): MethodItem {
  const newBase = id.replace(/^item_/, '');
  const renumber = (options: ReadonlyArray<{ id: string; label: string }>) =>
    options.map((option, index) => ({ ...option, id: `opt_${newBase}_${index + 1}` }));

  if (item.type === 'single_choice' || item.type === 'multiple_choice') {
    return { ...item, id, options: renumber(item.options) };
  }
  if (item.type === 'situational' && item.response.kind === 'single_choice') {
    return {
      ...item,
      id,
      response: { ...item.response, options: renumber(item.response.options) },
    };
  }
  return { ...item, id };
}
