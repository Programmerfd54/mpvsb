import { ArrowLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Заголовок страницы: единственный h1, хлебные крошки, мета-бейджи и основное действие. */
export function PageHeader({
  title,
  description,
  action,
  breadcrumbs,
  meta,
  eyebrow,
  backHref,
  backLabel = 'Назад',
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  breadcrumbs?: ReadonlyArray<{ label: string; href?: string }>;
  /** Ряд бейджей под заголовком. */
  meta?: ReactNode;
  /** Короткая надпись над заголовком. */
  eyebrow?: ReactNode;
  /** Ссылка «назад» над заголовком (если нет хлебных крошек). */
  backHref?: string;
  backLabel?: string;
}) {
  const hasCrumbs = Boolean(breadcrumbs && breadcrumbs.length > 0);

  return (
    <header className="mb-6 flex flex-col gap-3 sm:mb-8">
      {hasCrumbs ? (
        <nav aria-label="Навигационная цепочка">
          <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-sm text-[var(--text-secondary)]">
            {breadcrumbs?.map((crumb, index) => {
              const last = index === (breadcrumbs?.length ?? 0) - 1;
              return (
                <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
                  {crumb.href && !last ? (
                    <Link
                      href={crumb.href}
                      className="-mx-1 truncate rounded-md px-1 py-0.5 text-[var(--text-secondary)] no-underline transition-colors hover:bg-[rgba(36,40,33,0.05)] hover:text-[var(--text-primary)]"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      className="max-w-[40ch] truncate text-[var(--text-primary)]"
                      aria-current={last ? 'page' : undefined}
                    >
                      {crumb.label}
                    </span>
                  )}
                  {!last ? (
                    <ChevronRight
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="size-3.5 shrink-0 text-[var(--text-tertiary)]"
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : backHref ? (
        <Link
          href={backHref}
          className="-ml-1 inline-flex min-h-9 w-fit items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-[var(--text-secondary)] no-underline transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="size-4" />
          {backLabel}
        </Link>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
          <h1 className="break-words">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-[72ch] text-[15px] leading-relaxed text-[var(--text-secondary)] sm:text-base">
              {description}
            </p>
          ) : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {action ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">{action}</div>
        ) : null}
      </div>
    </header>
  );
}
