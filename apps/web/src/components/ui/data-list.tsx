import type { ReactNode } from 'react';

import { formatDateTime } from '@/lib/format';

import { cx } from './tint';

/** Пары «подпись — значение». Пустое значение показывается прочерком. */
export function KeyValueList({
  items,
  columns = 1,
  className,
}: {
  items: ReadonlyArray<{ label: string; value: ReactNode }>;
  columns?: 1 | 2;
  className?: string;
}) {
  return (
    <dl
      className={cx(
        'm-0 grid gap-x-8 gap-y-4',
        columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-[13px] font-medium text-[var(--text-secondary)]">{item.label}</dt>
          <dd className="m-0 min-w-0 break-words text-[15px] text-[var(--text-primary)]">
            {item.value === null || item.value === undefined || item.value === ''
              ? '—'
              : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type TimelineTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const DOT_CLASS: Record<TimelineTone, string> = {
  neutral: 'bg-[var(--border-strong)]',
  accent: 'bg-[var(--accent)]',
  success: 'bg-[var(--success-text)]',
  warning: 'bg-[var(--warning-text)]',
  danger: 'bg-[var(--danger-text)]',
  info: 'bg-[var(--info-text)]',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Хронология событий. `at` — Date или ISO-строка (форматируется) либо готовый текст.
 * Тон точки дублируется текстом заголовка: цвет не единственный носитель смысла.
 */
export function Timeline({
  items,
  className,
}: {
  items: ReadonlyArray<{
    id?: string;
    at: string | Date;
    title: ReactNode;
    description?: ReactNode;
    tone?: TimelineTone;
  }>;
  className?: string;
}) {
  return (
    <ol className={cx('m-0 flex list-none flex-col p-0', className)}>
      {items.map((item, index) => {
        const isDate = item.at instanceof Date || ISO_DATE.test(item.at);
        const dateTime =
          item.at instanceof Date ? item.at.toISOString() : isDate ? item.at : undefined;
        return (
          <li
            key={item.id ?? `${String(item.at)}-${index}`}
            className="relative flex gap-4 pb-5 last:pb-0"
          >
            {index < items.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-[5px] top-4 w-px bg-[var(--border-subtle)]"
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cx(
                'relative mt-1.5 size-[11px] shrink-0 rounded-full ring-4 ring-[var(--bg-surface)]',
                DOT_CLASS[item.tone ?? 'neutral'],
              )}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-semibold leading-snug text-[var(--text-primary)]">
                {item.title}
              </p>
              {item.description ? (
                <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {item.description}
                </div>
              ) : null}
              <time dateTime={dateTime} className="text-xs text-[var(--text-secondary)]">
                {isDate ? formatDateTime(item.at) : String(item.at)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
