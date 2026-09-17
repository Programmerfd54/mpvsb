/**
 * Тинты: мягкий фон + парный «ink»-цвет текста и иконки.
 * Все пары дают контраст не меньше 5:1, поэтому на тинте можно писать текст.
 */
export type Tint =
  'neutral' | 'accent' | 'peach' | 'lavender' | 'sky' | 'success' | 'warning' | 'danger' | 'info';

export const TINT_CLASS: Record<Tint, string> = {
  neutral: 'bg-[var(--bg-muted)] text-[var(--text-secondary)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent-ink)]',
  peach: 'bg-[var(--peach-soft)] text-[var(--peach-ink)]',
  lavender: 'bg-[var(--lavender-soft)] text-[var(--lavender-ink)]',
  sky: 'bg-[var(--sky-soft)] text-[var(--sky-ink)]',
  success: 'bg-[var(--success-soft)] text-[var(--success-text)]',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning-text)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger-text)]',
  info: 'bg-[var(--info-soft)] text-[var(--info-text)]',
};

/** Мягкий фон тинта как значение CSS: для декоративных пятен и подложек. */
export const TINT_SOFT_VAR: Record<Tint, string> = {
  neutral: 'var(--bg-muted)',
  accent: 'var(--accent-soft)',
  peach: 'var(--peach-soft)',
  lavender: 'var(--lavender-soft)',
  sky: 'var(--sky-soft)',
  success: 'var(--success-soft)',
  warning: 'var(--warning-soft)',
  danger: 'var(--danger-soft)',
  info: 'var(--info-soft)',
};

/** Нейтральная ротация оттенков: ничего не означает, только различает карточки. */
export const ROTATION_TINTS: readonly Tint[] = ['accent', 'peach', 'lavender', 'sky'];

/** Устойчивый хеш строки: цвет не меняется между загрузками и на сервере. */
export function hashString(value: string): number {
  let result = 0;
  for (const char of value) {
    result = (result * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return result;
}

/**
 * Детерминированный оттенок по ключу. Цвет здесь — оформление, а не смысл:
 * значение статуса всегда передаётся текстом (ТЗ 02.2).
 */
export function pickTint(seed: string, palette: readonly Tint[] = ROTATION_TINTS): Tint {
  return palette[hashString(seed) % palette.length] ?? 'accent';
}

/** Объединяет классы, отбрасывая пустые значения. */
export function cx(...values: unknown[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}
