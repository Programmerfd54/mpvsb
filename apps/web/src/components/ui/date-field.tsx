'use client';

import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { formatDate } from '@/lib/format';

import { IconButton } from './button';
import { CONTROL_CLASS, INVALID_CLASS } from './field';
import { cx } from './tint';

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) || toIsoDate(date) !== value ? null : date;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Сетка недели с понедельника: 0 = понедельник ... 6 = воскресенье. */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** 6 недель по 7 дней — с хвостами соседних месяцев, как в референсах 01/02/03. */
function buildMonthGrid(monthStart: Date): Date[] {
  const leading = mondayIndex(monthStart);
  const gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - leading);
  return Array.from(
    { length: 42 },
    (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i),
  );
}

export interface DateFieldProps {
  readonly id?: string;
  /** Значение как ISO-дата (гггг-мм-дд) или пустая строка. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly min?: string;
  readonly max?: string;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly ['aria-describedby']?: string;
  readonly ['aria-label']?: string;
}

/**
 * Своя выпадающая дата вместо нативного `<input type="date">`.
 *
 * Нативный контрол выглядит и вводится по-разному в каждом браузере и ОС,
 * не читается по-русски без ручного форматирования и не попадает в
 * визуальный язык остального интерфейса (ТЗ 02.4, Select/Combobox).
 */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  invalid,
  disabled,
  placeholder = 'Выберите дату',
  ...rest
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const selected = useMemo(() => (value ? parseIsoDate(value) : null), [value]);
  const minDate = useMemo(() => (min ? parseIsoDate(min) : null), [min]);
  const maxDate = useMemo(() => (max ? parseIsoDate(max) : null), [max]);
  const today = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected ?? today));
  const [focusedDay, setFocusedDay] = useState(() => selected ?? today);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());

  function clamp(day: Date): Date {
    if (minDate && day < minDate) return minDate;
    if (maxDate && day > maxDate) return maxDate;
    return day;
  }

  function showMonth(delta: number): void {
    const next = clamp(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1));
    setViewMonth(startOfMonth(next));
    setFocusedDay(next);
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    dayRefs.current.get(toIsoDate(focusedDay))?.focus({ preventScroll: true });
  }, [focusedDay, viewMonth, open]);

  const days = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  function isDisabled(day: Date): boolean {
    return Boolean((minDate && day < minDate) || (maxDate && day > maxDate));
  }

  function commit(day: Date): void {
    if (isDisabled(day)) {
      return;
    }
    onChange(toIsoDate(day));
    setOpen(false);
  }

  function moveFocus(days_: number): void {
    setFocusedDay((prev) => {
      const next = clamp(new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + days_));
      if (
        next.getMonth() !== viewMonth.getMonth() ||
        next.getFullYear() !== viewMonth.getFullYear()
      ) {
        setViewMonth(startOfMonth(next));
      }
      return next;
    });
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (disabled) {
          return;
        }
        if (next) {
          const base = clamp(selected ?? today);
          setViewMonth(startOfMonth(base));
          setFocusedDay(base);
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={rest['aria-describedby']}
          aria-label={rest['aria-label']}
          className={cx(
            CONTROL_CLASS,
            'h-[var(--control-height)] flex cursor-pointer items-center justify-between gap-2 text-left',
            invalid && INVALID_CLASS,
          )}
        >
          <span className={cx('truncate', !selected && 'text-[var(--text-tertiary)]')}>
            {selected ? formatDate(selected) : placeholder}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[var(--text-secondary)]">
            <CalendarIcon aria-hidden="true" strokeWidth={1.75} className="size-[18px]" />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-labelledby={headingId}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            dayRefs.current.get(toIsoDate(focusedDay))?.focus({ preventScroll: true });
          }}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          sticky="always"
          className="ui-popover z-50 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto w-[332px] max-w-[calc(100vw-24px)] rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-overlay)] outline-none"
        >
          <div className="mb-2 flex items-center justify-between">
            <IconButton
              label="Предыдущий месяц"
              size="sm"
              variant="ghost"
              icon={<ChevronLeft aria-hidden="true" strokeWidth={1.75} />}
              disabled={Boolean(minDate && startOfMonth(minDate) >= viewMonth)}
              onClick={() => showMonth(-1)}
            />
            <p
              id={headingId}
              className="text-sm font-semibold capitalize text-[var(--text-primary)]"
              aria-live="polite"
            >
              {MONTH_YEAR_FORMAT.format(viewMonth)}
            </p>
            <IconButton
              label="Следующий месяц"
              size="sm"
              variant="ghost"
              icon={<ChevronRight aria-hidden="true" strokeWidth={1.75} />}
              disabled={Boolean(maxDate && startOfMonth(maxDate) <= viewMonth)}
              onClick={() => showMonth(1)}
            />
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center text-xs font-medium text-[var(--text-secondary)]">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="py-1">
                {label}
              </span>
            ))}
          </div>

          <div role="group" aria-labelledby={headingId} className="grid grid-cols-7">
            {days.map((day) => {
              const iso = toIsoDate(day);
              const outside = day.getMonth() !== viewMonth.getMonth();
              const disabledDay = isDisabled(day);
              const isSelected = selected ? isSameDay(day, selected) : false;
              const isToday = isSameDay(day, today);
              const isFocusable = isSameDay(day, focusedDay);

              return (
                <button
                  key={iso}
                  ref={(node) => {
                    if (node) {
                      dayRefs.current.set(iso, node);
                    } else {
                      dayRefs.current.delete(iso);
                    }
                  }}
                  type="button"
                  aria-label={formatDate(day)}
                  tabIndex={isFocusable ? 0 : -1}
                  disabled={disabledDay}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={isSelected}
                  onClick={() => commit(day)}
                  onKeyDown={(event) => {
                    const keyMoves: Record<string, number> = {
                      ArrowRight: 1,
                      ArrowLeft: -1,
                      ArrowDown: 7,
                      ArrowUp: -7,
                    };
                    if (event.key in keyMoves) {
                      event.preventDefault();
                      moveFocus(keyMoves[event.key]);
                    } else if (event.key === 'Home' || event.key === 'End') {
                      event.preventDefault();
                      moveFocus((event.key === 'Home' ? 0 : 6) - mondayIndex(day));
                    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
                      event.preventDefault();
                      showMonth(event.key === 'PageUp' ? -1 : 1);
                    } else if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      commit(day);
                    }
                  }}
                  className={cx(
                    'flex h-11 items-center justify-center rounded-[10px] text-sm tabular-nums transition-colors duration-[var(--motion-fast)]',
                    'focus-visible:ring-2 focus-visible:ring-[var(--focus-halo-color)]',
                    outside && 'text-[var(--text-tertiary)]',
                    !outside &&
                      !isSelected &&
                      'text-[var(--text-primary)] hover:bg-[var(--bg-muted)]',
                    isSelected && 'bg-[var(--accent)] font-semibold text-[var(--text-on-accent)]',
                    isToday && !isSelected && 'ring-1 ring-inset ring-[var(--accent)]',
                    disabledDay && 'pointer-events-none opacity-35',
                  )}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
            <button
              type="button"
              disabled={isDisabled(today)}
              onClick={() => commit(today)}
              className="min-h-11 px-2 text-sm font-medium text-[var(--accent)] hover:underline disabled:opacity-40"
            >
              Сегодня
            </button>
            {selected ? (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="min-h-11 px-2 text-sm text-[var(--text-secondary)] hover:underline"
              >
                Очистить
              </button>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
