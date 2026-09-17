import { ROTATION_TINTS, TINT_CLASS, cx, pickTint } from './tint';

const SIZE_CLASS = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
} as const;

function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word));
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toLocaleUpperCase('ru-RU') || '·';
}

/**
 * Монограмма: инициалы в тинт-круге. Цвет детерминирован от `seed`
 * (например, id), чтобы не менялся при переименовании. Фотографий нет.
 */
export function Monogram({
  name,
  seed,
  size = 'md',
  className,
}: {
  name: string;
  seed?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const tint = pickTint(seed ?? name, ROTATION_TINTS);

  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-grid shrink-0 select-none place-items-center rounded-full font-semibold tracking-[0.02em]',
        SIZE_CLASS[size],
        TINT_CLASS[tint],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
