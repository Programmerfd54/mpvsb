'use client';

import { Ban, Building2, Play, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { AdminOrganization, Envelope } from '@context/contracts';
import { APPLICABILITY_MODES } from '@context/domain';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, SearchInput, Select, TextArea } from '@/components/ui/field';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/menu';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';

import { ORG_MODE_LABELS } from '../_lib/labels';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'active' | 'suspended';
type ModeFilter = 'all' | (typeof APPLICABILITY_MODES)[number];

export default function AdminOrganizationsPage() {
  const orgsQuery = useApiQuery<Envelope<AdminOrganization[]>>(
    ['admin', 'organizations'],
    '/admin/organizations',
  );
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [page, setPage] = useState(1);
  const [suspendTarget, setSuspendTarget] = useState<AdminOrganization | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  useEffect(() => setPage(1), [search, statusFilter, modeFilter]);

  const resumeMutation = useApiMutation<string, Envelope<AdminOrganization>>(
    (orgId) => api.post(`/admin/organizations/${orgId}/resume`),
    {
      invalidate: [['admin', 'organizations']],
      onSuccess: () => notify.success('Организация возобновлена'),
      onError: (error) =>
        error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
    },
  );
  const suspendMutation = useApiMutation<
    { orgId: string; reason: string },
    Envelope<AdminOrganization>
  >(({ orgId, reason }) => api.post(`/admin/organizations/${orgId}/suspend`, { reason }), {
    invalidate: [['admin', 'organizations']],
    onSuccess: () => {
      notify.success('Организация приостановлена');
      setSuspendTarget(null);
      setSuspendReason('');
    },
    onError: (error) =>
      error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
  });

  const rows = orgsQuery.data?.data ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('ru-RU');
    return rows.filter(
      (row) =>
        (statusFilter === 'all' || row.status === statusFilter) &&
        (modeFilter === 'all' || row.mode === modeFilter) &&
        (term === '' ||
          row.name.toLocaleLowerCase('ru-RU').includes(term) ||
          row.code.toLocaleLowerCase('ru-RU').includes(term)),
    );
  }, [rows, search, statusFilter, modeFilter]);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: ReadonlyArray<Column<AdminOrganization>> = [
    { key: 'name', header: 'Организация', render: (row) => row.name },
    {
      key: 'mode',
      header: 'Режим',
      render: (row) => (
        <Badge tone={row.mode === 'validated_use' ? 'success' : 'info'}>
          {ORG_MODE_LABELS[row.mode] ?? row.mode}
        </Badge>
      ),
    },
    {
      key: 'employees',
      header: 'Сотрудников',
      align: 'right',
      hideOnMobile: true,
      render: (row) => <span className="tabular-nums">{row.counts.employees}</span>,
    },
    {
      key: 'status',
      header: 'Состояние',
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'success' : 'danger'}>
          {row.status === 'active' ? 'Активна' : 'Приостановлена'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Действия',
      align: 'right',
      className: 'w-14',
      render: (row) => {
        const items: ActionMenuItem[] = [
          {
            id: 'open',
            label: 'Открыть',
            icon: <Building2 aria-hidden="true" />,
            href: `/admin/organizations/${row.id}`,
          },
          row.status === 'active'
            ? {
                id: 'suspend',
                label: 'Приостановить',
                icon: <Ban aria-hidden="true" />,
                destructive: true,
                separatorBefore: true,
                onSelect: () => setSuspendTarget(row),
              }
            : {
                id: 'resume',
                label: 'Возобновить',
                icon: <Play aria-hidden="true" />,
                separatorBefore: true,
                onSelect: () => resumeMutation.mutate(row.id),
              },
        ];
        return <ActionMenu label={`Действия с организацией «${row.name}»`} items={items} />;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Организации"
        description="Организация создаётся при развёртывании. Здесь доступны только техническое состояние и обслуживание."
      />

      {orgsQuery.error ? (
        <ErrorState
          title="Не удалось загрузить список организаций"
          description="Проверьте подключение и повторите попытку."
          requestId={orgsQuery.error.problem.requestId}
          onRetry={orgsQuery.refetch}
        />
      ) : orgsQuery.isLoading ? (
        <PageSkeleton variant="list" label="Загружаем организации" />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              label="Поиск по названию или коду организации"
              placeholder="Название или код"
              className="sm:max-w-xs"
            />
            <Select
              aria-label="Фильтр по состоянию"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              wrapperClassName="sm:w-52"
            >
              <option value="all">Любое состояние</option>
              <option value="active">Активные</option>
              <option value="suspended">Приостановленные</option>
            </Select>
            <Select
              aria-label="Фильтр по режиму"
              value={modeFilter}
              onChange={(event) => setModeFilter(event.target.value as ModeFilter)}
              wrapperClassName="sm:w-56"
            >
              <option value="all">Любой режим</option>
              {APPLICABILITY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {ORG_MODE_LABELS[mode] ?? mode}
                </option>
              ))}
            </Select>
          </div>

          <DataTable
            rows={pageRows}
            columns={columns}
            caption="Организации платформы"
            rowHref={(row) => `/admin/organizations/${row.id}`}
            emptyState={
              rows.length === 0 ? (
                <EmptyState
                  icon={<Building2 aria-hidden="true" />}
                  title="Пространство ещё не подготовлено"
                  description="Запустите серверную bootstrap-процедуру и затем обновите страницу."
                />
              ) : (
                <EmptyState
                  icon={<Search aria-hidden="true" />}
                  title="Ничего не найдено"
                  description="Измените поиск или сбросьте фильтры."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch('');
                        setStatusFilter('all');
                        setModeFilter('all');
                      }}
                    >
                      Сбросить фильтры
                    </Button>
                  }
                />
              )
            }
          />
          {filtered.length > 0 ? (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={filtered.length}
              onChange={setPage}
            />
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={suspendTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSuspendTarget(null);
            setSuspendReason('');
          }
        }}
        title={suspendTarget ? `Приостановить «${suspendTarget.name}»?` : 'Приостановить?'}
        description="Приостановка не удаляет данные и не отменяет созданные оценки."
        confirmLabel="Приостановить"
        destructive
        loading={suspendMutation.isPending}
        onConfirm={() =>
          suspendTarget &&
          suspendMutation.mutate({ orgId: suspendTarget.id, reason: suspendReason })
        }
      >
        <Field label="Причина" required error={suspendMutation.error?.fieldError('reason')}>
          {({ inputId }) => (
            <TextArea
              id={inputId}
              value={suspendReason}
              onChange={(event) => setSuspendReason(event.target.value)}
              maxLength={1000}
              rows={3}
              required
            />
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}
