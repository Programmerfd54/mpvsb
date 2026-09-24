'use client';

import { ClipboardList, Home, LogOut, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import {
  AppShell,
  AppShellSkeleton,
  ShellMessage,
  type ShellNavGroup,
} from '@/components/layout/app-shell';
import { ErrorState } from '@/components/ui/states';
import { ToastHost } from '@/components/ui/toast';
import { SessionProvider, signOut, useSession } from '@/lib/session';

const navigation: ShellNavGroup[] = [
  {
    label: 'Личный кабинет',
    items: [
      { href: '/employee', label: 'Главная', icon: Home, exact: true },
      { href: '/employee/assessments', label: 'Оценки', icon: ClipboardList },
      { href: '/employee/settings', label: 'Настройки', icon: Settings },
    ],
  },
];

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <EmployeeWorkspace>{children}</EmployeeWorkspace>
    </SessionProvider>
  );
}

function EmployeeWorkspace({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session.status === 'anonymous') router.replace('/login');
  }, [session.status, router]);

  if (session.status === 'loading' || session.status === 'anonymous') return <AppShellSkeleton />;
  if (session.status === 'error')
    return (
      <ShellMessage>
        <ErrorState
          title="Не удалось загрузить кабинет"
          requestId={session.error?.problem.requestId}
          onRetry={() => window.location.reload()}
        />
      </ShellMessage>
    );
  if (session.profile?.actorType !== 'employee')
    return (
      <ShellMessage>
        <ErrorState
          title="Кабинет доступен только сотруднику"
          description="Войдите под учётной записью сотрудника."
        />
      </ShellMessage>
    );

  return (
    <>
      <AppShell
        navigation={navigation}
        navLabel="Разделы кабинета сотрудника"
        context={
          <div className="rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2.5">
            <p className="eyebrow">Роль</p>
            <p className="mt-1 text-sm font-semibold">Сотрудник</p>
          </div>
        }
        user={{
          name: session.profile.displayName,
          subtitle: 'Личный кабинет',
          seed: session.profile.userId,
        }}
        userMenuItems={[
          { label: 'Выйти', icon: <LogOut strokeWidth={1.75} />, onSelect: () => void signOut() },
        ]}
      >
        {children}
      </AppShell>
      <ToastHost />
    </>
  );
}
