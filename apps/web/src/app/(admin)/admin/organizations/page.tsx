'use client';

import { Ban, Building2, Copy, Play, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type {
  AdminOrganization,
  CreateOrganizationInput,
  Envelope,
  IssuedLink,
} from '@context/contracts';
import { APPLICABILITY_MODES } from '@context/domain';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Sheet } from '@/components/ui/dialog';
import { Field, SearchInput, Select, TextArea, TextInput } from '@/components/ui/field';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/menu';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
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

  const [creatorOpen, setCreatorOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [suspendTarget, setSuspendTarget] = useState<AdminOrganization | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  // Ссылка ?create=1 из обзора («Создать организацию») открывает панель сразу.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (new URLSearchParams(window.location.search).get('create') === '1') {
      setCreatorOpen(true);
    }
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, modeFilter]);

  const resumeMutation = useApiMutation<string, Envelope<AdminOrganization>>(
    (orgId) => api.post<Envelope<AdminOrganization>>(`/admin/organizations/${orgId}/resume`),
    {
      invalidate: [['admin', 'organizations']],
      onSuccess: () => notify.success('Организация возобновлена'),
      onError: (error) => {
        if (error) {
          notify.error(error.problem.title, { requestId: error.problem.requestId });
        }
      },
    },
  );

  const suspendMutation = useApiMutation<
    { orgId: string; reason: string },
    Envelope<AdminOrganization>
  >(
    ({ orgId, reason }) =>
      api.post<Envelope<AdminOrganization>>(`/admin/organizations/${orgId}/suspend`, { reason }),
    {
      invalidate: [['admin', 'organizations']],
      onSuccess: () => {
        notify.success('Организация приостановлена');
        setSuspendTarget(null);
        setSuspendReason('');
      },
      onError: (error) => {
        if (error) {
          notify.error(error.problem.title, { requestId: error.problem.requestId });
        }
      },
    },
  );

  const rows = orgsQuery.data?.data ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('ru-RU');
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false;
      }
      if (modeFilter !== 'all' && row.mode !== modeFilter) {
        return false;
      }
      if (term === '') {
        return true;
      }
      return (
        row.name.toLocaleLowerCase('ru-RU').includes(term) ||
        row.code.toLocaleLowerCase('ru-RU').includes(term)
      );
    });
  }, [rows, search, statusFilter, modeFilter]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtersActive = search.trim() !== '' || statusFilter !== 'all' || modeFilter !== 'all';

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
      key: 'active',
      header: 'Активных оценок',
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.counts.activeAssignments}</span>,
    },
    {
      key: 'readiness',
      header: 'Готовность',
      hideOnMobile: true,
      render: (row) => (
        <Badge tone={row.readinessVerified === row.readinessTotal ? 'success' : 'warning'}>
          {row.readinessVerified} из {row.readinessTotal}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Состояние',
      render: (row) =>
        row.status === 'active' ? (
          <Badge tone="success">Активна</Badge>
        ) : (
          <Badge tone="danger">Приостановлена</Badge>
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
        description="Создание tenant не включает право реального пилота: новая организация начинает в демонстрационном режиме."
        action={
          <Button
            ref={createTriggerRef}
            variant="primary"
            icon={<Building2 aria-hidden="true" />}
            onClick={() => setCreatorOpen(true)}
          >
            Создать организацию
          </Button>
        }
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
                  icon={<Building2 aria-hidden="true" strokeWidth={1.75} />}
                  title="Пока нет ни одной организации"
                  description="Создайте первую организацию, чтобы начать работу с платформой."
                  action={
                    <Button variant="primary" onClick={() => setCreatorOpen(true)}>
                      Создать организацию
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Search aria-hidden="true" strokeWidth={1.75} />}
                  title="Ничего не найдено"
                  description="Измените поиск или сбросьте фильтры состояния и режима."
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

          {filtersActive && filtered.length > 0 ? (
            <p className="mt-1 text-xs text-[var(--text-secondary)]" aria-live="polite">
              Отфильтровано {filtered.length} из {rows.length}
            </p>
          ) : null}
        </>
      )}

      <OrganizationCreator
        open={creatorOpen}
        onOpenChange={(next) => {
          setCreatorOpen(next);
          if (!next && typeof window !== 'undefined') {
            const url = new URL(window.location.href);
            if (url.searchParams.has('create')) {
              url.searchParams.delete('create');
              window.history.replaceState(null, '', url.toString());
            }
          }
        }}
        returnFocusRef={createTriggerRef}
      />

      <ConfirmDialog
        open={suspendTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setSuspendTarget(null);
            setSuspendReason('');
          }
        }}
        title={
          suspendTarget ? `Приостановить «${suspendTarget.name}»?` : 'Приостановить организацию?'
        }
        description="Приостановка не удаляет данные и не отменяет уже созданные оценки."
        consequences={[
          'Создание новых назначений станет невозможно.',
          'Опубликованные заключения останутся доступны на чтение.',
          'Возобновить работу можно в любой момент.',
        ]}
        confirmLabel="Приостановить"
        destructive
        loading={suspendMutation.isPending}
        onConfirm={() => {
          if (suspendTarget) {
            suspendMutation.mutate({ orgId: suspendTarget.id, reason: suspendReason });
          }
        }}
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

/**
 * Создание организации вместе с владельцем.
 *
 * Ссылка активации владельца показывается один раз: её передаёт администратор,
 * система писем не отправляет.
 */
function OrganizationCreator({
  open,
  onOpenChange,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [timezone, setTimezone] = useState('Europe/Moscow');
  const [activeEmployeeLimit, setActiveEmployeeLimit] = useState('500');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');

  const createMutation = useApiMutation<
    CreateOrganizationInput,
    Envelope<{ organization: AdminOrganization; ownerActivation: IssuedLink | null }>
  >(
    (input) =>
      api.post<Envelope<{ organization: AdminOrganization; ownerActivation: IssuedLink | null }>>(
        '/admin/organizations',
        input,
      ),
    {
      invalidate: [['admin', 'organizations']],
      onSuccess: (result) => {
        notify.success('Организация создана');
        if (!result.data.ownerActivation) {
          onOpenChange(false);
        }
      },
    },
  );

  function resetForm(): void {
    setName('');
    setCode('');
    setTimezone('Europe/Moscow');
    setActiveEmployeeLimit('500');
    setOwnerEmail('');
    setOwnerName('');
    createMutation.reset();
  }

  const activation = createMutation.data?.data.ownerActivation ?? null;
  const error = createMutation.error;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          resetForm();
        }
        onOpenChange(next);
      }}
      title="Новая организация"
      description="Укажите название, код и владельца. Организация создаётся в демонстрационном режиме."
      returnFocusRef={returnFocusRef}
    >
      {activation ? (
        <Card>
          <CardHeader
            title="Ссылка активации владельца"
            description="Показывается один раз. Передайте её владельцу принятым у вас способом."
          />
          <CardBody className="flex flex-col gap-3">
            <code className="overflow-x-auto rounded-[var(--radius-control)] bg-[var(--bg-inset)] p-2 text-xs">
              {activation.url}
            </code>
            <Button
              variant="secondary"
              icon={<Copy aria-hidden="true" />}
              onClick={() => {
                void navigator.clipboard.writeText(activation.url);
                notify.success('Ссылка скопирована');
              }}
            >
              Скопировать
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                resetForm();
                onOpenChange(false);
              }}
            >
              Готово
            </Button>
          </CardBody>
        </Card>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const limit = Number.parseInt(activeEmployeeLimit, 10);
            createMutation.mutate({
              name,
              code,
              timezone,
              activeEmployeeLimit: Number.isFinite(limit) ? limit : 500,
              ownerEmail,
              ownerName,
            });
          }}
          noValidate
          className="flex flex-col gap-5"
        >
          {error && error.problem.fieldErrors.length === 0 ? (
            <ErrorState title={error.problem.title} requestId={error.problem.requestId} />
          ) : null}

          <Field label="Название" required error={error?.fieldError('name')}>
            {({ inputId }) => (
              <TextInput
                id={inputId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
              />
            )}
          </Field>

          <Field
            label="Код"
            hint="Латиница в нижнем регистре, цифры и подчёркивание. Используется в журналах вместо названия."
            required
            error={error?.fieldError('code')}
          >
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={63}
                required
              />
            )}
          </Field>

          <Field
            label="Часовой пояс"
            hint="Название IANA, например Europe/Moscow. Влияет на отображение дат участникам."
            error={error?.fieldError('timezone')}
          >
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                maxLength={64}
              />
            )}
          </Field>

          <Field
            label="Лимит активных сотрудников"
            hint="От 1 до 5000. Изменить можно позже в настройках организации."
            error={error?.fieldError('activeEmployeeLimit')}
          >
            {({ inputId }) => (
              <TextInput
                id={inputId}
                type="number"
                inputMode="numeric"
                min={1}
                max={5000}
                value={activeEmployeeLimit}
                onChange={(e) => setActiveEmployeeLimit(e.target.value)}
              />
            )}
          </Field>

          <Field label="Имя владельца" required error={error?.fieldError('ownerName')}>
            {({ inputId }) => (
              <TextInput
                id={inputId}
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                maxLength={200}
                required
              />
            )}
          </Field>

          <Field
            label="Электронная почта владельца"
            hint="Ему будет выпущена одноразовая ссылка активации."
            required
            error={error?.fieldError('ownerEmail')}
          >
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                required
              />
            )}
          </Field>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" loading={createMutation.isPending}>
              Создать
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
