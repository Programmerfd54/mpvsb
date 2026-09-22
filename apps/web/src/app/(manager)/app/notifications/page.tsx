'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  NOTIFICATION_FILTER_LABELS,
  type Envelope,
  type ListEnvelope,
  type NotificationFilter,
  type NotificationReadAllResult,
  type NotificationTarget,
  type NotificationView,
} from '@context/contracts';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Callout, EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useSession } from '@/lib/session';

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const router = useRouter();
  const session = useSession();
  const organizationId = session.organization?.organizationId;
  const [filter, setFilter] = useState<NotificationFilter>('unread');
  const [page, setPage] = useState(1);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openMessage, setOpenMessage] = useState<string | null>(null);

  const list = useApiQuery<ListEnvelope<NotificationView>>(
    ['notifications', organizationId, filter, page],
    organizationId
      ? `/orgs/${organizationId}/notifications?filter=${filter}&page=${page}&pageSize=${PAGE_SIZE}`
      : null,
    { staleTime: 0 },
  );
  const invalidate = [['notifications', organizationId]];

  const readAll = useApiMutation<void, Envelope<NotificationReadAllResult>>(
    () => api.post(`/orgs/${organizationId}/notifications/read-all`),
    { invalidate },
  );
  const open = useApiMutation<string, Envelope<NotificationTarget>>(
    (id) => api.post(`/orgs/${organizationId}/notifications/${id}/open`),
    {
      invalidate,
      onSuccess: (result) => {
        setOpeningId(null);
        if (result.data.status === 'available' && result.data.path?.startsWith('/app/')) {
          const path = result.data.path;
          router.push(
            result.data.type === 'access_grant_requested' && path === '/app/settings'
              ? '/app/settings?tab=access'
              : result.data.type === 'revision_requested' && path.startsWith('/app/reviews/')
                ? `${path}?tab=corrections`
                : path,
          );
        } else {
          setOpenMessage(result.data.message);
        }
      },
      onError: () => setOpeningId(null),
    },
  );

  return (
    <>
      <PageHeader
        title="Уведомления"
        description="События вашей организации. Доступ к материалу проверяется при открытии."
      />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div role="group" aria-label="Фильтр уведомлений" className="flex gap-2">
          {(['unread', 'all'] as const).map((value) => (
            <Button
              key={value}
              variant={filter === value ? 'soft' : 'secondary'}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setPage(1);
                setOpenMessage(null);
              }}
            >
              {NOTIFICATION_FILTER_LABELS[value]}
            </Button>
          ))}
        </div>
        <Button variant="secondary" loading={readAll.isPending} onClick={() => readAll.mutate()}>
          Отметить все прочитанными
        </Button>
      </div>

      {openMessage ? (
        <div className="mb-4">
          <Callout tone="warning" role="status">
            {openMessage}
          </Callout>
        </div>
      ) : null}
      {readAll.error || open.error ? (
        <div className="mb-4">
          <Callout tone="danger" role="alert" title="Не удалось выполнить действие">
            {readAll.error?.problem.title ?? open.error?.problem.title}
          </Callout>
        </div>
      ) : null}

      {list.error ? (
        <ErrorState
          title={list.error.problem.title}
          requestId={list.error.problem.requestId}
          onRetry={list.refetch}
        />
      ) : !list.data ? (
        <LoadingBlock label="Загружаем уведомления" />
      ) : list.data.data.length === 0 ? (
        <EmptyState
          compact
          title={filter === 'unread' ? 'Непрочитанных уведомлений нет' : 'Уведомлений пока нет'}
          description="Новые события появятся здесь."
        />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {list.data.data.map((notification) => (
              <li key={notification.id}>
                <Card>
                  <CardBody className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text-secondary)]">
                        {notification.typeLabel} · {formatDateTime(notification.createdAt)}
                      </p>
                      <p className="mt-1 font-semibold">{notification.title}</p>
                      <p className="mt-1 text-sm text-[var(--text-secondary)]">
                        {notification.readAt ? 'Прочитано' : 'Новое'}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      loading={openingId === notification.id && open.isPending}
                      disabled={open.isPending && openingId !== notification.id}
                      onClick={() => {
                        setOpenMessage(null);
                        setOpeningId(notification.id);
                        open.mutate(notification.id);
                      }}
                    >
                      Открыть
                    </Button>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-center justify-between gap-3 text-sm">
            <Button
              size="sm"
              variant="secondary"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Назад
            </Button>
            <span>
              Страница {page} · всего {list.data.meta.total}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={page * PAGE_SIZE >= list.data.meta.total}
              onClick={() => setPage(page + 1)}
            >
              Далее
            </Button>
          </div>
        </>
      )}
    </>
  );
}
