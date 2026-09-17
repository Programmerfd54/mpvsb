'use client';

import {
  Activity,
  BookOpenCheck,
  Building2,
  Gauge,
  LogOut,
  Route,
  ShieldCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { ButtonLink } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { ToastHost } from '@/components/ui/toast';
import {
  AppShell,
  AppShellSkeleton,
  ShellMessage,
  type ShellNavGroup,
} from '@/components/layout/app-shell';
import { SessionProvider, signOut, useSession } from '@/lib/session';

const NAVIGATION: readonly ShellNavGroup[] = [
  {
    label: 'Платформа',
    items: [
      { href: '/admin', label: 'Обзор', icon: Gauge, exact: true },
      { href: '/admin/organizations', label: 'Организации', icon: Building2 },
      { href: '/admin/methods', label: 'Методики', icon: BookOpenCheck },
      { href: '/admin/scenarios', label: 'Сценарии', icon: Route },
      { href: '/admin/operations', label: 'Обработка и аудит', icon: Activity },
    ],
  },
];

/**
 * Оболочка администратора платформы.
 *
 * Отличается от кабинета руководителя явной меткой роли и отсутствием
 * организации в шапке: администратор работает со всей платформой, но не
 * с содержанием чужих оценок.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AdminWorkspace>{children}</AdminWorkspace>
    </SessionProvider>
  );
}

function AdminWorkspace({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  if (session.status === 'loading' || session.status === 'anonymous') {
    return <AppShellSkeleton label="Проверяем доступ" />;
  }

  if (session.status === 'error') {
    return (
      <ShellMessage>
        <ErrorState
          title="Не удалось загрузить раздел администратора"
          description="Проверьте подключение и обновите страницу."
          requestId={session.error?.problem.requestId}
          onRetry={() => window.location.reload()}
        />
      </ShellMessage>
    );
  }

  if (!session.profile?.isPlatformAdmin) {
    return (
      <ShellMessage>
        <ErrorState
          title="Раздел доступен только администратору платформы"
          description="Вернитесь в рабочее пространство своей организации."
          tint="warning"
          action={
            <ButtonLink href="/app" variant="primary" size="sm">
              В рабочее пространство
            </ButtonLink>
          }
        />
      </ShellMessage>
    );
  }

  return (
    <>
      <AppShell
        navLabel="Разделы администратора"
        navigation={NAVIGATION}
        context={
          <div className="flex items-center gap-2.5 rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2.5 shadow-[var(--shadow-xs)]">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
            >
              <ShieldCheck className="size-[18px]" strokeWidth={1.75} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="eyebrow">Роль</span>
              <span className="text-sm font-semibold leading-snug">Администратор платформы</span>
            </span>
          </div>
        }
        user={{
          name: session.profile.displayName,
          /*
           * Без e-mail: адрес — персональные данные, постоянно висящие на общем
           * экране, и он всё равно обрезается. Роль уже показана карточкой выше,
           * поэтому подпись здесь не дублируется.
           */
          seed: session.profile.userId,
        }}
        userMenuItems={[
          {
            label: 'Выйти',
            icon: <LogOut strokeWidth={1.75} />,
            onSelect: () => void signOut(),
          },
        ]}
      >
        {children}
      </AppShell>
      {/* Уведомления — рядом с оболочкой, а не внутри <main>: вложенный landmark. */}
      <ToastHost />
    </>
  );
}
