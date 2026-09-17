'use client';

import Link from 'next/link';
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';

import { cx } from './tint';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'soft';
export type ButtonSize = 'md' | 'lg' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Показывает индикатор, не меняя ширину кнопки. */
  readonly loading?: boolean;
  /** Причина недоступности. Показывается рядом, а не вместо действия. */
  readonly disabledReason?: string;
  /** Иконка слева от текста (lucide-react, aria-hidden). */
  readonly icon?: ReactNode;
  /** Иконка справа от текста. */
  readonly iconRight?: ReactNode;
  /** Растянуть на всю ширину контейнера. */
  readonly fullWidth?: boolean;
}

const BASE_CLASS = [
  // shrink-0: кнопка рядом с растущим полем не должна сжиматься —
  // подпись у неё не переносится и обрезалась бы о границу.
  'group/button relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap border font-semibold no-underline',
  'transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--motion-fast)] ease-[var(--easing)]',
  /*
   * Кольцо фокуса — утилитой ring-*, а не shadow-*: shadow заменял тень
   * варианта целиком, и primary при фокусе терял свой подъём и верхний
   * highlight (--shadow-primary). ring и shadow складываются в один box-shadow.
   */
  'active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-[var(--focus-halo-color)]',
  'disabled:pointer-events-none aria-disabled:pointer-events-none',
  /*
   * Недоступная кнопка получает собственные токены, а не сквозную прозрачность:
   * белая подпись основной кнопки на полупрозрачном зелёном давала ~2.5:1 и
   * читалась как сбой отрисовки. Состояние «выполняется» (aria-busy)
   * исключено — там кнопка остаётся собой, а поверх неё крутится индикатор.
   */
  '[&:disabled:not([aria-busy=true])]:border-[var(--border-hairline)]',
  '[&:disabled:not([aria-busy=true])]:bg-[var(--bg-muted)]',
  '[&:disabled:not([aria-busy=true])]:text-[var(--text-secondary)]',
  '[&:disabled:not([aria-busy=true])]:shadow-none',
  '[&[aria-disabled=true]]:border-[var(--border-hairline)]',
  '[&[aria-disabled=true]]:bg-[var(--bg-muted)]',
  '[&[aria-disabled=true]]:text-[var(--text-secondary)]',
  '[&[aria-disabled=true]]:shadow-none',
  '[&_svg]:shrink-0',
].join(' ');

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--accent-hover)]/40 shadow-[var(--shadow-primary)] hover:bg-[var(--accent-hover)]',
  secondary:
    'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-control)] shadow-[var(--shadow-xs)] hover:border-[var(--border-control-hover)] hover:bg-[var(--bg-hover)]',
  ghost:
    'bg-transparent text-[var(--text-primary)] border-transparent hover:bg-[rgba(36,40,33,0.05)]',
  destructive:
    'bg-[var(--bg-surface)] text-[var(--danger-text)] border-[rgba(165,46,50,0.35)] shadow-[var(--shadow-xs)] hover:border-[var(--danger-text)] hover:bg-[var(--danger-soft)]',
  soft: 'bg-[var(--accent-soft)] text-[var(--accent-ink)] border-transparent hover:bg-[var(--accent-soft-hover)]',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-9 min-w-9 px-3 text-sm rounded-[10px] [&_svg]:size-4',
  md: 'h-11 min-w-11 px-4 text-[15px] rounded-[var(--radius-control)] [&_svg]:size-[18px]',
  lg: 'h-12 min-w-12 px-5 text-base rounded-[var(--radius-control)] [&_svg]:size-5',
};

/** Классы кнопки — для случаев, когда нужен другой элемент с тем же видом. */
export function buttonClassName({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cx(BASE_CLASS, VARIANT_CLASS[variant], SIZE_CLASS[size], fullWidth && 'w-full', className);
}

/**
 * Кнопка.
 *
 * При `loading` ширина не меняется: текст остаётся на месте и становится
 * прозрачным, а индикатор рисуется поверх. Иначе интерфейс «дёргался» бы
 * при каждом сохранении.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabledReason,
    icon,
    iconRight,
    fullWidth = false,
    children,
    className,
    disabled,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const isDisabled = disabled === true || loading;
  const reasonId = `${rest.id ?? generatedId}-reason`;

  const button = (
    <button
      ref={ref}
      type="button"
      {...rest}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      aria-describedby={disabledReason ? reasonId : rest['aria-describedby']}
      className={buttonClassName({ variant, size, fullWidth, className })}
    >
      <span className={cx('inline-flex items-center gap-2', loading && 'invisible')}>
        {icon}
        {children}
        {iconRight ? (
          <span className="inline-flex transition-transform duration-[var(--motion-fast)] group-hover/button:translate-x-0.5">
            {iconRight}
          </span>
        ) : null}
      </span>
      {loading ? (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner />
          <span className="sr-only">Выполняется…</span>
        </span>
      ) : null}
    </button>
  );

  if (!disabledReason) {
    return button;
  }

  return (
    <span className={cx('inline-flex flex-col items-start gap-1.5', fullWidth && 'w-full')}>
      {button}
      <span id={reasonId} className="text-xs leading-snug text-[var(--text-secondary)]">
        {disabledReason}
      </span>
    </span>
  );
});

export type ButtonLinkProps = Omit<ComponentPropsWithoutRef<typeof Link>, 'className'> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
  readonly iconRight?: ReactNode;
  readonly fullWidth?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
};

/** Ссылка с видом кнопки. Переход внутри приложения без перезагрузки страницы. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    fullWidth = false,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <Link ref={ref} {...rest} className={buttonClassName({ variant, size, fullWidth, className })}>
      {icon}
      {children}
      {iconRight ? (
        <span className="inline-flex transition-transform duration-[var(--motion-fast)] group-hover/button:translate-x-0.5">
          {iconRight}
        </span>
      ) : null}
    </Link>
  );
});

export type IconButtonVariant = 'ghost' | 'secondary' | 'soft';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  /** Обязательная доступная подпись: у кнопки без текста нет другого имени. */
  readonly label: string;
  readonly icon: ReactNode;
  readonly variant?: IconButtonVariant;
  readonly size?: ButtonSize;
}

const ICON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'size-9 rounded-[10px] [&_svg]:size-4',
  md: 'size-11 rounded-[var(--radius-control)] [&_svg]:size-5',
  lg: 'size-12 rounded-[var(--radius-control)] [&_svg]:size-5',
};

/** Кнопка-иконка. Подпись обязательна и уходит в aria-label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      {...rest}
      className={cx(
        'inline-flex shrink-0 items-center justify-center border',
        'transition-[background-color,border-color,color,transform] duration-[var(--motion-fast)] ease-[var(--easing)]',
        'active:scale-[0.96] focus-visible:ring-4 focus-visible:ring-[var(--focus-halo-color)]',
        'disabled:pointer-events-none aria-disabled:pointer-events-none',
        /*
         * Недоступная кнопка-иконка получает те же токены, что Button:
         * полупрозрачная иконка на полупрозрачной подложке читалась как сбой
         * отрисовки, а не как отключённое действие.
         */
        '[&:disabled:not([aria-busy=true])]:border-[var(--border-hairline)]',
        '[&:disabled:not([aria-busy=true])]:bg-[var(--bg-muted)]',
        '[&:disabled:not([aria-busy=true])]:text-[var(--text-secondary)]',
        '[&:disabled:not([aria-busy=true])]:shadow-none',
        '[&[aria-disabled=true]]:border-[var(--border-hairline)]',
        '[&[aria-disabled=true]]:bg-[var(--bg-muted)]',
        '[&[aria-disabled=true]]:text-[var(--text-secondary)]',
        '[&[aria-disabled=true]]:shadow-none',
        variant === 'ghost' &&
          'border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[rgba(36,40,33,0.06)] hover:text-[var(--text-primary)] data-[state=open]:bg-[rgba(36,40,33,0.06)]',
        variant === 'secondary' &&
          'border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-xs)] hover:border-[var(--border-control-hover)] hover:bg-[var(--bg-hover)]',
        variant === 'soft' &&
          'border-transparent bg-[var(--accent-soft)] text-[var(--accent-ink)] hover:bg-[var(--accent-soft-hover)]',
        ICON_SIZE_CLASS[size],
        className,
      )}
    >
      {icon}
    </button>
  );
});

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden="true"
      /* ui-spinner: индикатор продолжает вращаться при reduced motion (см. tokens.css) */
      className="ui-spinner animate-spin"
      style={{ animationDuration: '900ms' }}
    >
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2.5"
      />
      <path
        d="M18 10a8 8 0 0 0-8-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
