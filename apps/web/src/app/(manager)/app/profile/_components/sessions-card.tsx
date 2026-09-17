'use client';

import { useRef, useState } from 'react';
import { LogOut, MonitorX, ShieldX } from 'lucide-react';

import type { Envelope, GenericAcknowledgement, SessionSummary } from '@context/contracts';

import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/menu';
import { DataTable, type Column } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { signOut } from '@/lib/session';

type SessionRow = SessionSummary & { id: string };

const SESSIONS_KEY = ['auth-sessions'] as const;

export function SessionsCard() {
  const sessionsQuery = useApiQuery<Envelope<SessionSummary[]>>(SESSIONS_KEY, '/auth/sessions');
  const policyQuery = useApiQuery<Envelope<{ idleMinutes: number; absoluteMinutes: number }>>(
    ['auth-session-policy'],
    '/auth/session-policy',
    { staleTime: 30 * 60_000 },
  );

  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);
  const revokeOthersTriggerRef = useRef<HTMLButtonElement>(null);

  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());

  const revokeOthers = useApiMutation<void, Envelope<GenericAcknowledgement>>(
    () => api.post<Envelope<GenericAcknowledgement>>('/auth/sessions/revoke-others'),
    {
      invalidate: [SESSIONS_KEY],
      onSuccess: (response) => {
        notify.success(response.data.message);
        setRevokeOthersOpen(false);
      },
      onError: (error) => {
        if (error) {
          notify.error(error.problem.title, { requestId: error.problem.requestId });
        }
      },
    },
  );

  const revokeOne = useApiMutation<string, Envelope<GenericAcknowledgement>>(
    (sessionId) => api.delete<Envelope<GenericAcknowledgement>>(`/auth/sessions/${sessionId}`),
    {
      invalidate: [SESSIONS_KEY],
      onSuccess: (response) => {
        notify.success(response.data.message);
        setRevokeTarget(null);
      },
      onError: (error) => {
        if (error) {
          notify.error(error.problem.title, { requestId: error.problem.requestId });
        }
      },
    },
  );

  const columns: ReadonlyArray<Column<SessionRow>> = [
    {
      key: 'device',
      header: 'Устройство',
      render: (row) => (
        <span className="flex items-center gap-2">
          <span>{row.deviceHint ?? 'Устройство не определено'}</span>
          {row.current ? <Badge tone="accent">Текущая</Badge> : null}
        </span>
      ),
    },
    {
      key: 'lastSeen',
      header: 'Последняя активность',
      render: (row) => formatDateTime(row.lastSeenAt),
      nowrap: true,
    },
    {
      key: 'created',
      header: 'Вход выполнен',
      render: (row) => formatDateTime(row.createdAt),
      hideOnMobile: true,
      nowrap: true,
    },
    {
      key: 'actions',
      header: 'Действия',
      align: 'right',
      render: (row) => {
        if (row.current) {
          return null;
        }
        const items: ActionMenuItem[] = [
          {
            id: 'revoke',
            label: 'Завершить сессию',
            icon: <MonitorX aria-hidden="true" strokeWidth={1.75} />,
            destructive: true,
            onSelect: () => setRevokeTarget(row),
          },
        ];
        return (
          <ActionMenu
            label={`Действия с сессией: ${row.deviceHint ?? 'устройство не определено'}`}
            items={items}
            trigger={
              <IconButton
                ref={(node) => {
                  if (node) {
                    triggerRefs.current.set(row.id, node);
                  }
                }}
                label={`Действия с сессией: ${row.deviceHint ?? 'устройство не определено'}`}
                size="sm"
                icon={<MonitorX aria-hidden="true" strokeWidth={1.75} />}
              />
            }
          />
        );
      },
    },
  ];

  const rows: SessionRow[] = (sessionsQuery.data?.data ?? []).map((session) => ({
    ...session,
    id: session.id,
  }));

  const policy = policyQuery.data?.data;

  return (
    <Card>
      <CardHeader
        title="Активные сессии"
        description={
          policy
            ? `Сессия завершается автоматически после ${policy.idleMinutes} мин. бездействия или не позднее чем через ${Math.round(policy.absoluteMinutes / 60)} ч. Если вы входили с чужого устройства, завершите остальные сессии.`
            : 'Если вы входили с чужого устройства, завершите остальные сессии.'
        }
        action={
          rows.length > 1 ? (
            <Button
              ref={revokeOthersTriggerRef}
              variant="secondary"
              size="sm"
              icon={<ShieldX aria-hidden="true" strokeWidth={1.75} />}
              onClick={() => setRevokeOthersOpen(true)}
            >
              Завершить остальные
            </Button>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-5">
        {sessionsQuery.error ? (
          <ErrorState
            title="Не удалось загрузить сессии"
            requestId={sessionsQuery.error.problem.requestId}
            onRetry={sessionsQuery.refetch}
          />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            caption="Активные сессии учётной записи"
            loading={sessionsQuery.isLoading}
            emptyState={
              <EmptyState
                compact
                title="Сессии не найдены"
                description="Обновите страницу — возможно, сессия уже завершилась."
              />
            }
          />
        )}

        <div>
          <Button
            variant="ghost"
            icon={<LogOut aria-hidden="true" strokeWidth={1.75} />}
            onClick={() => void signOut()}
          >
            Выйти из этой сессии
          </Button>
        </div>
      </CardBody>

      <ConfirmDialog
        open={revokeOthersOpen}
        onOpenChange={setRevokeOthersOpen}
        title="Завершить остальные сессии?"
        description="Все устройства, кроме этого, будут разлогинены немедленно."
        confirmLabel="Завершить остальные"
        loading={revokeOthers.isPending}
        onConfirm={() => revokeOthers.mutate()}
        returnFocusRef={revokeOthersTriggerRef}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRevokeTarget(null);
            revokeOne.reset();
          }
        }}
        title="Завершить эту сессию?"
        description={
          revokeTarget
            ? `Устройство «${revokeTarget.deviceHint ?? 'не определено'}» будет разлогинено немедленно.`
            : ''
        }
        confirmLabel="Завершить сессию"
        destructive
        loading={revokeOne.isPending}
        onConfirm={() => {
          if (revokeTarget) {
            revokeOne.mutate(revokeTarget.id);
          }
        }}
        returnFocusRef={
          revokeTarget ? { current: triggerRefs.current.get(revokeTarget.id) ?? null } : undefined
        }
      />
    </Card>
  );
}
