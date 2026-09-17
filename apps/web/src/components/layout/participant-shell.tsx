'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { Logomark } from './app-shell';

interface TopbarInfo {
  /**
   * Что открыто сейчас: название организации или теста — если страница уже
   * знает его из своих данных. Оболочка сама ничего не запрашивает.
   */
  readonly context?: string;
  /** Короткий статус сохранения: «Ответы сохраняются автоматически», «Сохранено». */
  readonly status?: string;
  /**
   * Контакт для вопросов: почта или телефон организации, если страница их
   * знает. Оболочка ничего не выдумывает и без этих данных ссылку не рисует.
   */
  readonly help?: string;
  /** Ссылка для контакта: `mailto:` или `tel:`. Без неё контакт — просто текст. */
  readonly helpHref?: string;
}

const TopbarContext = createContext<((info: TopbarInfo) => void) | null>(null);

/**
 * Сведения для верхней строки участника.
 *
 * Компонент ничего не рисует: страница объявляет, что показать в шапке,
 * а рисует это оболочка. Только примитивные значения — ссылка на React-узел
 * менялась бы на каждом рендере и вызывала бы бесконечное обновление.
 */
export function ParticipantTopbarInfo({ context, status, help, helpHref }: TopbarInfo) {
  const set = useContext(TopbarContext);

  useEffect(() => {
    set?.({ context, status, help, helpHref });
    return () => set?.({});
  }, [set, context, status, help, helpHref]);

  return null;
}

/**
 * Оболочка участника.
 *
 * Без корпоративной навигации, списков людей и рейтингов: у участника одна
 * задача — спокойно ответить на вопросы. Сверху — стеклянная строка с
 * названием платформы, организацией (если страница её знает) и статусом
 * сохранения и контактом «Помощь», если страница его знает;
 * ниже — центральная колонка 720px. Нижние действия страниц
 * учитывают безопасную зону телефона (ТЗ 02.3).
 */
export function ParticipantShell({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<TopbarInfo>({});
  const set = useCallback((next: TopbarInfo) => setInfo(next), []);
  const value = useMemo(() => set, [set]);

  return (
    <TopbarContext.Provider value={value}>
      <div className="relative min-h-dvh">
        <div aria-hidden="true" className="app-backdrop" />

        <header className="surface-glass sticky top-0 z-30 border-b border-[var(--border-hairline)] pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-[var(--topbar-height)] w-full max-w-[720px] items-center gap-3 px-4">
            <span className="flex shrink-0 items-center gap-2.5">
              <Logomark size={28} />
              <span className="text-[15px] font-bold tracking-[-0.01em]">Контекст</span>
            </span>
            {info.context ? (
              <>
                <span aria-hidden="true" className="text-[var(--border-strong)]">
                  /
                </span>
                <p
                  className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]"
                  title={info.context}
                >
                  {info.context}
                </p>
              </>
            ) : (
              <span className="flex-1" />
            )}
            {info.status ? (
              <p
                aria-live="polite"
                className="shrink-0 text-[13px] text-[var(--text-secondary)] sm:text-sm"
              >
                {info.status}
              </p>
            ) : null}
            {/* Помощь — только реальный контакт организации со страницы. */}
            {info.help ? (
              info.helpHref ? (
                <a href={info.helpHref} className="shrink-0 text-[13px] font-medium sm:text-sm">
                  {info.help}
                </a>
              ) : (
                <p className="shrink-0 text-[13px] text-[var(--text-secondary)] sm:text-sm">
                  {info.help}
                </p>
              )
            ) : null}
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="relative z-[1] mx-auto w-full max-w-[720px] px-4 py-6 focus:outline-none md:py-10"
          style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </main>
      </div>
    </TopbarContext.Provider>
  );
}
