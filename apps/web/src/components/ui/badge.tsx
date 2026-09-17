import type { ReactNode } from 'react';

import { cx } from './tint';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--bg-muted)] text-[var(--text-secondary)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent-ink)]',
  success: 'bg-[var(--success-soft)] text-[var(--success-text)]',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning-text)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger-text)]',
  info: 'bg-[var(--info-soft)] text-[var(--info-text)]',
};

/**
 * Статус-метка.
 *
 * Цвет не единственный носитель смысла: текст обязателен. Метки описывают
 * состояние процесса и никогда не характеризуют человека.
 *
 * `dot` по умолчанию включён для цветных тонов без иконки: точка + текст.
 */
export function Badge({
  children,
  tone = 'neutral',
  icon,
  dot,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  const showDot = !icon && (dot ?? tone !== 'neutral');

  return (
    <span
      className={cx(
        'inline-flex h-6 w-fit max-w-full shrink-0 items-center gap-1.5 self-start whitespace-nowrap rounded-[var(--radius-pill)] px-2.5 text-xs font-semibold leading-none',
        'shadow-[inset_0_0_0_1px_color-mix(in_srgb,currentColor_14%,transparent)] [&_svg]:size-3.5 [&_svg]:shrink-0',
        TONE_CLASS[tone],
        className,
      )}
    >
      {showDot ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current opacity-90" />
      ) : null}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * Пометка демонстрационного режима.
 *
 * Короткая форма для навигации: полное пояснение про синтетические данные
 * даётся на самих страницах, где показан результат.
 */
export function DemoBadge() {
  return (
    <span
      title="Демонстрационный режим: все участники и данные синтетические"
      className="inline-flex"
    >
      <Badge tone="info">Демонстрация</Badge>
    </span>
  );
}
