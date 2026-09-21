import { notFound } from 'next/navigation';
import Link from 'next/link';

import { MOCK_ROLES, MOCK_SCREENS, mockHref } from './catalog';

/** Изолированная галерея: синтетические данные, без API и без production-доступа. */
export default function MockupsIndex() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return (
    <main id="main" className="mx-auto max-w-[1180px] px-4 py-10 sm:px-8">
      <div className="mb-8 rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-card)] sm:p-8">
        <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-sm font-semibold text-[var(--accent-ink)]">
          Локальные макеты · синтетические данные
        </span>
        <h1 className="mt-4 text-3xl">Все экраны полного ТЗ</h1>
        <p className="mt-3 max-w-[760px] text-[var(--text-secondary)]">
          Это отдельный визуальный маршрут для обсуждения структуры и UX. Кнопки здесь не отправляют
          запросы, данные не сохраняются, доступ к реальным организациям не открывается. Рабочее
          приложение находится на обычных адресах.
        </p>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {MOCK_SCREENS.length} макета по разделам M01–M15, E01–E09 и A01–A14.
        </p>
      </div>
      {MOCK_ROLES.map((role) => (
        <section key={role} className="mb-10">
          <h2 className="mb-4 text-2xl font-semibold">{role}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MOCK_SCREENS.filter((screen) => screen.role === role).map((screen) => (
              <Link
                key={screen.id}
                href={mockHref(screen.id)}
                className="rounded-[var(--radius-panel)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] no-underline shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--accent-soft-border)] hover:bg-[var(--bg-hover)]"
              >
                <span className="text-xs font-semibold text-[var(--accent)]">
                  {screen.code} · {screen.path}
                </span>
                <h3 className="mt-2 text-lg font-semibold">{screen.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                  {screen.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
