'use client';

import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  forwardRef,
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { Spinner } from './button';
import { cx } from './tint';

export interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly children: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode;
}

/**
 * Обёртка поля формы.
 *
 * Ошибка живёт рядом с полем, а не только во всплывающем сообщении: иначе
 * пользователь не понимает, что именно исправлять (ТЗ 02.4).
 */
export function Field({ label, hint, error, required, children }: FieldProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-[var(--text-primary)]">
        {label}
        {required ? (
          <span className="ml-1 text-[var(--danger-text)]" aria-hidden="true">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (обязательное поле)</span> : null}
      </label>

      {hint ? (
        <p id={hintId} className="-mt-0.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {hint}
        </p>
      ) : null}

      {children({ inputId, describedBy })}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-sm text-[var(--danger-text)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Общий вид полей ввода: те же высота, радиус, граница и кольцо фокуса. */
export const CONTROL_CLASS = cx(
  'w-full min-w-0 rounded-[var(--radius-control)] border bg-[var(--bg-surface)] px-3.5 text-[15px] text-[var(--text-primary)]',
  'border-[var(--border-control)] shadow-[var(--shadow-xs)]',
  'transition-[border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--easing)]',
  'hover:border-[var(--border-control-hover)] placeholder:text-[var(--text-tertiary)]',
  /* ring-*, а не shadow-*: кольцо добавляется к тени поля, а не заменяет её. */
  'focus-visible:border-[var(--focus-ring)] focus-visible:ring-4 focus-visible:ring-[var(--focus-halo-color)]',
  'disabled:cursor-not-allowed disabled:bg-[var(--bg-muted)] disabled:text-[var(--text-secondary)] disabled:shadow-none',
  'read-only:bg-[var(--bg-inset)]',
);

export const INVALID_CLASS =
  'border-[var(--danger-text)] hover:border-[var(--danger-text)] focus-visible:border-[var(--danger-text)]';

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; leadingIcon?: ReactNode }
>(function TextInput({ invalid, leadingIcon, className = '', ...rest }, ref) {
  const input = (
    <input
      ref={ref}
      {...rest}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
      className={cx(
        CONTROL_CLASS,
        'h-[var(--control-height)]',
        leadingIcon && 'pl-10',
        invalid && INVALID_CLASS,
        className,
      )}
    />
  );

  if (!leadingIcon) {
    return input;
  }

  return (
    <div className="relative w-full min-w-0">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] [&_svg]:size-[18px]"
      >
        {leadingIcon}
      </span>
      {input}
    </div>
  );
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function TextArea({ invalid, className = '', rows = 4, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      {...rest}
      rows={rows}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
      className={cx(
        CONTROL_CLASS,
        'resize-y py-2.5 leading-relaxed',
        invalid && INVALID_CLASS,
        className,
      )}
    />
  );
});

/**
 * Нативный select с кастомной стрелкой. Нативный — значит доступный
 * на любом устройстве без дополнительной разметки.
 */
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; wrapperClassName?: string }
>(function Select({ invalid, className = '', wrapperClassName, children, ...rest }, ref) {
  return (
    <div className={cx('relative min-w-0', wrapperClassName)}>
      <select
        ref={ref}
        {...rest}
        aria-invalid={invalid || rest['aria-invalid'] || undefined}
        className={cx(
          CONTROL_CLASS,
          'h-[var(--control-height)] cursor-pointer appearance-none bg-none pr-10',
          invalid && INVALID_CLASS,
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        strokeWidth={1.75}
        className="pointer-events-none absolute right-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[var(--text-secondary)]"
      />
    </div>
  );
});

/**
 * Флажок: нативный input (клавиатура и диктор работают как обычно),
 * кастомный вид, зона нажатия не меньше 44px.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
  id,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'checked'> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;

  return (
    <label
      htmlFor={inputId}
      className={cx(
        'group/checkbox flex min-h-11 cursor-pointer items-start gap-3 py-2.5',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <span className="relative mt-0.5 grid size-5 shrink-0 place-items-center">
        <input
          {...rest}
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(event.target.checked)}
          className={cx(
            'peer absolute inset-0 m-0 size-5 cursor-pointer appearance-none rounded-[6px] border-[1.5px] border-[var(--border-strong)] bg-[var(--bg-surface)]',
            'transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--easing)]',
            'group-hover/checkbox:border-[var(--text-secondary)] checked:border-[var(--accent)] checked:bg-[var(--accent)] group-hover/checkbox:checked:border-[var(--accent-hover)] checked:group-hover/checkbox:bg-[var(--accent-hover)]',
            'focus-visible:ring-4 focus-visible:ring-[var(--focus-halo-color)] disabled:cursor-not-allowed',
          )}
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none relative size-3.5 scale-50 text-white opacity-0 transition-[opacity,transform] duration-[var(--motion-fast)] ease-[var(--easing-out)] peer-checked:scale-100 peer-checked:opacity-100"
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-medium leading-snug text-[var(--text-primary)]">
          {label}
        </span>
        {description ? (
          <span
            id={descriptionId}
            className="text-[13px] leading-snug text-[var(--text-secondary)]"
          >
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Поле поиска: иконка, кнопка очистки, Esc очищает значение.
 * Подпись обязательна и читается диктором, визуально скрыта.
 * Задержку запросов (250–350 мс) делает страница.
 */
export function SearchInput({
  value,
  onValueChange,
  label,
  placeholder,
  loading = false,
  id,
  className,
  autoFocus,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  placeholder?: string;
  loading?: boolean;
  id?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    /*
      Ориентир «поиск» получает имя: на странице с несколькими полями поиска
      несколько безымянных ориентиров подряд диктор объявляет одинаково.
    */
    <div className={cx('relative w-full min-w-0', className)} role="search" aria-label={label}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden="true"
        strokeWidth={1.75}
        className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[var(--text-tertiary)]"
      />
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-busy={loading || undefined}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value !== '') {
            event.preventDefault();
            event.stopPropagation();
            onValueChange('');
          }
        }}
        className={cx(
          CONTROL_CLASS,
          'h-[var(--control-height)] pl-10 pr-12 [&::-webkit-search-cancel-button]:appearance-none',
        )}
      />
      {/*
        Цель касания 44px: на телефоне промах по маленькому крестику попадал
        в поле и открывал клавиатуру. Иконка при этом остаётся мелкой.
      */}
      <span className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center">
        {loading ? (
          <span className="grid size-11 place-items-center text-[var(--text-tertiary)]">
            <Spinner size={16} />
            <span className="sr-only">Ищем…</span>
          </span>
        ) : value ? (
          <button
            type="button"
            aria-label="Очистить поиск"
            onClick={() => {
              onValueChange('');
              inputRef.current?.focus();
            }}
            className="grid size-11 place-items-center rounded-[var(--radius-control)] text-[var(--text-tertiary)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
          >
            <X aria-hidden="true" className="size-4" strokeWidth={2} />
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** Счётчик символов для полей с ограничением. */
export function CharacterCount({ value, max }: { value: string; max: number }) {
  const remaining = max - value.length;
  const tight = remaining < max * 0.1;
  return (
    <p
      className={cx(
        'text-xs tabular-nums',
        tight ? 'text-[var(--warning-text)]' : 'text-[var(--text-secondary)]',
      )}
      aria-live="polite"
    >
      {value.length} из {max} символов
    </p>
  );
}
