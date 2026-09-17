'use client';

import { Archive, Building2, ClipboardList, ExternalLink, Pencil, Plus, Users } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_OPTIONS,
  type BatchResult,
  type EmployeeSummary,
  type Envelope,
  type ListEnvelope,
} from '@context/contracts';

import { Monogram } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Select, SearchInput, TextInput } from '@/components/ui/field';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/menu';
import { FadeIn } from '@/components/ui/motion';
import { Badge } from '@/components/ui/badge';
import { Callout, EmptyState, ErrorState, ForbiddenState } from '@/components/ui/states';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useSession } from '@/lib/session';

import { EmployeeEditor } from './_components/employee-editor';

type StatusFilter = 'active' | 'archived' | 'all';

const BULK_LIMIT = 50;

function employeeLabel(row: Pick<EmployeeSummary, 'displayName' | 'externalCode'>): string {
  return row.displayName ?? row.externalCode ?? 'Без имени';
}

export default function EmployeesPage() {
  const session = useSession();
  const organizationId = session.organization?.organizationId;
  const canManage = session.has('employees.manage');

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [queryInput, setQueryInput] = useState(() => searchParams.get('query') ?? '');
  const [departmentInput, setDepartmentInput] = useState(
    () => searchParams.get('department') ?? '',
  );
  const [debouncedQuery, setDebouncedQuery] = useState(queryInput);
  const [debouncedDepartment, setDebouncedDepartment] = useState(departmentInput);
  const [status, setStatus] = useState<StatusFilter>(
    () => (searchParams.get('status') as StatusFilter | null) ?? 'active',
  );
  const [page, setPage] = useState(() => Number(searchParams.get('page')) || 1);
  const [pageSize, setPageSize] = useState(
    () => Number(searchParams.get('pageSize')) || PAGE_SIZE_DEFAULT,
  );

  // Поиск и фильтр по подразделению не уходят на сервер на каждое нажатие.
  const isFirstDebounce = useRef(true);
  useLayoutEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(queryInput.trim());
      setDebouncedDepartment(departmentInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [queryInput, departmentInput]);

  // Новый запрос — новая первая страница. Пропускаем самое первое срабатывание,
  // иначе открытая по ссылке страница 3 сбрасывалась бы на первую.
  useLayoutEffect(() => {
    if (isFirstDebounce.current) {
      isFirstDebounce.current = false;
      return;
    }
    setPage(1);
  }, [debouncedQuery, debouncedDepartment, status]);

  // Состояние фильтров отражается в URL: страницу можно сохранить в закладки
  // или переслать коллеге.
  useLayoutEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('query', debouncedQuery);
    if (debouncedDepartment) params.set('department', debouncedDepartment);
    if (status !== 'active') params.set('status', status);
    if (page !== 1) params.set('page', String(page));
    if (pageSize !== PAGE_SIZE_DEFAULT) params.set('pageSize', String(pageSize));
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    // Зависимость от `router` намеренно не добавлена: ссылка на объект router
    // из next/navigation не меняется между рендерами в рамках одной страницы.
  }, [debouncedQuery, debouncedDepartment, status, page, pageSize, pathname]);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    setSelected(new Set());
  }, [debouncedQuery, debouncedDepartment, status, page, pageSize]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeSummary | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<EmployeeSummary | null>(null);
  const [archiveCancelActive, setArchiveCancelActive] = useState(false);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [bulkCancelActive, setBulkCancelActive] = useState(false);
  const [bulkTargets, setBulkTargets] = useState<ReadonlyMap<string, string>>(new Map());
  const [bulkResult, setBulkResult] = useState<BatchResult | null>(null);
  // Куда вернуть фокус после закрытия панели редактора: элемент, который был
  // в фокусе непосредственно перед открытием (кнопка в шапке или пункт меню строки).
  const editorTriggerRef = useRef<HTMLElement | null>(null);

  const listPath = useMemo(() => {
    if (!organizationId || !canManage) {
      return null;
    }
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status });
    if (debouncedQuery) params.set('query', debouncedQuery);
    if (debouncedDepartment) params.set('department', debouncedDepartment);
    return `/orgs/${organizationId}/employees?${params.toString()}`;
  }, [organizationId, canManage, page, pageSize, status, debouncedQuery, debouncedDepartment]);

  const employeesQuery = useApiQuery<ListEnvelope<EmployeeSummary>>(
    ['employees', organizationId, page, pageSize, status, debouncedQuery, debouncedDepartment],
    listPath,
    { keepPreviousData: true },
  );

  const rows = employeesQuery.data?.data ?? [];
  const total = employeesQuery.data?.meta.total ?? 0;
  const filtersActive = Boolean(debouncedQuery || debouncedDepartment || status !== 'active');

  const archiveMutation = useApiMutation<
    { employeeId: string; cancelActiveAssignments: boolean },
    Envelope<{ archived: boolean; cancelledAssignments: number }>
  >(
    ({ employeeId, cancelActiveAssignments }) =>
      api.post(`/orgs/${organizationId}/employees/${employeeId}/archive`, {
        cancelActiveAssignments,
      }),
    {
      invalidate: [['employees', organizationId]],
      onSuccess: (result) => {
        notify.success(
          result.data.cancelledAssignments > 0
            ? `Сотрудник в архиве. Отменено оценок: ${result.data.cancelledAssignments}.`
            : 'Сотрудник переведён в архив',
        );
        setArchiveTarget(null);
        setArchiveCancelActive(false);
      },
      onError: (apiError) => {
        if (apiError) {
          notify.error(apiError.problem.title, { requestId: apiError.problem.requestId });
        }
      },
    },
  );

  const bulkArchiveMutation = useApiMutation<
    { employeeIds: string[]; cancelActiveAssignments: boolean },
    Envelope<BatchResult>
  >((payload) => api.post(`/orgs/${organizationId}/employees/bulk-archive`, payload), {
    invalidate: [['employees', organizationId]],
    onSuccess: (result) => {
      setBulkResult(result.data);
      setBulkArchiveOpen(false);
      setBulkCancelActive(false);
      setSelected(new Set());
      const failed = result.data.items.filter((item) => item.status === 'failed').length;
      if (result.data.outcome === 'all_succeeded') {
        notify.success(`Архивировано сотрудников: ${result.data.items.length}`);
      } else if (result.data.outcome === 'partial') {
        notify.error(`Часть операций не выполнена: ${failed} из ${result.data.items.length}.`);
      } else {
        notify.error('Не удалось архивировать выбранных сотрудников.');
      }
    },
    onError: (apiError) => {
      if (apiError) {
        notify.error(apiError.problem.title, { requestId: apiError.problem.requestId });
      }
    },
  });

  function toggleRow(id: string, checked: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleAllOnPage(checked: boolean): void {
    setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set());
  }

  function captureTrigger(): void {
    editorTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function openEdit(row: EmployeeSummary): void {
    captureTrigger();
    setEditingEmployee(row);
    setEditorOpen(true);
  }

  function openCreate(): void {
    captureTrigger();
    setEditingEmployee(null);
    setEditorOpen(true);
  }

  function openBulkArchive(): void {
    const map = new Map(
      rows.filter((row) => selected.has(row.id)).map((row) => [row.id, employeeLabel(row)]),
    );
    setBulkTargets(map);
    setBulkResult(null);
    setBulkArchiveOpen(true);
  }

  const columns: ReadonlyArray<Column<EmployeeSummary>> = [
    {
      key: 'name',
      header: 'Сотрудник',
      render: (row) => (
        <span className="flex min-w-0 items-center gap-3">
          <Monogram name={employeeLabel(row)} seed={row.id} size="sm" />
          <span className="min-w-0 truncate">{employeeLabel(row)}</span>
        </span>
      ),
    },
    {
      key: 'select',
      header: 'Выбор',
      className: 'w-12',
      render: (row) => (
        <Checkbox
          checked={selected.has(row.id)}
          onChange={(checked) => toggleRow(row.id, checked)}
          label={<span className="sr-only">Выбрать «{employeeLabel(row)}»</span>}
        />
      ),
    },
    { key: 'job', header: 'Должность', render: (row) => row.jobTitle ?? '—' },
    {
      key: 'dept',
      header: 'Подразделение',
      render: (row) => row.department ?? '—',
      hideOnMobile: true,
    },
    {
      key: 'assignments',
      header: 'Активные оценки',
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.activeAssignments}</span>,
    },
    {
      key: 'status',
      header: 'Состояние',
      render: (row) =>
        row.archivedAt ? (
          <Badge tone="neutral">В архиве</Badge>
        ) : (
          <Badge tone="success">Активен</Badge>
        ),
    },
    {
      key: 'updated',
      header: 'Обновлено',
      render: (row) => formatDateTime(row.updatedAt),
      hideOnMobile: true,
      /* Дата целиком в одной строке: иначе правый край таблицы рваный. */
      nowrap: true,
    },
    {
      key: 'actions',
      header: 'Действия',
      align: 'right',
      render: (row) => {
        const items: ActionMenuItem[] = [
          {
            id: 'open',
            label: 'Открыть',
            icon: <ExternalLink aria-hidden="true" />,
            href: `/app/employees/${row.id}`,
          },
        ];
        if (!row.archivedAt) {
          items.push({
            id: 'assign',
            label: 'Назначить оценку',
            icon: <ClipboardList aria-hidden="true" />,
            href: '/app/assessments/new',
          });
        }
        items.push({
          id: 'edit',
          label: 'Редактировать',
          icon: <Pencil aria-hidden="true" />,
          onSelect: () => openEdit(row),
        });
        if (!row.archivedAt) {
          items.push({
            id: 'archive',
            label: 'Архивировать',
            icon: <Archive aria-hidden="true" />,
            destructive: true,
            separatorBefore: true,
            onSelect: () => setArchiveTarget(row),
          });
        }
        return (
          <ActionMenu label={`Действия с сотрудником «${employeeLabel(row)}»`} items={items} />
        );
      },
    },
  ];

  if (session.status === 'authenticated' && !canManage) {
    return (
      <ForbiddenState description="Список сотрудников доступен по отдельному разрешению. Обратитесь к владельцу организации." />
    );
  }

  return (
    <>
      <PageHeader
        title="Сотрудники"
        description={`В организации ${total} ${total === 1 ? 'запись' : 'записей'}. Все данные синтетические.`}
        action={
          <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={openCreate}>
            Добавить сотрудника
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <SearchInput
          value={queryInput}
          onValueChange={setQueryInput}
          label="Поиск по имени или коду"
          placeholder="Например, А-002"
          className="min-w-[220px] flex-1"
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="employee-department"
            className="text-sm font-semibold text-[var(--text-primary)]"
          >
            Подразделение
          </label>
          <TextInput
            id="employee-department"
            value={departmentInput}
            onChange={(event) => setDepartmentInput(event.target.value)}
            placeholder="Например, Продажи"
            leadingIcon={<Building2 aria-hidden="true" />}
            className="w-48"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="employee-status"
            className="text-sm font-semibold text-[var(--text-primary)]"
          >
            Состояние
          </label>
          <Select
            id="employee-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            wrapperClassName="w-40"
          >
            <option value="active">Активные</option>
            <option value="archived">В архиве</option>
            <option value="all">Все</option>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="employee-page-size"
            className="text-sm font-semibold text-[var(--text-primary)]"
          >
            На странице
          </label>
          <Select
            id="employee-page-size"
            value={String(pageSize)}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
            wrapperClassName="w-24"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </div>

        {filtersActive ? (
          <Button
            variant="ghost"
            onClick={() => {
              setQueryInput('');
              setDepartmentInput('');
              setDebouncedQuery('');
              setDebouncedDepartment('');
              setStatus('active');
              setPage(1);
            }}
          >
            Сбросить
          </Button>
        ) : null}
      </div>

      {bulkResult && bulkResult.items.some((item) => item.status === 'failed') ? (
        <Callout
          tone={bulkResult.outcome === 'all_failed' ? 'danger' : 'warning'}
          title="Часть сотрудников не удалось архивировать"
          role="status"
          className="mb-5"
          action={
            <Button size="sm" variant="ghost" onClick={() => setBulkResult(null)}>
              Скрыть
            </Button>
          }
        >
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {bulkResult.items
              .filter((item) => item.status === 'failed')
              .map((item) => (
                <li key={item.id}>
                  {bulkTargets.get(item.id) ?? item.id}
                  {item.message ? `: ${item.message}` : ''}
                </li>
              ))}
          </ul>
        </Callout>
      ) : null}

      {employeesQuery.error ? (
        <ErrorState
          title="Не удалось загрузить список"
          description="Обновите страницу или измените условия поиска."
          requestId={employeesQuery.error.problem.requestId}
          onRetry={employeesQuery.refetch}
        />
      ) : (
        <>
          {rows.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <Checkbox
                checked={rows.length > 0 && rows.every((row) => selected.has(row.id))}
                onChange={toggleAllOnPage}
                label={`Выбрать все на странице (${rows.length})`}
              />
              {selected.size > 0 ? (
                <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-nested)] bg-[var(--accent-soft)] px-4 py-2">
                  <span className="text-sm font-medium text-[var(--accent-ink)]">
                    Выбрано: {selected.size}
                  </span>
                  <Button
                    size="sm"
                    variant="soft"
                    icon={<Archive aria-hidden="true" />}
                    disabled={selected.size > BULK_LIMIT}
                    disabledReason={
                      selected.size > BULK_LIMIT
                        ? `Выберите не более ${BULK_LIMIT} сотрудников за раз`
                        : undefined
                    }
                    onClick={openBulkArchive}
                  >
                    Архивировать выбранных
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Снять выделение
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <FadeIn>
            <DataTable
              rows={rows}
              columns={columns}
              caption="Сотрудники организации"
              rowHref={(row) => `/app/employees/${row.id}`}
              loading={employeesQuery.isLoading}
              emptyState={
                filtersActive ? (
                  <EmptyState
                    title="По этим условиям никого не нашли"
                    description="Измените поисковый запрос или сбросьте фильтры."
                    icon={<Users aria-hidden="true" />}
                    action={
                      <Button
                        onClick={() => {
                          setQueryInput('');
                          setDepartmentInput('');
                          setDebouncedQuery('');
                          setDebouncedDepartment('');
                          setStatus('active');
                        }}
                      >
                        Сбросить условия
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    title="Сотрудников пока нет"
                    description="Добавьте первого сотрудника, чтобы назначать оценки."
                    icon={<Users aria-hidden="true" />}
                    action={
                      <Button
                        variant="primary"
                        icon={<Plus aria-hidden="true" />}
                        onClick={openCreate}
                      >
                        Добавить сотрудника
                      </Button>
                    }
                  />
                )
              }
            />
          </FadeIn>
          <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
        </>
      )}

      {organizationId ? (
        <EmployeeEditor
          organizationId={organizationId}
          open={editorOpen}
          employee={editingEmployee}
          onOpenChange={setEditorOpen}
          onSaved={() => setEditorOpen(false)}
          returnFocusRef={editorTriggerRef}
        />
      ) : null}

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setArchiveTarget(null);
            setArchiveCancelActive(false);
          }
        }}
        title={`Перевести «${archiveTarget ? employeeLabel(archiveTarget) : ''}» в архив?`}
        description="Сотрудник исчезнет из активного списка. Заключения и история сохранятся."
        consequences={
          archiveTarget && archiveTarget.activeAssignments > 0
            ? [
                `У сотрудника активных оценок: ${archiveTarget.activeAssignments}.`,
                'Решение по ним нужно принять явно — тихой отмены не происходит.',
              ]
            : ['Активных оценок нет.']
        }
        confirmLabel="Архивировать"
        loading={archiveMutation.isPending}
        onConfirm={() => {
          if (archiveTarget && organizationId) {
            archiveMutation.mutate({
              employeeId: archiveTarget.id,
              cancelActiveAssignments: archiveCancelActive,
            });
          }
        }}
      >
        {archiveTarget && archiveTarget.activeAssignments > 0 ? (
          <Checkbox
            checked={archiveCancelActive}
            onChange={setArchiveCancelActive}
            label="Также отменить активные оценки"
            description="Персональные ссылки перестанут работать, открытые сессии закроются."
          />
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={bulkArchiveOpen}
        onOpenChange={(next) => {
          setBulkArchiveOpen(next);
          if (!next) {
            setBulkCancelActive(false);
          }
        }}
        title={`Архивировать выбранных сотрудников (${bulkTargets.size})?`}
        description="Каждый сотрудник исчезнет из активного списка. Результат по каждому будет показан отдельно."
        consequences={
          bulkTargets.size <= 8
            ? Array.from(bulkTargets.values())
            : [...Array.from(bulkTargets.values()).slice(0, 8), `и ещё ${bulkTargets.size - 8}`]
        }
        confirmLabel="Архивировать"
        loading={bulkArchiveMutation.isPending}
        onConfirm={() => {
          if (organizationId) {
            bulkArchiveMutation.mutate({
              employeeIds: Array.from(bulkTargets.keys()),
              cancelActiveAssignments: bulkCancelActive,
            });
          }
        }}
      >
        <Checkbox
          checked={bulkCancelActive}
          onChange={setBulkCancelActive}
          label="Также отменить активные оценки у выбранных"
          description="Применится ко всем сотрудникам с активными оценками из этого выбора."
        />
      </ConfirmDialog>
    </>
  );
}
