'use client';

import { useRef, useState } from 'react';
import { KeyRound, RotateCw, UserPlus, UserX } from 'lucide-react';

import type {
  Envelope,
  GenericAcknowledgement,
  IssuedLink,
  MemberSummary,
} from '@context/contracts';
import { ORG_PERMISSION_LABELS } from '@context/domain';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Sheet } from '@/components/ui/dialog';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/menu';
import { DataTable, type Column } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Monogram } from '@/components/ui/avatar';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';

import { InviteSheet } from './invite-sheet';
import { IssuedLinkPanel } from './issued-link-panel';

type MemberRow = MemberSummary & { id: string };

const STATUS_TONE: Record<MemberSummary['status'], BadgeTone> = {
  invited: 'warning',
  active: 'success',
  revoked: 'neutral',
};

const STATUS_LABEL: Record<MemberSummary['status'], string> = {
  invited: 'Приглашён',
  active: 'Активен',
  revoked: 'Доступ отозван',
};

/**
 * Кто может работать в организации: приглашение, статус, права, отзыв.
 *
 * Права меняются только сервером; здесь их только назначают при приглашении
 * и отзывают целиком. Запрет удалить последнего владельца проверяет backend —
 * при отказе показываем причину прямо в диалоге, а не молча блокируем кнопку.
 */
export function MembersSection({ organizationId }: { organizationId: string }) {
  const membersQuery = useApiQuery<Envelope<MemberSummary[]>>(
    ['org-members', organizationId],
    `/orgs/${organizationId}/members`,
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const inviteTriggerRef = useRef<HTMLButtonElement>(null);

  const [revokeTarget, setRevokeTarget] = useState<MemberRow | null>(null);
  const revokeTriggerRefs = useRef(new Map<string, HTMLButtonElement>());

  const [reissueResult, setReissueResult] = useState<{
    member: MemberRow;
    link: IssuedLink;
  } | null>(null);

  const revoke = useApiMutation<string, Envelope<GenericAcknowledgement>>(
    (membershipId) =>
      api.delete<Envelope<GenericAcknowledgement>>(
        `/orgs/${organizationId}/members/${membershipId}`,
      ),
    {
      invalidate: [['org-members', organizationId]],
      onSuccess: (response) => {
        notify.success(response.data.message);
        setRevokeTarget(null);
      },
    },
  );

  const reissue = useApiMutation<MemberRow, Envelope<IssuedLink>>(
    (member) =>
      api.post<Envelope<IssuedLink>>(
        `/orgs/${organizationId}/members/${member.membershipId}/invitation`,
      ),
    {
      onSuccess: (response, member) => setReissueResult({ member, link: response.data }),
      onError: (error) => {
        if (error) {
          notify.error(error.problem.title, { requestId: error.problem.requestId });
        }
      },
    },
  );

  const columns: ReadonlyArray<Column<MemberRow>> = [
    {
      key: 'name',
      header: 'Сотрудник',
      render: (row) => (
        <span className="flex min-w-0 items-center gap-3">
          <Monogram name={row.displayName} seed={row.userId} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-[var(--text-primary)]">
              {row.displayName}
            </span>
            <span className="block truncate text-xs text-[var(--text-secondary)]">{row.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'permissions',
      header: 'Права',
      render: (row) => (
        <span className="flex flex-wrap gap-1.5">
          {row.permissions.length === 0 ? (
            <span className="text-[var(--text-secondary)]">—</span>
          ) : (
            row.permissions.map((permission) => (
              <Badge key={permission} tone="neutral">
                {ORG_PERMISSION_LABELS[permission]}
              </Badge>
            ))
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      render: (row) => <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>,
    },
    {
      key: 'invited',
      header: 'Приглашён',
      render: (row) => formatDateTime(row.invitedAt),
      hideOnMobile: true,
      nowrap: true,
    },
    {
      key: 'actions',
      header: 'Действия',
      align: 'right',
      render: (row) => {
        if (row.status === 'revoked') {
          return null;
        }
        const items: ActionMenuItem[] = [];
        if (row.status === 'invited') {
          items.push({
            id: 'reissue',
            label: 'Выпустить ссылку заново',
            icon: <RotateCw aria-hidden="true" strokeWidth={1.75} />,
            onSelect: () => reissue.mutate(row),
          });
        }
        items.push({
          id: 'revoke',
          label: 'Отозвать доступ',
          icon: <UserX aria-hidden="true" strokeWidth={1.75} />,
          destructive: true,
          separatorBefore: row.status === 'invited',
          onSelect: () => setRevokeTarget(row),
        });
        return (
          <ActionMenu
            label={`Действия с доступом ${row.displayName}`}
            items={items}
            trigger={
              <IconButton
                ref={(node) => {
                  if (node) {
                    revokeTriggerRefs.current.set(row.id, node);
                  }
                }}
                label={`Действия с доступом ${row.displayName}`}
                size="sm"
                icon={<KeyRound aria-hidden="true" strokeWidth={1.75} />}
              />
            }
          />
        );
      },
    },
  ];

  const rows: MemberRow[] = (membersQuery.data?.data ?? []).map((member) => ({
    ...member,
    id: member.membershipId,
  }));

  return (
    <Card>
      <CardHeader
        title="Доступы руководителей"
        description="Приглашение выдаёт доступ к отмеченным разделам. Роль владельца — право «Управление организацией и доступами»."
        action={
          <Button
            ref={inviteTriggerRef}
            variant="primary"
            icon={<UserPlus aria-hidden="true" strokeWidth={1.75} />}
            onClick={() => setInviteOpen(true)}
          >
            Пригласить
          </Button>
        }
      />
      <CardBody>
        {membersQuery.error ? (
          <ErrorState
            title="Не удалось загрузить список доступов"
            description="Обновите страницу и повторите попытку."
            requestId={membersQuery.error.problem.requestId}
            onRetry={membersQuery.refetch}
          />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            caption="Доступы руководителей организации"
            loading={membersQuery.isLoading}
            emptyState={
              <EmptyState
                compact
                title="В организации пока нет других руководителей"
                description="Пригласите коллегу — он получит ссылку активации на свой email."
                action={
                  <Button variant="primary" onClick={() => setInviteOpen(true)}>
                    Пригласить руководителя
                  </Button>
                }
              />
            }
          />
        )}
      </CardBody>

      <InviteSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        organizationId={organizationId}
        returnFocusRef={inviteTriggerRef}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRevokeTarget(null);
            revoke.reset();
          }
        }}
        title="Отозвать доступ?"
        description={
          revokeTarget
            ? `${revokeTarget.displayName} (${revokeTarget.email}) больше не сможет войти в организацию.`
            : ''
        }
        consequences={[
          'Текущие сессии этого пользователя в организации завершатся немедленно.',
          'Все права отзываются; повторный доступ потребует нового приглашения.',
        ]}
        confirmLabel="Отозвать доступ"
        destructive
        loading={revoke.isPending}
        onConfirm={() => {
          if (revokeTarget) {
            revoke.mutate(revokeTarget.membershipId);
          }
        }}
        returnFocusRef={
          revokeTarget
            ? { current: revokeTriggerRefs.current.get(revokeTarget.id) ?? null }
            : undefined
        }
      >
        {revoke.error ? (
          <ErrorState
            title={revoke.error.problem.title}
            description={
              revoke.error.status === 409
                ? 'В организации должен остаться хотя бы один владелец. Сначала назначьте право «Управление организацией и доступами» другому руководителю.'
                : undefined
            }
            requestId={revoke.error.problem.requestId}
          />
        ) : null}
      </ConfirmDialog>

      <Sheet
        open={reissueResult !== null}
        onOpenChange={(next) => {
          if (!next) {
            setReissueResult(null);
          }
        }}
        title="Ссылка активации выпущена"
        description={
          reissueResult
            ? `Прежняя ссылка для ${reissueResult.member.displayName} больше не действует.`
            : undefined
        }
      >
        {reissueResult ? <IssuedLinkPanel link={reissueResult.link} /> : null}
      </Sheet>
    </Card>
  );
}
