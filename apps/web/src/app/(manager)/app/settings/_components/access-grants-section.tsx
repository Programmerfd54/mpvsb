'use client';

import { useRef, useState } from 'react';
import { Check, ShieldAlert, X } from 'lucide-react';

import {
  ACCESS_GRANT_DEFAULT_HOURS,
  ACCESS_GRANT_MAX_HOURS,
  ACCESS_GRANT_PURPOSE_LABELS,
  ACCESS_GRANT_STATE_LABELS,
  type AccessGrant,
  type ApproveAccessGrantInput,
  type Envelope,
  type ListEnvelope,
  type RejectAccessGrantInput,
  type RevokeAccessGrantInput,
} from '@context/contracts';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select, TextArea } from '@/components/ui/field';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/menu';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatCount, formatDateTime } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';

type GrantRow = AccessGrant & { id: string };

const STATE_TONE: Record<AccessGrant['state'], BadgeTone> = {
  requested: 'warning',
  approved: 'success',
  rejected: 'neutral',
  revoked: 'neutral',
  expired: 'neutral',
};

const HOUR_OPTIONS = [1, 2, 4, 8, 12, 24];

const PAGE_SIZE = 20;

/**
 * Обращения администратора платформы за временным доступом к заключениям (ТЗ 10.4, A03).
 *
 * Администратор сам решение не принимает: каждое чтение возможно только в
 * объёме и на срок, который выдал владелец организации, и записывается в журнал.
 */
export function AccessGrantsSection({ organizationId }: { organizationId: string }) {
  const [page, setPage] = useState(1);

  const grantsQuery = useApiQuery<ListEnvelope<AccessGrant>>(
    ['org-access-grants', organizationId, page],
    `/orgs/${organizationId}/access-grants?page=${page}&pageSize=${PAGE_SIZE}`,
    { keepPreviousData: true },
  );

  const [approveTarget, setApproveTarget] = useState<GrantRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<GrantRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<GrantRow | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());

  const invalidateList = [['org-access-grants', organizationId]] as const;

  const approve = useApiMutation<
    { grantId: string; input: ApproveAccessGrantInput },
    Envelope<AccessGrant>
  >(
    ({ grantId, input }) =>
      api.post<Envelope<AccessGrant>>(
        `/orgs/${organizationId}/access-grants/${grantId}/approve`,
        input,
      ),
    {
      invalidate: [...invalidateList],
      onSuccess: () => {
        notify.success('Доступ выдан');
        setApproveTarget(null);
      },
    },
  );

  const reject = useApiMutation<
    { grantId: string; input: RejectAccessGrantInput },
    Envelope<AccessGrant>
  >(
    ({ grantId, input }) =>
      api.post<Envelope<AccessGrant>>(
        `/orgs/${organizationId}/access-grants/${grantId}/reject`,
        input,
      ),
    {
      invalidate: [...invalidateList],
      onSuccess: () => {
        notify.success('Обращение отклонено');
        setRejectTarget(null);
      },
    },
  );

  const revoke = useApiMutation<
    { grantId: string; input: RevokeAccessGrantInput },
    Envelope<AccessGrant>
  >(
    ({ grantId, input }) =>
      api.post<Envelope<AccessGrant>>(
        `/orgs/${organizationId}/access-grants/${grantId}/revoke`,
        input,
      ),
    {
      invalidate: [...invalidateList],
      onSuccess: () => {
        notify.success('Доступ отозван');
        setRevokeTarget(null);
      },
    },
  );

  const columns: ReadonlyArray<Column<GrantRow>> = [
    {
      key: 'requester',
      header: 'Запросил',
      render: (row) => (
        <span className="font-semibold text-[var(--text-primary)]">
          {row.requestedBy.displayName}
        </span>
      ),
    },
    {
      key: 'purpose',
      header: 'Цель',
      render: (row) => ACCESS_GRANT_PURPOSE_LABELS[row.purpose],
    },
    {
      key: 'reason',
      header: 'Причина',
      render: (row) => (
        <span className="block max-w-[280px] truncate" title={row.reason}>
          {row.reason}
        </span>
      ),
    },
    {
      key: 'scope',
      header: 'Объём',
      render: (row) =>
        formatCount(row.scope.assignmentIds.length, 'назначение', 'назначения', 'назначений'),
      hideOnMobile: true,
      nowrap: true,
    },
    {
      key: 'state',
      header: 'Статус',
      render: (row) => (
        <Badge tone={STATE_TONE[row.state]}>{ACCESS_GRANT_STATE_LABELS[row.state]}</Badge>
      ),
    },
    {
      key: 'expires',
      header: 'Срок',
      render: (row) =>
        row.state === 'requested'
          ? `Просит ${row.requestedHours ?? ACCESS_GRANT_DEFAULT_HOURS} ч.`
          : row.expiresAt
            ? formatDateTime(row.expiresAt)
            : '—',
      nowrap: true,
    },
    {
      key: 'requestedAt',
      header: 'Запрошено',
      render: (row) => formatDateTime(row.requestedAt),
      hideOnMobile: true,
      nowrap: true,
    },
    {
      key: 'actions',
      header: 'Действия',
      align: 'right',
      render: (row) => {
        const items: ActionMenuItem[] = [];
        if (row.state === 'requested') {
          items.push(
            {
              id: 'approve',
              label: 'Разрешить',
              icon: <Check aria-hidden="true" strokeWidth={1.75} />,
              onSelect: () => setApproveTarget(row),
            },
            {
              id: 'reject',
              label: 'Отклонить',
              icon: <X aria-hidden="true" strokeWidth={1.75} />,
              destructive: true,
              onSelect: () => setRejectTarget(row),
            },
          );
        } else if (row.state === 'approved' && row.active) {
          items.push({
            id: 'revoke',
            label: 'Отозвать доступ',
            icon: <ShieldAlert aria-hidden="true" strokeWidth={1.75} />,
            destructive: true,
            onSelect: () => setRevokeTarget(row),
          });
        } else {
          return null;
        }
        return (
          <ActionMenu
            label={`Решение по обращению от ${row.requestedBy.displayName}`}
            items={items}
            trigger={
              <IconButton
                ref={(node) => {
                  if (node) {
                    triggerRefs.current.set(row.id, node);
                  }
                }}
                label={`Решение по обращению от ${row.requestedBy.displayName}`}
                size="sm"
                icon={<ShieldAlert aria-hidden="true" strokeWidth={1.75} />}
              />
            }
          />
        );
      },
    },
  ];

  const rows: GrantRow[] = (grantsQuery.data?.data ?? []).map((grant) => ({
    ...grant,
    id: grant.id,
  }));

  return (
    <Card>
      <CardHeader
        title="Запросы временного доступа"
        description="Администратор платформы не видит заключения без вашего разрешения: доступ выдаётся на конкретные назначения и ограниченный срок, каждое чтение записывается в журнал."
      />
      <CardBody>
        {grantsQuery.error ? (
          <ErrorState
            title="Не удалось загрузить обращения"
            description="Обновите страницу и повторите попытку."
            requestId={grantsQuery.error.problem.requestId}
            onRetry={grantsQuery.refetch}
          />
        ) : (
          <>
            <DataTable
              rows={rows}
              columns={columns}
              caption="Обращения за временным доступом"
              loading={grantsQuery.isLoading}
              emptyState={
                <EmptyState
                  compact
                  title="Обращений пока нет"
                  description="Здесь появятся запросы администратора платформы на временный доступ к заключениям — с целью, причиной и сроком, который вы выдаёте сами."
                />
              }
            />
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={grantsQuery.data?.meta.total ?? 0}
              onChange={setPage}
            />
          </>
        )}
      </CardBody>

      <ApproveDialog
        grant={approveTarget}
        pending={approve.isPending}
        error={approve.error}
        onOpenChange={(next) => {
          if (!next) {
            setApproveTarget(null);
            approve.reset();
          }
        }}
        onConfirm={(input) => {
          if (approveTarget) {
            approve.mutate({ grantId: approveTarget.id, input });
          }
        }}
        returnFocusRef={
          approveTarget ? { current: triggerRefs.current.get(approveTarget.id) ?? null } : undefined
        }
      />

      <RejectDialog
        grant={rejectTarget}
        pending={reject.isPending}
        error={reject.error}
        onOpenChange={(next) => {
          if (!next) {
            setRejectTarget(null);
            reject.reset();
          }
        }}
        onConfirm={(input) => {
          if (rejectTarget) {
            reject.mutate({ grantId: rejectTarget.id, input });
          }
        }}
        returnFocusRef={
          rejectTarget ? { current: triggerRefs.current.get(rejectTarget.id) ?? null } : undefined
        }
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRevokeTarget(null);
            revoke.reset();
          }
        }}
        title="Отозвать выданный доступ?"
        description={
          revokeTarget
            ? `${revokeTarget.requestedBy.displayName} больше не сможет прочитать заключения из этого обращения.`
            : ''
        }
        consequences={['Действует немедленно: следующее чтение по обращению уже не пройдёт.']}
        confirmLabel="Отозвать доступ"
        destructive
        loading={revoke.isPending}
        onConfirm={() => {
          if (revokeTarget) {
            revoke.mutate({ grantId: revokeTarget.id, input: {} });
          }
        }}
        returnFocusRef={
          revokeTarget ? { current: triggerRefs.current.get(revokeTarget.id) ?? null } : undefined
        }
      >
        {revoke.error ? (
          <ErrorState
            title={revoke.error.problem.title}
            requestId={revoke.error.problem.requestId}
          />
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}

function ApproveDialog({
  grant,
  pending,
  error,
  onOpenChange,
  onConfirm,
  returnFocusRef,
}: {
  grant: GrantRow | null;
  pending: boolean;
  error: ReturnType<typeof useApiMutation>['error'];
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: ApproveAccessGrantInput) => void;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const requestedHours = grant?.requestedHours ?? null;
  const [useRequested, setUseRequested] = useState(requestedHours !== null);
  const [hours, setHours] = useState(requestedHours ?? ACCESS_GRANT_DEFAULT_HOURS);
  const [note, setNote] = useState('');

  // Значения по умолчанию пересчитываются при каждом открытии нового обращения.
  const key = grant?.id;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setUseRequested(requestedHours !== null);
    setHours(requestedHours ?? ACCESS_GRANT_DEFAULT_HOURS);
    setNote('');
  }

  const options = Array.from(
    new Set([...HOUR_OPTIONS, ...(requestedHours ? [requestedHours] : [])]),
  ).sort((a, b) => a - b);

  return (
    <ConfirmDialog
      open={grant !== null}
      onOpenChange={onOpenChange}
      title="Разрешить доступ?"
      description={
        grant
          ? `${grant.requestedBy.displayName} получит доступ к ${formatCount(grant.scope.assignmentIds.length, 'назначению', 'назначениям', 'назначениям')} с целью «${ACCESS_GRANT_PURPOSE_LABELS[grant.purpose]}».`
          : ''
      }
      confirmLabel="Разрешить"
      loading={pending}
      onConfirm={() =>
        onConfirm({
          hours: useRequested ? (requestedHours ?? hours) : hours,
          useRequestedHours: useRequested,
          ...(note.trim() ? { note: note.trim() } : {}),
        })
      }
      returnFocusRef={returnFocusRef}
    >
      <div className="flex flex-col gap-4">
        {requestedHours !== null ? (
          <Checkbox
            checked={useRequested}
            onChange={setUseRequested}
            label={`Выдать ровно тот срок, что запросили (${requestedHours} ч.)`}
          />
        ) : null}

        {!useRequested ? (
          <Field label="Срок доступа" hint={`Максимум ${ACCESS_GRANT_MAX_HOURS} часов.`}>
            {({ inputId, describedBy }) => (
              <Select
                id={inputId}
                aria-describedby={describedBy}
                value={hours}
                onChange={(event) => setHours(Number(event.target.value))}
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {formatCount(option, 'час', 'часа', 'часов')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        <Field label="Комментарий (необязательно)">
          {({ inputId, describedBy }) => (
            <TextArea
              id={inputId}
              aria-describedby={describedBy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="Виден в истории обращения"
            />
          )}
        </Field>

        {error ? (
          <p role="alert" className="text-sm text-[var(--danger-text)]">
            {error.problem.title}
          </p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

function RejectDialog({
  grant,
  pending,
  error,
  onOpenChange,
  onConfirm,
  returnFocusRef,
}: {
  grant: GrantRow | null;
  pending: boolean;
  error: ReturnType<typeof useApiMutation>['error'];
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: RejectAccessGrantInput) => void;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const key = grant?.id;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setNote('');
    setTouched(false);
  }

  const tooShort = note.trim().length > 0 && note.trim().length < 5;
  const invalid = touched && note.trim().length < 5;

  return (
    <ConfirmDialog
      open={grant !== null}
      onOpenChange={onOpenChange}
      title="Отклонить обращение?"
      description={
        grant
          ? `Объясните ${grant.requestedBy.displayName}, почему обращение отклонено — это обязательное поле.`
          : ''
      }
      confirmLabel="Отклонить"
      destructive
      loading={pending}
      onConfirm={() => {
        setTouched(true);
        if (note.trim().length < 5) {
          return;
        }
        onConfirm({ note: note.trim() });
      }}
      returnFocusRef={returnFocusRef}
    >
      <Field
        label="Причина отказа"
        required
        error={
          invalid ? (tooShort ? 'Не короче 5 символов.' : 'Укажите причину отказа.') : undefined
        }
      >
        {({ inputId, describedBy }) => (
          <TextArea
            id={inputId}
            aria-describedby={describedBy}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={1000}
            rows={3}
            required
            invalid={invalid}
            placeholder="Например: причина недостаточно конкретна"
          />
        )}
      </Field>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-[var(--danger-text)]">
          {error.problem.title}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}
