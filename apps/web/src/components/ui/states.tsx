'use client';

import {
  CircleAlert,
  CircleCheck,
  FlaskConical,
  Inbox,
  Info,
  Lock,
  RotateCw,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './button';
import { TINT_CLASS, cx, type Tint } from './tint';

/** Заготовка загрузки: повторяет форму будущего блока, а не крутится в пустоте. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx('skeleton rounded-[var(--radius-control)]', className)} />
  );
}

export function LoadingBlock({ label = 'Загружаем данные' }: { label?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-2.5 pb-2">
        <Skeleton className="h-8 w-56 max-w-[70%] rounded-[10px]" />
        <Skeleton className="h-4 w-80 max-w-[85%]" />
      </div>
      <SkeletonCard lines={3} />
      <SkeletonCard lines={2} />
    </div>
  );
}

function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        'flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)] sm:p-6',
        className,
      )}
    >
      <Skeleton className="h-5 w-40 max-w-[60%]" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cx('h-3.5', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export type PageSkeletonVariant = 'dashboard' | 'list' | 'detail' | 'form';

/** Скелетон страницы в форме будущего содержимого. */
export function PageSkeleton({
  variant = 'list',
  label = 'Загружаем страницу',
}: {
  variant?: PageSkeletonVariant;
  label?: string;
}) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">{label}</span>

      <div aria-hidden="true" className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2.5">
          {variant === 'detail' ? <Skeleton className="h-3.5 w-36" /> : null}
          <Skeleton className="h-8 w-64 max-w-[70vw] rounded-[10px]" />
          <Skeleton className="h-4 w-96 max-w-[80vw]" />
        </div>
        {variant !== 'form' ? (
          <Skeleton className="h-11 w-44 rounded-[var(--radius-control)]" />
        ) : null}
      </div>

      {variant === 'dashboard' ? (
        <>
          <div aria-hidden="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)]"
              >
                <Skeleton className="size-10" />
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-8 w-14" />
              </div>
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <SkeletonCard lines={4} />
            <SkeletonCard lines={3} />
          </div>
        </>
      ) : null}

      {variant === 'list' ? (
        <div
          aria-hidden="true"
          className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-[var(--shadow-card)]"
        >
          <div className="flex gap-6 border-b border-[var(--border-hairline)] px-5 py-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="hidden h-3.5 w-20 md:block" />
          </div>
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="flex items-center gap-6 border-b border-[var(--border-hairline)] px-5 py-4 last:border-b-0"
            >
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-48 max-w-[40%]" />
              <Skeleton className="hidden h-4 w-40 md:block" />
              <Skeleton className="ml-auto h-6 w-24 rounded-full" />
            </div>
          ))}
        </div>
      ) : null}

      {variant === 'detail' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            <SkeletonCard lines={5} />
            <SkeletonCard lines={3} />
          </div>
          <SkeletonCard lines={4} />
        </div>
      ) : null}

      {variant === 'form' ? (
        <div
          aria-hidden="true"
          className="flex max-w-3xl flex-col gap-5 rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)] sm:p-6"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className={cx('w-full', index === 2 ? 'h-24' : 'h-11')} />
            </div>
          ))}
          <Skeleton className="h-11 w-40" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Пустое состояние: короткая причина и следующий шаг.
 * Без мотивационных текстов — они не помогают решить задачу.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
  tint = 'accent',
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Иконка lucide-react; по умолчанию — «входящие». */
  icon?: ReactNode;
  /** Компактный вид внутри карточки: без собственной рамки. */
  compact?: boolean;
  tint?: Tint;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-3 text-center',
        compact
          ? 'px-4 py-8'
          : 'rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-6 py-12 shadow-[var(--shadow-card)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'grid place-items-center rounded-full',
          compact ? 'mb-1 size-11 [&_svg]:size-5' : 'mb-2 size-14 [&_svg]:size-6',
          TINT_CLASS[tint],
        )}
      >
        {icon ?? <Inbox strokeWidth={1.75} />}
      </span>
      <h3 className={cx('font-semibold', compact ? 'text-[15px]' : 'text-lg')}>{title}</h3>
      {description ? (
        <p className="max-w-[46ch] text-sm leading-relaxed text-[var(--text-secondary)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}

/**
 * Ошибка: понятная причина, способ восстановления и идентификатор запроса
 * для поддержки. Секретов и технических подробностей здесь нет.
 */
export function ErrorState({
  title,
  description,
  requestId,
  action,
  onRetry,
  icon,
  tint = 'danger',
}: {
  title: string;
  description?: string;
  requestId?: string;
  action?: ReactNode;
  /** Показывает кнопку «Повторить». */
  onRetry?: () => void;
  icon?: ReactNode;
  tint?: Tint;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)] sm:flex-row sm:items-start sm:p-6"
    >
      <span
        aria-hidden="true"
        className={cx(
          'grid size-11 shrink-0 place-items-center rounded-full [&_svg]:size-5',
          TINT_CLASS[tint],
        )}
      >
        {icon ?? <CircleAlert strokeWidth={1.75} />}
      </span>
      <div className="flex min-w-0 flex-col items-start gap-2">
        <h3 className="text-base font-semibold sm:pt-2.5">{title}</h3>
        {description ? (
          <p className="max-w-prose text-sm leading-relaxed text-[var(--text-secondary)]">
            {description}
          </p>
        ) : null}
        {onRetry || action ? (
          <div className="mt-2 flex flex-wrap gap-3">
            {onRetry ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<RotateCw aria-hidden="true" />}
                onClick={onRetry}
              >
                Повторить
              </Button>
            ) : null}
            {action}
          </div>
        ) : null}
        {requestId ? (
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Идентификатор запроса для поддержки:{' '}
            <code className="rounded-md bg-[var(--bg-muted)] px-1.5 py-0.5">{requestId}</code>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Сообщение о запрете доступа. Не раскрывает, существует ли объект. */
export function ForbiddenState({ description }: { description?: string }) {
  return (
    <ErrorState
      title="Недостаточно прав"
      icon={<Lock strokeWidth={1.75} />}
      tint="warning"
      description={
        description ??
        'Этот раздел доступен по отдельному разрешению. Обратитесь к владельцу организации.'
      }
    />
  );
}

export type CalloutTone = 'info' | 'warning' | 'success' | 'danger' | 'neutral' | 'demo';

const CALLOUT: Record<CalloutTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: {
    box: 'bg-[var(--info-soft)] border-[rgba(42,85,116,0.16)]',
    icon: 'text-[var(--info-text)]',
    Icon: Info,
  },
  warning: {
    box: 'bg-[var(--warning-soft)] border-[rgba(128,80,19,0.18)]',
    icon: 'text-[var(--warning-text)]',
    Icon: TriangleAlert,
  },
  success: {
    box: 'bg-[var(--success-soft)] border-[rgba(40,90,54,0.16)]',
    icon: 'text-[var(--success-text)]',
    Icon: CircleCheck,
  },
  danger: {
    box: 'bg-[var(--danger-soft)] border-[rgba(165,46,50,0.18)]',
    icon: 'text-[var(--danger-text)]',
    Icon: CircleAlert,
  },
  neutral: {
    box: 'bg-[var(--bg-inset)] border-[var(--border-hairline)]',
    icon: 'text-[var(--text-secondary)]',
    Icon: Info,
  },
  demo: {
    box: 'bg-[var(--lavender-soft)] border-[rgba(91,67,148,0.16)]',
    icon: 'text-[var(--lavender-ink)]',
    Icon: FlaskConical,
  },
};

/**
 * Единый вид баннеров и предупреждений. Текст на тинте — основного цвета,
 * иконка — парного ink-цвета: смысл передаётся заголовком и иконкой, не цветом.
 * Роль (`role="alert"`/`status`) задаёт страница, если сообщение появляется динамически.
 */
export function Callout({
  tone = 'info',
  title,
  children,
  icon,
  action,
  className,
  role,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: 'alert' | 'status' | 'note';
}) {
  const config = CALLOUT[tone];
  const Icon = config.Icon;

  return (
    <div
      role={role}
      className={cx(
        'flex flex-col gap-3 rounded-[var(--radius-nested)] border px-4 py-3.5 text-[var(--text-primary)] sm:flex-row sm:items-start sm:px-5 sm:py-4',
        config.box,
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden="true" className={cx('mt-px shrink-0 [&_svg]:size-5', config.icon)}>
          {icon ?? <Icon strokeWidth={1.75} />}
        </span>
        <div className="min-w-0 flex-1 text-sm leading-relaxed">
          {title ? <p className="font-semibold">{title}</p> : null}
          {children ? (
            <div className={cx(title ? 'mt-1' : '', 'text-[var(--text-primary)] [&_ul]:mt-1')}>
              {children}
            </div>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2 pl-8 sm:pl-0">{action}</div> : null}
    </div>
  );
}
