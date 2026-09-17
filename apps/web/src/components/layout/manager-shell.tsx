'use client';

import { Dot, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ActionMenuItem } from '@/components/ui/menu';
import { signOut } from '@/lib/session';

import { AppShell } from './app-shell';

export { PageHeader } from './page-header';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: LucideIcon;
}

/**
 * Совместимая обёртка кабинета руководителя над AppShell.
 *
 * @deprecated Используйте AppShell напрямую (см. (manager)/app/layout.tsx):
 * там задаются группы разделов, осмысленные иконки и пункты меню пользователя.
 * Обёртка оставлена только для страниц, ещё не переведённых на новую оболочку.
 */
export function ManagerShell({
  navigation,
  organizationName,
  userName,
  modeBadge,
  children,
}: {
  navigation: readonly NavItem[];
  organizationName: string;
  userName: string;
  modeBadge?: ReactNode;
  children: ReactNode;
}) {
  const userMenuItems: ActionMenuItem[] = [
    { label: 'Профиль и сессии', href: '/app/profile' },
    { label: 'Выйти', onSelect: () => void signOut(), separatorBefore: true },
  ];

  return (
    <AppShell
      navLabel="Разделы кабинета"
      navigation={[
        {
          items: navigation.map((item) => ({
            href: item.href,
            label: item.label,
            // Нейтральная точка вместо иконки «Обзор»: без явной иконки
            // раздел не должен выглядеть как дашборд.
            icon: item.icon ?? Dot,
            exact: item.href === '/app',
          })),
        },
      ]}
      context={
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm font-medium text-[var(--text-secondary)]">{organizationName}</p>
          {modeBadge}
        </div>
      }
      user={{ name: userName }}
      userMenuItems={userMenuItems}
    >
      {children}
    </AppShell>
  );
}
