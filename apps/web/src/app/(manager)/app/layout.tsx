'use client';

import {
  ClipboardList,
  FileCheck2,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  UserRound,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import type { OrgPermission } from '@context/domain';

import { DemoBadge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/states';
import { ToastHost } from '@/components/ui/toast';
import {
  AppShell,
  AppShellSkeleton,
  ShellMessage,
  type ShellNavGroup,
} from '@/components/layout/app-shell';
import { NotificationBell } from '@/components/layout/notification-bell';
import { SessionProvider, signOut, useSession } from '@/lib/session';

/**
 * Подпись под именем в карточке пользователя.
 *
 * Показываем уровень доступа, а не e-mail: адрес — персональные данные,
 * постоянно висящие на общем экране, и он всё равно обрезается.
 * Значение выводится из выданных сервером разрешений, ничего не выдумывая.
 */
function roleLabel(permissions: readonly OrgPermission[]): string {
  if (permissions.includes('org.manage')) {
    return 'Администратор организации';
  }
  if (permissions.includes('reports.review')) {
    return 'Проверяющий';
  }
  return 'Руководитель';
}

export default function ManagerLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ManagerWorkspace>{children}</ManagerWorkspace>
    </SessionProvider>
  );
}

function ManagerWorkspace({ children }: { children: ReactNode }) {
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
          title="Не удалось загрузить рабочее пространство"
          description="Проверьте подключение и обновите страницу."
          requestId={session.error?.problem.requestId}
          onRetry={() => window.location.reload()}
        />
      </ShellMessage>
    );
  }

  const organization = session.organization;

  if (!organization) {
    return (
      <ShellMessage>
        <ErrorState
          title="Нет доступа ни к одной организации"
          description="Ваше членство могло быть отозвано. Обратитесь к владельцу организации."
          action={null}
        />
      </ShellMessage>
    );
  }

  // Разделы показываются по фактическим разрешениям. Сервер всё равно
  // проверяет каждый запрос: это удобство, а не граница безопасности.
  // Разделы «Исследования» и «База знаний» пока не реализованы: пункт меню,
  // ведущий на несуществующую страницу, хуже отсутствующего пункта.
  const navigation: ShellNavGroup[] = [
    {
      label: 'Работа',
      items: [
        { href: '/app', label: 'Обзор', icon: LayoutDashboard, exact: true },
        { href: '/app/employees', label: 'Сотрудники', icon: Users },
        { href: '/app/assessments', label: 'Оценки', icon: ClipboardList },
        { href: '/app/reports', label: 'Заключения', icon: FileText },
      ],
    },
  ];
  if (organization.permissions.includes('reports.review')) {
    navigation.push({
      label: 'Проверка',
      items: [{ href: '/app/reviews', label: 'Проверка заключений', icon: FileCheck2 }],
    });
  }
  if (organization.permissions.includes('org.manage')) {
    navigation.push({
      label: 'Организация',
      items: [{ href: '/app/settings', label: 'Настройки', icon: Settings }],
    });
  }

  return (
    <>
      <AppShell
        topbarSlot={<NotificationBell organizationId={organization.organizationId} />}
        navLabel="Разделы кабинета"
        navigation={navigation}
        context={
          <div className="flex flex-col items-start gap-2 rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2.5 shadow-[var(--shadow-xs)]">
            <p className="eyebrow">Организация</p>
            <p
              className="w-full truncate text-sm font-semibold text-[var(--text-primary)]"
              title={organization.organizationName}
            >
              {organization.organizationName}
            </p>
            {organization.organizationMode === 'demo' ? <DemoBadge /> : null}
          </div>
        }
        user={{
          name: session.profile?.displayName ?? '',
          subtitle: roleLabel(organization.permissions),
          seed: session.profile?.userId,
        }}
        userMenuItems={[
          {
            label: 'Профиль и сессии',
            href: '/app/profile',
            icon: <UserRound strokeWidth={1.75} />,
          },
          {
            label: 'Выйти',
            icon: <LogOut strokeWidth={1.75} />,
            onSelect: () => void signOut(),
            separatorBefore: true,
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
