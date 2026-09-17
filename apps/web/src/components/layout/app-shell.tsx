'use client';

import { ChevronsUpDown, Menu, type LucideIcon } from 'lucide-react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';

import { Monogram } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/button';
import { Sheet } from '@/components/ui/dialog';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/states';
import { cx } from '@/components/ui/tint';

export interface ShellNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Активен только при точном совпадении пути (корень раздела). */
  readonly exact?: boolean;
}

export interface ShellNavGroup {
  /** Подпись группы; без подписи группа идёт первой без заголовка. */
  readonly label?: string;
  readonly items: readonly ShellNavItem[];
}

export interface ShellUser {
  readonly name: string;
  readonly subtitle?: string;
  /** Стабильный ключ цвета монограммы (например, userId). */
  readonly seed?: string;
}

/**
 * Активный пункт: корень — только при точном совпадении, остальные — по префиксу.
 * Если подходят несколько, выигрывает самый длинный путь.
 */
export function resolveActiveHref(
  pathname: string,
  groups: readonly ShellNavGroup[],
): string | null {
  let best: string | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      const match = item.exact
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (match && (best === null || item.href.length > best.length)) {
        best = item.href;
      }
    }
  }
  return best;
}

/** Логомарк: скруглённый квадрат с forest-градиентом и буквой «К». */
export function Logomark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-grid shrink-0 place-items-center rounded-[10px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_6px_rgba(47,82,67,0.35)]"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        background: 'var(--hero-gradient)',
      }}
    >
      К
    </span>
  );
}

/** Декоративный фон приложения. */
export function AppBackdrop() {
  return <div aria-hidden="true" className="app-backdrop" />;
}

function NavList({
  groups,
  activeHref,
  label,
  onNavigate,
}: {
  groups: readonly ShellNavGroup[];
  activeHref: string | null;
  label: string;
  onNavigate?: () => void;
}) {
  const layoutId = useId();
  const reduce = useReducedMotion();

  return (
    <nav aria-label={label} className="flex flex-col gap-5">
      <LayoutGroup id={layoutId}>
        {groups.map((group, groupIndex) => (
          <div key={group.label ?? `group-${groupIndex}`} className="flex flex-col gap-1">
            {group.label ? (
              /* --text-tertiary допустим только от 14px, поэтому подпись группы
                 остаётся на --text-secondary (6.4:1) — см. tokens.css. */
              <p className="eyebrow px-3 pb-1">{group.label}</p>
            ) : null}
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {group.items.map((item) => {
                const active = item.href === activeHref;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      onClick={onNavigate}
                      className={cx(
                        'group/nav relative flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-[15px] no-underline lg:min-h-10 lg:text-sm',
                        'transition-colors duration-[var(--motion-fast)] ease-[var(--easing)]',
                        active
                          ? 'font-semibold text-[var(--text-primary)] hover:text-[var(--text-primary)]'
                          : 'font-medium text-[var(--text-secondary)] hover:bg-[rgba(36,40,33,0.05)] hover:text-[var(--text-primary)]',
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId="nav-pill"
                          aria-hidden="true"
                          className="absolute inset-0 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-[0_1px_2px_rgba(48,55,42,0.06),0_4px_12px_rgba(48,55,42,0.06)]"
                          transition={
                            reduce
                              ? { duration: 0 }
                              : { type: 'spring', bounce: 0.1, duration: 0.35 }
                          }
                        />
                      ) : null}
                      <Icon
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className={cx(
                          'relative size-[18px] shrink-0 transition-colors duration-[var(--motion-fast)]',
                          active
                            ? 'text-[var(--accent)]'
                            : 'text-[var(--text-tertiary)] group-hover/nav:text-[var(--text-secondary)]',
                        )}
                      />
                      <span className="relative truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </LayoutGroup>
    </nav>
  );
}

const UserTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'> & { user: ShellUser }
>(function UserTrigger({ user, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      aria-label={`Меню пользователя: ${user.name}`}
      className={cx(
        'flex w-full min-w-0 items-center gap-2.5 rounded-[var(--radius-nested)] p-2 text-left',
        'transition-colors duration-[var(--motion-fast)] hover:bg-[rgba(36,40,33,0.05)] data-[state=open]:bg-[rgba(36,40,33,0.05)]',
        className,
      )}
    >
      {/* Монограмма sm и узкий шеврон: ширину отдаём имени. */}
      <Monogram name={user.name} seed={user.seed ?? user.name} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col">
        {/* Длинные синтетические имена переносятся: обрезанное «Руководитель О…» бесполезно. */}
        <span
          className="line-clamp-2 break-words text-sm font-semibold leading-tight text-[var(--text-primary)]"
          title={user.name}
        >
          {user.name}
        </span>
        {user.subtitle ? (
          <span
            className="line-clamp-2 text-[13px] leading-tight text-[var(--text-secondary)]"
            title={user.subtitle}
          >
            {user.subtitle}
          </span>
        ) : null}
      </span>
      <ChevronsUpDown
        aria-hidden="true"
        strokeWidth={1.75}
        className="-mr-0.5 size-3.5 shrink-0 text-[var(--text-tertiary)]"
      />
    </button>
  );
});

function SidebarContent({
  navigation,
  navLabel,
  context,
  user,
  userMenuItems,
  activeHref,
  onNavigate,
}: {
  navigation: readonly ShellNavGroup[];
  navLabel: string;
  context?: ReactNode;
  user: ShellUser;
  userMenuItems: readonly ActionMenuItem[];
  activeHref: string | null;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-4 px-3 pb-5">
        <Link
          href={navigation[0]?.items[0]?.href ?? '/'}
          onClick={onNavigate}
          className="-mx-1 flex w-fit items-center gap-2.5 rounded-[10px] px-1 py-1 text-[var(--text-primary)] no-underline hover:text-[var(--text-primary)]"
        >
          <Logomark />
          <span className="text-[17px] font-bold tracking-[-0.01em]">Контекст</span>
        </Link>
        {context ? <div className="min-w-0">{context}</div> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <NavList
          groups={navigation}
          activeHref={activeHref}
          label={navLabel}
          onNavigate={onNavigate}
        />
      </div>

      <div className="border-t border-[var(--border-hairline)] pt-3">
        <ActionMenu
          label="Меню пользователя"
          items={userMenuItems}
          side="top"
          align="start"
          contentClassName="min-w-[232px]"
          trigger={<UserTrigger user={user} />}
        />
      </div>
    </div>
  );
}

/**
 * Общая оболочка кабинетов руководителя и администратора.
 *
 * Desktop ≥1024: sticky sidebar 248px. Уже — стеклянная верхняя строка
 * и навигация в выдвижной панели слева (ловушка фокуса, Esc, закрытие при переходе).
 * Layout при переходах не перерисовывается: страницы меняются внутри main.
 */
export function AppShell({
  navigation,
  navLabel = 'Разделы',
  context,
  user,
  userMenuItems,
  topbarSlot,
  children,
}: {
  navigation: readonly ShellNavGroup[];
  navLabel?: string;
  /** Блок под логотипом: организация и режим или метка роли. */
  context?: ReactNode;
  user: ShellUser;
  userMenuItems: readonly ActionMenuItem[];
  /** Правый слот верхней строки (например, уведомления). */
  topbarSlot?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const activeHref = resolveActiveHref(pathname, navigation);
  /*
    Верхняя строка на desktop рисуется только когда в правом слоте что-то есть.
    Пустая полоса 64px с линией отнимала вертикаль у заголовка страницы и ни с
    чем не стыковалась: слева sidebar без такой линии. Название раздела туда не
    кладём — оно дублировало бы h1. topbarSlot остаётся точкой расширения
    (уведомления M14): как только он появится, строка вернётся сама.
  */
  const desktopTopbar = Boolean(topbarSlot);

  return (
    <div className="relative min-h-dvh lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
      <AppBackdrop />

      {/*
        Не <aside>: внутри лежит основная навигация <nav>, а complementary —
        неверный ориентир для неё. Для диктора это просто контейнер, а
        ориентиром служит сам <nav aria-label>.
      */}
      <div className="relative z-10 hidden border-r border-[var(--border-hairline)] bg-[var(--bg-sidebar)] lg:block">
        <div className="sticky top-0 flex h-dvh flex-col px-3 pb-3 pt-5">
          <SidebarContent
            navigation={navigation}
            navLabel={navLabel}
            context={context}
            user={user}
            userMenuItems={userMenuItems}
            activeHref={activeHref}
          />
        </div>
      </div>

      <div className="relative z-[1] flex min-w-0 flex-col">
        {/*
          Верхняя строка: на узких экранах это логомарк с названием продукта и
          кнопка меню. Название текущего раздела здесь не показываем — оно
          дублировало бы h1 страницы, который идёт сразу под строкой (то же
          соображение, по которому строки нет на desktop). На desktop строка
          появляется вместе с правым слотом (уведомления M14).
          viewportFit: 'cover' — учитываем безопасную зону сверху, иначе
          содержимое уедет под статус-бар.
        */}
        <header
          className={cx(
            'surface-glass sticky top-0 z-30 flex h-[calc(var(--topbar-height)+env(safe-area-inset-top))] items-center gap-3 border-b border-[var(--border-hairline)] px-4 pt-[env(safe-area-inset-top)] sm:px-6 lg:px-8',
            desktopTopbar ? 'lg:justify-end' : 'lg:hidden',
          )}
        >
          <Link
            href={navigation[0]?.items[0]?.href ?? '/'}
            className="flex min-w-0 shrink items-center gap-2.5 rounded-[10px] text-[var(--text-primary)] no-underline hover:text-[var(--text-primary)] lg:hidden"
          >
            <Logomark />
            <span className="truncate text-[17px] font-bold tracking-[-0.01em]">Контекст</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">{topbarSlot}</div>
          <IconButton
            ref={menuButtonRef}
            label="Открыть меню"
            variant="secondary"
            icon={<Menu aria-hidden="true" strokeWidth={1.75} />}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
            className="lg:hidden"
          />
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-6 focus:outline-none sm:px-6 lg:px-8 lg:pt-8"
        >
          {children}
        </main>
      </div>

      <Sheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="Навигация"
        side="left"
        width="300px"
        hideTitle
        /* Фокус после закрытия возвращается на кнопку «Открыть меню». */
        returnFocusRef={menuButtonRef}
        /* Нижний отступ не задаём: его считает Sheet с учётом безопасной зоны. */
        bodyClassName="px-3! pt-5! flex flex-col"
      >
        <SidebarContent
          navigation={navigation}
          navLabel={navLabel}
          context={context}
          user={user}
          userMenuItems={userMenuItems}
          activeHref={activeHref}
          onNavigate={() => setMenuOpen(false)}
        />
      </Sheet>
    </div>
  );
}

/**
 * Скелетон оболочки на время проверки доступа.
 *
 * Собран из тех же контейнеров и отступов, что настоящая оболочка (px-3,
 * группы навигации, высота верхней строки с безопасной зоной), иначе при
 * появлении данных содержимое заметно прыгает.
 */
export function AppShellSkeleton({ label = 'Проверяем доступ' }: { label?: string }) {
  const groups = [1, 4] as const;

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="relative min-h-dvh lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]"
    >
      <AppBackdrop />
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="relative z-10 hidden border-r border-[var(--border-hairline)] bg-[var(--bg-sidebar)] lg:block"
      >
        <div className="sticky top-0 flex h-dvh flex-col px-3 pb-3 pt-5">
          <div className="flex flex-col gap-4 px-3 pb-5">
            <span className="flex w-fit items-center gap-2.5">
              <Logomark />
              <span className="text-[17px] font-bold tracking-[-0.01em]">Контекст</span>
            </span>
            <Skeleton className="h-[62px] w-full rounded-[var(--radius-nested)]" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-5 pb-4">
            {groups.map((count, groupIndex) => (
              <div key={groupIndex} className="flex flex-col gap-1">
                <div className="px-3 pb-1">
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="flex flex-col gap-0.5">
                  {Array.from({ length: count }, (_, index) => (
                    <div key={index} className="flex min-h-10 items-center gap-3 px-3">
                      <Skeleton className="size-[18px] shrink-0 rounded-md" />
                      <Skeleton className="h-3.5 w-28" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2.5 border-t border-[var(--border-hairline)] p-2 pt-5">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        </div>
      </div>
      <div className="relative z-[1] flex min-w-0 flex-col">
        {/* Та же высота и безопасная зона, что у настоящей верхней строки;
            на desktop строки нет — она появляется только вместе со слотом. */}
        <div
          aria-hidden="true"
          className="surface-glass flex h-[calc(var(--topbar-height)+env(safe-area-inset-top))] items-center gap-2.5 border-b border-[var(--border-hairline)] px-4 pt-[env(safe-area-inset-top)] sm:px-6 lg:hidden"
        >
          <Logomark />
          <span className="text-[17px] font-bold tracking-[-0.01em]">Контекст</span>
          <Skeleton className="ml-auto size-11 rounded-[var(--radius-control)]" />
        </div>
        {/*
          Скелетон тоже содержит <main id="main">: ссылка «Перейти к
          содержимому» ведёт на этот якорь, а холодная загрузка кабинета
          начинается именно со скелетона — без main первая же цель клавиатуры
          вела бы в никуда.
        */}
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-6 focus:outline-none sm:px-6 lg:px-8 lg:pt-8"
        >
          <div aria-hidden="true" className="flex flex-col gap-6">
            <div className="flex flex-col gap-2.5">
              <Skeleton className="h-8 w-56 rounded-[10px]" />
              <Skeleton className="h-4 w-80 max-w-[80vw]" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-32 rounded-[var(--radius-card)]" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-[var(--radius-card)]" />
          </div>
        </main>
      </div>
    </div>
  );
}

/** Состояние оболочки по центру экрана: ошибка загрузки, нет доступа. */
export function ShellMessage({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center px-4 py-10">
      <AppBackdrop />
      <main
        id="main"
        className="relative z-[1] flex w-full max-w-[560px] flex-col items-center gap-6"
      >
        <div className="flex items-center gap-2.5">
          <Logomark />
          <span className="text-[17px] font-bold tracking-[-0.01em]">Контекст</span>
        </div>
        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}
