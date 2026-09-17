import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

import { TINT_CLASS, TINT_SOFT_VAR, cx, type Tint } from './tint';

export type CardTone = 'default' | 'inset' | 'hero';

const CARD_TONE_CLASS: Record<CardTone, string> = {
  default:
    'rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-[var(--shadow-card)]',
  inset: 'rounded-[var(--radius-nested)] bg-[var(--bg-inset)]',
  hero: 'hero-surface rounded-[var(--radius-card)] shadow-[var(--shadow-raised)] sm:rounded-[var(--radius-hero)]',
};

/**
 * Карточка с текстом — непрозрачная поверхность.
 * Стекло и градиенты допустимы только на декоративных и навигационных слоях,
 * чтобы длинный русский текст оставался читаемым (ТЗ 02.1). Исключение — `hero`:
 * одна акцентная карточка на странице с белым текстом на тёмном градиенте.
 */
export function Card({
  children,
  className = '',
  as: Tag = 'section',
  interactive = false,
  tone = 'default',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside' | 'li';
  /** Hover-подъём для карточек, целиком ведущих к действию. */
  interactive?: boolean;
  tone?: CardTone;
} & Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  return (
    <Tag
      {...rest}
      className={cx(
        'min-w-0',
        CARD_TONE_CLASS[tone],
        interactive &&
          'transition-[transform,box-shadow] duration-[var(--motion-medium)] ease-[var(--easing)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)] motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  eyebrow,
  tint = 'accent',
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Иконка lucide-react в тинт-плашке слева от заголовка. */
  icon?: ReactNode;
  eyebrow?: ReactNode;
  tint?: Tint;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-start justify-between gap-x-4 gap-y-3 px-5 pb-1 pt-5 sm:flex-row sm:flex-wrap sm:px-6 sm:pt-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {icon ? (
          <span
            aria-hidden="true"
            className={cx(
              'grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] [&_svg]:size-5',
              TINT_CLASS[tint],
            )}
          >
            {icon}
          </span>
        ) : null}
        <div className={cx('min-w-0', icon && 'pt-0.5')}>
          {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
          <h2 className="text-lg font-semibold leading-snug sm:text-[19px]">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-[var(--text-secondary)]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx('px-5 py-5 sm:px-6', className)}>{children}</div>;
}

export type StatTint = 'none' | Tint;

/**
 * Показатель на обзорной странице.
 *
 * Значение — всегда реальное количество из API. Декоративных KPI и придуманных
 * процентов в интерфейсе нет.
 *
 * Цвет назначается только явно. Прежний вывод оттенка из хеша подписи давал
 * соседним плиткам несвязанные несогласованные цвета и подсказывал семантику,
 * которой нет. С иконкой оттенок идёт в плашку, без иконки — в тонкую верхнюю
 * линию; без `tint` плитка остаётся спокойной и белой.
 */
export function StatCard({
  label,
  value,
  hint,
  href,
  tint,
  icon,
}: {
  label: string;
  value: number;
  hint?: string;
  href?: string;
  /** Оттенок плашки иконки. Без иконки не применяется. */
  tint?: StatTint;
  /** Иконка lucide-react; рисуется в тинт-плашке. */
  icon?: ReactNode;
}) {
  const chipTint: Tint = !tint || tint === 'none' ? 'accent' : tint;
  /* Без иконки оттенок становится тонкой линией сверху: спокойный акцент
     вместо размытого пятна в углу. */
  const rule = !icon && tint && tint !== 'none' ? TINT_SOFT_VAR[tint] : null;

  const content = (
    <>
      {rule ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
          style={{ background: rule }}
        />
      ) : null}
      <span className="relative flex items-start justify-between gap-3">
        {icon ? (
          <span
            aria-hidden="true"
            className={cx(
              'grid size-10 place-items-center rounded-[var(--radius-control)] [&_svg]:size-5',
              TINT_CLASS[chipTint],
            )}
          >
            {icon}
          </span>
        ) : (
          <span className="block text-sm font-medium text-[var(--text-secondary)]">{label}</span>
        )}
        {href ? (
          <ArrowUpRight
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-[18px] shrink-0 text-[var(--text-tertiary)] opacity-0 transition-[opacity,transform] duration-[var(--motion-fast)] group-hover/stat:-translate-y-0.5 group-hover/stat:translate-x-0.5 group-hover/stat:opacity-100 group-focus-visible/stat:opacity-100"
          />
        ) : null}
      </span>
      {icon ? (
        <span className="relative mt-4 block text-sm font-medium text-[var(--text-secondary)]">
          {label}
        </span>
      ) : null}
      <span className="relative mt-2 block text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--text-primary)]">
        {value}
      </span>
      {hint ? (
        <span className="relative mt-2 block text-xs leading-snug text-[var(--text-secondary)]">
          {hint}
        </span>
      ) : null}
    </>
  );

  const base =
    'group/stat relative block min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] no-underline shadow-[var(--shadow-card)]';

  if (href) {
    return (
      <Link
        href={href}
        className={cx(
          base,
          'transition-[transform,box-shadow] duration-[var(--motion-medium)] ease-[var(--easing)] hover:-translate-y-0.5 hover:text-[var(--text-primary)] hover:shadow-[var(--shadow-raised)] motion-reduce:hover:translate-y-0',
        )}
      >
        {content}
      </Link>
    );
  }

  return <div className={base}>{content}</div>;
}
