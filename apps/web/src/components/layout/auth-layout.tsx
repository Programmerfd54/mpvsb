import type { ReactNode } from 'react';

import { cx } from '@/components/ui/tint';

import { AppBackdrop, Logomark } from './app-shell';

interface AuthLimit {
  readonly icon: ReactNode;
  readonly text: string;
}

/**
 * Список «что платформа не делает».
 *
 * Два вида: на градиентной панели (desktop) и на бумаге под формой (телефон).
 * Текст один и тот же — меняются только цвета, поэтому предупреждение
 * одинаково обязательно на любой ширине.
 */
function AuthLimits({ limits, tone }: { limits: readonly AuthLimit[]; tone: 'hero' | 'paper' }) {
  const hero = tone === 'hero';

  return (
    <div
      className={cx(
        'flex flex-col gap-3',
        !hero &&
          'rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)]',
      )}
    >
      {/* На градиенте eyebrow 13px: 12px uppercase там читается заметно хуже. */}
      <p className={cx('eyebrow', hero && 'text-[13px]! text-[var(--text-on-hero-muted)]!')}>
        Что платформа не делает
      </p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {limits.map((limit, index) => (
          <li
            key={limit.text}
            className={cx(
              'flex items-start gap-3 leading-relaxed',
              hero
                ? 'text-[16px] text-[var(--text-on-hero)]'
                : 'text-[15px] text-[var(--text-primary)]',
              index > 0 &&
                (hero
                  ? 'border-t border-[rgba(255,255,255,0.16)] pt-3'
                  : 'border-t border-[var(--border-hairline)] pt-3'),
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                'mt-px grid size-7 shrink-0 place-items-center rounded-[10px] [&_svg]:size-4',
                hero
                  ? 'bg-[rgba(255,255,255,0.16)] text-[var(--text-on-hero)]'
                  : 'bg-[var(--accent-soft)] text-[var(--accent-ink)]',
              )}
            >
              {limit.icon}
            </span>
            <span>{limit.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Каркас публичных страниц: вход и открытие приглашения.
 *
 * Desktop: слева спокойная hero-панель без маркетинговых обещаний —
 * логомарк и заголовок сверху, честный список ограничений прижат к низу
 * панели, справа форма на непрозрачной белой карточке.
 *
 * Телефон: панель сжимается до шапки (логомарк + заголовок), форма идёт
 * сразу за ней и помещается в экран целиком, а пояснение и ограничения
 * переезжают под форму. Раньше hero занимал 507–537px и кнопка «Войти»
 * оказывалась за кромкой экрана: пользователь видел только панель.
 */
export function AuthSplitLayout({
  title,
  description,
  limits,
  children,
}: {
  title: string;
  description: string;
  /** Честные ограничения: что платформа не делает. Иконку задаёт вызывающий. */
  limits?: ReadonlyArray<AuthLimit>;
  children: ReactNode;
}) {
  const hasLimits = Boolean(limits && limits.length > 0);

  return (
    <div className="relative min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
      <AppBackdrop />

      <section className="hero-surface relative z-[1] flex flex-col px-5 pb-7 pt-[max(20px,env(safe-area-inset-top))] sm:px-8 lg:px-12 lg:py-12">
        <div className="flex items-center gap-2.5">
          <Logomark size={36} />
          <span className="text-[19px] font-bold tracking-[-0.01em] text-[var(--text-on-hero)]">
            Контекст
          </span>
        </div>

        <h1 className="mt-5 max-w-[42rem] text-[22px] leading-[1.2] text-[var(--text-on-hero)] sm:text-[26px] lg:mt-14 lg:text-[clamp(32px,3vw,44px)]">
          {title}
        </h1>

        {/* Пояснение и ограничения на телефоне живут под формой (см. ниже). */}
        <p className="mt-6 hidden max-w-[42rem] text-[17px] leading-relaxed text-[var(--text-on-hero-muted)] lg:block">
          {description}
        </p>

        {hasLimits && limits ? (
          <div className="mt-auto hidden max-w-[42rem] pt-12 lg:block">
            <AuthLimits limits={limits} tone="hero" />
          </div>
        ) : null}
      </section>

      <main
        id="main"
        tabIndex={-1}
        className="relative z-[1] flex w-full flex-col justify-center px-4 py-8 pb-[calc(2rem+env(safe-area-inset-bottom))] focus:outline-none sm:px-8 lg:px-12 lg:py-12"
      >
        <div className="mx-auto flex w-full max-w-[440px] flex-col gap-6">
          {children}

          <div className="flex flex-col gap-5 lg:hidden">
            <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
              {description}
            </p>
            {hasLimits && limits ? <AuthLimits limits={limits} tone="paper" /> : null}
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Одиночная карточка публичной страницы по центру экрана:
 * приглашение, истёкшая ссылка, сообщение об ошибке.
 */
export function AuthCard({
  icon,
  tintClassName = 'bg-[var(--accent-soft)] text-[var(--accent-ink)]',
  title,
  description,
  children,
  presentation = 'default',
}: {
  icon?: ReactNode;
  /** Классы тинта плашки иконки (см. TINT_CLASS). */
  tintClassName?: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Более выразительная композиция для первого экрана приглашения. */
  presentation?: 'default' | 'invitation';
}) {
  const invitation = presentation === 'invitation';

  return (
    <div className={cx('relative min-h-dvh px-4', invitation ? 'py-8 sm:py-12' : 'py-10')}>
      <AppBackdrop />
      <main
        id="main"
        className={cx(
          'relative z-[1] mx-auto flex w-full flex-col justify-center',
          invitation
            ? 'min-h-[calc(100dvh-6rem)] max-w-[720px] gap-8'
            : 'min-h-[calc(100dvh-5rem)] max-w-[640px] gap-6',
        )}
      >
        <div className={cx('flex items-center justify-center', invitation ? 'gap-3' : 'gap-2.5')}>
          <Logomark size={invitation ? 42 : 32} />
          <span
            className={cx(
              'font-bold tracking-[-0.01em]',
              invitation ? 'text-[20px]' : 'text-[17px]',
            )}
          >
            Контекст
          </span>
        </div>

        <div
          className={cx(
            'rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-[var(--shadow-card)]',
            invitation ? 'p-7 sm:p-10' : 'p-6 sm:p-8',
          )}
        >
          <div className={cx(invitation && 'flex items-center gap-4 sm:gap-5')}>
            {icon ? (
              <span
                aria-hidden="true"
                className={cx(
                  'grid shrink-0 place-items-center rounded-[var(--radius-nested)]',
                  invitation ? 'size-14 [&_svg]:size-7' : 'mb-5 size-12 [&_svg]:size-6',
                  tintClassName,
                )}
              >
                {icon}
              </span>
            ) : null}
            <h1
              className={cx(
                'leading-tight',
                invitation
                  ? 'text-[clamp(24px,3.2vw,32px)] tracking-[-0.025em] sm:whitespace-nowrap'
                  : 'text-[clamp(22px,2vw,26px)]',
              )}
            >
              {title}
            </h1>
          </div>
          {description ? (
            <div
              className={cx(
                'text-[var(--text-secondary)]',
                invitation
                  ? 'mt-6 max-w-[62ch] text-[17px] leading-[1.65]'
                  : 'mt-3 text-[15px] leading-relaxed',
              )}
            >
              {description}
            </div>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
