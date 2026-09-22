'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';

import type { Envelope, NotificationCounter } from '@context/contracts';

import { useApiQuery } from '@/lib/query';

export function NotificationBell({ organizationId }: { organizationId: string }) {
  const counter = useApiQuery<Envelope<NotificationCounter>>(
    ['notifications', organizationId, 'unread-count'],
    `/orgs/${organizationId}/notifications/unread-count`,
    { staleTime: 0, refetchInterval: 60_000 },
  );
  const unread = counter.data?.data.unread ?? 0;

  return (
    <Link
      href="/app/notifications"
      aria-label={unread > 0 ? `Уведомления: ${unread} непрочитанных` : 'Уведомления'}
      title="Уведомления"
      className="relative inline-flex size-11 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--text-primary)] no-underline hover:bg-[var(--bg-hover)]"
    >
      <Bell aria-hidden="true" className="size-5" />
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-bold text-white"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
