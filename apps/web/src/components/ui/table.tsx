'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';

import { Button } from './button';
import { Skeleton } from './states';
import { cx } from './tint';

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  /**
   * Второстепенная колонка. Скрыта до 1536px: до 1280px её показывает
   * мобильная карточка, а на 1280–1535px колонка контента (окно минус
   * sidebar 248px и отступы, ≈966px) слишком узка для 6–7 колонок — правая
   * колонка обрезалась вместе со своим отступом. Данные не пропадают ни на
   * одной ширине: до 1280px — карточка, от 1280px — оставшиеся колонки
   * плюс страница объекта.
   */
  readonly hideOnMobile?: boolean;
  readonly align?: 'left' | 'right';
  /**
   * Запрет переноса: даты и короткие коды иначе рвутся на две строки
   * («16 сентября 2026 г. в» / «15:33») и правый край таблицы становится рваным.
   */
  readonly nowrap?: boolean;
  /** Доп. классы ячейки (например, ширина `w-40`). */
  readonly className?: string;
}

const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [role="checkbox"], [data-row-stop]';

/**
 * Клик по строке открывает объект, если клик пришёл не из вложенного
 * интерактивного элемента (чекбокс, меню, ссылка) и не был выделением текста.
 */
function shouldOpenRow(event: MouseEvent<HTMLElement>): boolean {
  if (event.defaultPrevented || event.button !== 0) {
    return false;
  }
  const target = event.target;
  if (target instanceof Element) {
    const interactive = target.closest(INTERACTIVE_SELECTOR);
    if (interactive && event.currentTarget.contains(interactive)) {
      return false;
    }
  }
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  return !(selection && selection.toString().length > 0);
}

/**
 * Таблица списка.
 *
 * На узких экранах превращается в карточки: горизонтальная прокрутка вместе
 * с вертикальной недопустима для нетабличного содержимого (ТЗ 02.3).
 * Клик по строке открывает объект; меню действий и чекбоксы навигацию не вызывают.
 * Для клавиатуры и диктора точкой входа служит ссылка в первой колонке.
 */
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  caption,
  onRowOpen,
  rowHref,
  emptyState,
  loading = false,
  skeletonRows = 5,
}: {
  rows: readonly T[];
  columns: ReadonlyArray<Column<T>>;
  caption: string;
  onRowOpen?: (row: T) => void;
  rowHref?: (row: T) => string;
  emptyState?: ReactNode;
  /** Показывает строки-скелетоны, пока данных ещё нет. */
  loading?: boolean;
  skeletonRows?: number;
}) {
  const router = useRouter();
  const showSkeleton = loading && rows.length === 0;
  const clickable = Boolean(rowHref || onRowOpen);

  if (!showSkeleton && rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  function openRow(row: T, event: MouseEvent<HTMLElement>): void {
    if (!shouldOpenRow(event)) {
      return;
    }
    if (rowHref) {
      const href = rowHref(row);
      if (event.metaKey || event.ctrlKey) {
        window.open(href, '_blank', 'noopener');
        return;
      }
      router.push(href);
      return;
    }
    onRowOpen?.(row);
  }

  function renderPrimary(row: T, column: Column<T>): ReactNode {
    if (rowHref) {
      return (
        <Link
          href={rowHref(row)}
          className="font-semibold text-[var(--text-primary)] no-underline decoration-[var(--border-strong)] hover:text-[var(--accent)] hover:underline"
        >
          {column.render(row)}
        </Link>
      );
    }
    if (onRowOpen) {
      return (
        <button
          type="button"
          onClick={() => onRowOpen(row)}
          className="text-left font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline"
        >
          {column.render(row)}
        </button>
      );
    }
    return column.render(row);
  }

  const [firstColumn, ...restColumns] = columns;

  return (
    <>
      {/*
        Табличная раскладка от 1280px. На 1024–1279px колонка контента (ширина
        окна минус sidebar 248px и отступы) уже, чем нужно таблице из 6–7
        колонок: колонки обрезались, а полосы прокрутки на macOS не видно.
        Карточки держатся до xl и показывают все колонки целиком.
        От 1280 до 1535px место есть только для обязательных колонок, поэтому
        второстепенные (hideOnMobile) возвращаются с 2xl (1536px).
        Прокрутка остаётся запасным вариантом для очень широких таблиц —
        с тенью-подсказкой у правого края.
      */}
      <div
        className="hidden overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-[var(--shadow-card)] xl:block"
        aria-busy={showSkeleton || undefined}
      >
        <div
          className="overflow-x-auto rounded-[var(--radius-card)] [scrollbar-width:thin]"
          /*
            Подсказка прокрутки: тень у края видна только когда таблица
            действительно шире карточки. Белые полосы прокручиваются вместе с
            содержимым (attachment local) и закрывают тень, когда край достигнут.

            Ширины подобраны так, чтобы приём работал и при маленьком
            переполнении: белая полоса 16px чуть шире тени 12px (при нулевом
            переполнении тень полностью скрыта), но её плотная часть — только
            крайние 40%, поэтому уже при переполнении ~4px тень проступает.
            Прежние 32px против 14px закрывали тень до тех пор, пока таблица
            не выходила за край больше чем на 32px, — то есть ровно в том
            случае, ради которого подсказка и нужна, её не было видно.
          */
          style={{
            backgroundImage: [
              'linear-gradient(to right, var(--bg-surface) 40%, rgba(255,255,255,0))',
              'linear-gradient(to left, var(--bg-surface) 40%, rgba(255,255,255,0))',
              'radial-gradient(farthest-side at 0 50%, rgba(48,55,42,0.18), rgba(48,55,42,0))',
              'radial-gradient(farthest-side at 100% 50%, rgba(48,55,42,0.18), rgba(48,55,42,0))',
            ].join(', '),
            backgroundPosition: 'left center, right center, left center, right center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: '16px 100%, 16px 100%, 12px 100%, 12px 100%',
            backgroundAttachment: 'local, local, scroll, scroll',
          }}
        >
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-[var(--border-hairline)]">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cx(
                      'h-11 whitespace-nowrap px-4 text-[13px] font-semibold text-[var(--text-secondary)] first:pl-6 last:pr-6',
                      column.align === 'right' ? 'text-right' : 'text-left',
                      column.hideOnMobile && 'hidden 2xl:table-cell',
                      column.className,
                    )}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {showSkeleton
                ? Array.from({ length: skeletonRows }, (_, index) => (
                    <tr
                      key={index}
                      className="border-b border-[var(--border-hairline)] last:border-b-0"
                    >
                      {columns.map((column, columnIndex) => (
                        <td
                          key={column.key}
                          className={cx(
                            'h-14 px-4 first:pl-6 last:pr-6',
                            column.hideOnMobile && 'hidden 2xl:table-cell',
                          )}
                        >
                          <Skeleton
                            className={cx(
                              'h-3.5',
                              columnIndex === 0 ? 'w-40' : 'w-24',
                              column.align === 'right' && 'ml-auto',
                            )}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={clickable ? (event) => openRow(row, event) : undefined}
                      className={cx(
                        'border-b border-[var(--border-hairline)] transition-colors duration-[var(--motion-fast)] last:border-b-0 hover:bg-[var(--bg-hover)]',
                        clickable && 'cursor-pointer',
                      )}
                    >
                      {columns.map((column, index) => (
                        <td
                          key={column.key}
                          className={cx(
                            'h-14 px-4 py-3 align-middle first:pl-6 last:pr-6',
                            column.align === 'right' && 'text-right tabular-nums',
                            column.hideOnMobile && 'hidden 2xl:table-cell',
                            column.nowrap && 'whitespace-nowrap',
                            column.className,
                          )}
                        >
                          {index === 0 ? renderPrimary(row, column) : column.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Карточки до 1280px: все колонки, включая второстепенные */}
      <ul
        className="m-0 flex list-none flex-col gap-3 p-0 xl:hidden"
        aria-busy={showSkeleton || undefined}
      >
        {showSkeleton
          ? Array.from({ length: Math.min(skeletonRows, 4) }, (_, index) => (
              <li
                key={index}
                className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]"
              >
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </li>
            ))
          : rows.map((row) => (
              <li
                key={row.id}
                onClick={clickable ? (event) => openRow(row, event) : undefined}
                className={cx(
                  'relative rounded-[var(--radius-panel)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]',
                  clickable && 'cursor-pointer transition-shadow active:shadow-[var(--shadow-xs)]',
                )}
              >
                {firstColumn ? (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-[15px]">
                      <span className="sr-only">{firstColumn.header}: </span>
                      {renderPrimary(row, firstColumn)}
                    </div>
                    {clickable ? (
                      <ChevronRight
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="mt-0.5 size-5 shrink-0 text-[var(--text-tertiary)]"
                      />
                    ) : null}
                  </div>
                ) : null}
                {restColumns.length > 0 ? (
                  <dl className="m-0 mt-3 flex flex-col gap-2 border-t border-[var(--border-hairline)] pt-3">
                    {restColumns.map((column) => (
                      <div
                        key={column.key}
                        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                      >
                        <dt className="text-[13px] text-[var(--text-secondary)]">
                          {column.header}
                        </dt>
                        <dd className="m-0 min-w-0 text-right text-sm">{column.render(row)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
      </ul>
    </>
  );
}

/** Постраничная навигация. Общее количество всегда видно. */
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) {
    return null;
  }

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 py-4"
      aria-label="Постраничная навигация"
    >
      <p className="text-sm tabular-nums text-[var(--text-secondary)]">
        Показано{' '}
        <span className="font-semibold text-[var(--text-primary)]">
          {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)}
        </span>{' '}
        из {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          icon={<ChevronLeft aria-hidden="true" strokeWidth={1.75} />}
          className="h-11 sm:h-9"
        >
          Назад
        </Button>
        {/*
          Счётчик — не ссылка на страницу, поэтому без aria-current: диктор
          объявил бы «текущая страница» для обычного текста. Изменение
          сообщается через aria-live.
        */}
        <p
          className="min-w-14 text-center text-sm tabular-nums text-[var(--text-secondary)]"
          aria-live="polite"
        >
          <span className="sr-only">Страница </span>
          {page}
          <span aria-hidden="true"> / </span>
          <span className="sr-only">из </span>
          {pages}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChange(page + 1)}
          disabled={page >= pages}
          iconRight={<ChevronRight aria-hidden="true" strokeWidth={1.75} />}
          className="h-11 sm:h-9"
        >
          Дальше
        </Button>
      </div>
    </nav>
  );
}
