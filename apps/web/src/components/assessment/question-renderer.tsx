'use client';

import { useId, useState } from 'react';

import type { AnswerResponse, MethodItem } from '@context/contracts';

import { CharacterCount, TextArea, TextInput } from '@/components/ui/field';
import { cx } from '@/components/ui/tint';

/**
 * Карточка варианта ответа: цель касания не меньше 56px, выбранный вариант
 * отмечен не только цветом — рамкой, подложкой и состоянием самого поля.
 */
function optionClass(selected: boolean): string {
  return cx(
    'flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-nested)] border px-4 py-3 text-[15px] leading-snug',
    'transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--easing)]',
    selected
      ? 'border-[var(--accent)] bg-[var(--accent-soft)] shadow-[var(--shadow-xs)]'
      : 'border-[var(--border-control)] bg-[var(--bg-surface)] hover:border-[var(--border-control-hover)] hover:bg-[var(--bg-hover)]',
  );
}

/**
 * Отрисовка вопроса по его типу.
 *
 * Выбор всегда доступен с клавиатуры: шкала — это группа радиокнопок с
 * подписями, а не только ползунок. Автоперехода при выборе нет — человек сам
 * решает, когда двигаться дальше (ТЗ E05).
 */
export function QuestionRenderer({
  item,
  value,
  onChange,
  onValidityChange,
}: {
  item: MethodItem;
  value: AnswerResponse | undefined;
  onChange: (response: AnswerResponse) => void;
  onValidityChange?: (invalid: boolean) => void;
}) {
  const groupId = useId();

  switch (item.type) {
    case 'likert': {
      const current = value?.type === 'likert' ? value.value : null;
      const scale = Array.from({ length: item.max - item.min + 1 }, (_, i) => item.min + i);
      const labelFor = (point: number): string =>
        item.labels.find((label) => label.value === point)?.label ?? String(point);

      return (
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">{item.prompt}</legend>
          <div className="flex flex-col gap-2">
            {scale.map((point) => (
              <label key={point} className={optionClass(current === point)}>
                <input
                  type="radio"
                  name={groupId}
                  value={point}
                  checked={current === point}
                  onChange={() => onChange({ type: 'likert', value: point })}
                  className="size-5 shrink-0 accent-[var(--accent)]"
                />
                <span>{labelFor(point)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    case 'single_choice': {
      const current = value?.type === 'single_choice' ? value.optionId : null;
      return (
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">{item.prompt}</legend>
          <div className="flex flex-col gap-2">
            {item.options.map((option) => (
              <label key={option.id} className={optionClass(current === option.id)}>
                <input
                  type="radio"
                  name={groupId}
                  value={option.id}
                  checked={current === option.id}
                  onChange={() => onChange({ type: 'single_choice', optionId: option.id })}
                  className="size-5 shrink-0 accent-[var(--accent)]"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    case 'multiple_choice': {
      const current = value?.type === 'multiple_choice' ? value.optionIds : [];
      return (
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">{item.prompt}</legend>
          <p className="mb-2 text-xs text-[var(--text-secondary)]">
            Выберите от {item.minSelected} до {item.maxSelected} вариантов. Выбрано:{' '}
            {current.length}.
            {current.length >= item.maxSelected
              ? ' Чтобы выбрать другой, снимите один из отмеченных.'
              : ''}
          </p>
          <div className="flex flex-col gap-2">
            {item.options.map((option) => {
              const checked = current.includes(option.id);
              return (
                <label
                  key={option.id}
                  className={cx(
                    optionClass(checked),
                    !checked &&
                      current.length >= item.maxSelected &&
                      'opacity-60 cursor-not-allowed',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && current.length >= item.maxSelected}
                    onChange={() =>
                      onChange({
                        type: 'multiple_choice',
                        optionIds: checked
                          ? current.filter((id) => id !== option.id)
                          : [...current, option.id],
                      })
                    }
                    className="size-5 shrink-0 accent-[var(--accent)]"
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      );
    }

    case 'numeric': {
      return (
        <NumericAnswer
          item={item}
          value={value?.type === 'numeric' ? value.value : undefined}
          onChange={onChange}
          onValidityChange={onValidityChange}
        />
      );
    }

    case 'short_text': {
      const current = value?.type === 'short_text' ? value.text : '';
      return (
        <div className="flex flex-col gap-1.5">
          <TextArea
            value={current}
            maxLength={item.maxLength}
            rows={5}
            onChange={(event) => onChange({ type: 'short_text', text: event.target.value })}
            aria-label={item.prompt}
          />
          <CharacterCount value={current} max={item.maxLength} />
        </div>
      );
    }

    case 'situational': {
      if (item.response.kind === 'single_choice') {
        const current = value?.type === 'situational' ? value.optionId : null;
        return (
          <fieldset className="m-0 border-0 p-0">
            <legend className="sr-only">{item.prompt}</legend>
            <div className="flex flex-col gap-2">
              {item.response.options.map((option) => (
                <label key={option.id} className={optionClass(current === option.id)}>
                  <input
                    type="radio"
                    name={groupId}
                    value={option.id}
                    checked={current === option.id}
                    onChange={() => onChange({ type: 'situational', optionId: option.id })}
                    className="size-5 shrink-0 accent-[var(--accent)]"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      }

      const current = value?.type === 'situational' ? (value.text ?? '') : '';
      return (
        <div className="flex flex-col gap-1.5">
          <TextArea
            value={current}
            maxLength={item.response.maxLength}
            rows={5}
            onChange={(event) => onChange({ type: 'situational', text: event.target.value })}
            aria-label={item.prompt}
          />
          <CharacterCount value={current} max={item.response.maxLength} />
        </div>
      );
    }
  }
}

function NumericAnswer({
  item,
  value,
  onChange,
  onValidityChange,
}: {
  item: Extract<MethodItem, { type: 'numeric' }>;
  value: number | undefined;
  onChange: (response: AnswerResponse) => void;
  onValidityChange?: (invalid: boolean) => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const [invalid, setInvalid] = useState(false);
  const hintId = useId();
  return (
    <div className="flex max-w-xs flex-col gap-2">
      <TextInput
        type="number"
        inputMode="decimal"
        min={item.min}
        max={item.max}
        step={item.step}
        value={draft}
        invalid={invalid}
        aria-label={item.prompt}
        aria-describedby={hintId}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const valid =
            text !== '' &&
            event.target.validity.valid &&
            Number.isFinite(event.target.valueAsNumber);
          setInvalid(!valid);
          onValidityChange?.(!valid);
          if (valid) onChange({ type: 'numeric', value: event.target.valueAsNumber });
        }}
      />
      <p
        id={hintId}
        className={cx(
          'text-sm',
          invalid ? 'text-[var(--danger-text)]' : 'text-[var(--text-secondary)]',
        )}
      >
        {invalid ? 'Введите число' : 'Число'} от {item.min} до {item.max}
        {item.unit ? ` ${item.unit}` : ''}. Шаг: {item.step}.
      </p>
    </div>
  );
}
