'use client';

import { Building, Plus, Search } from 'lucide-react';
import { useMemo, useRef, useState, type RefObject } from 'react';

import type { AdminDepartment, AdminDepartmentDetail, Envelope } from '@context/contracts';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/dialog';
import { Field, SearchInput, Select, TextInput } from '@/components/ui/field';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { DataTable, type Column } from '@/components/ui/table';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';

type StatusFilter = 'active' | 'archived' | 'all';

export default function AdminDepartmentsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [creatorOpen, setCreatorOpen] = useState(false);
  const createTrigger = useRef<HTMLButtonElement | null>(null);
  const queryString = new URLSearchParams({ status }).toString();
  const query = useApiQuery<Envelope<AdminDepartment[]>>(
    ['admin', 'departments', status],
    `/admin/departments?${queryString}`,
  );
  const rows = query.data?.data ?? [];
  const visibleRows = useMemo(() => {
    const value = search.trim().toLocaleLowerCase('ru-RU');
    return value
      ? rows.filter((item) => item.name.toLocaleLowerCase('ru-RU').includes(value))
      : rows;
  }, [rows, search]);

  const columns: ReadonlyArray<Column<AdminDepartment>> = [
    { key: 'name', header: 'Подразделение', render: (row) => row.name },
    {
      key: 'managers',
      header: 'Руководителей',
      align: 'right',
      hideOnMobile: true,
      render: (row) => <span className="tabular-nums">{row.managerCount}</span>,
    },
    {
      key: 'employees',
      header: 'Сотрудников',
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.employeeCount}</span>,
    },
    {
      key: 'status',
      header: 'Состояние',
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>
          {row.status === 'active' ? 'Активно' : 'В архиве'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Подразделения"
        description="Состав команды и руководители определяют границы доступа к сотрудникам."
        action={
          <Button
            ref={createTrigger}
            variant="primary"
            icon={<Plus aria-hidden="true" />}
            onClick={() => setCreatorOpen(true)}
          >
            Добавить
          </Button>
        }
      />

      {query.error ? (
        <ErrorState
          title="Не удалось загрузить подразделения"
          description="Проверьте подключение и повторите попытку."
          requestId={query.error.problem.requestId}
          onRetry={query.refetch}
        />
      ) : query.isLoading ? (
        <PageSkeleton variant="list" label="Загружаем подразделения" />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              label="Поиск подразделения"
              placeholder="Название"
              className="sm:max-w-xs"
            />
            <Select
              aria-label="Фильтр подразделений по состоянию"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              wrapperClassName="sm:w-52"
            >
              <option value="active">Активные</option>
              <option value="archived">Архивные</option>
              <option value="all">Все</option>
            </Select>
          </div>
          <DataTable
            rows={visibleRows}
            columns={columns}
            caption="Подразделения компании"
            rowHref={(row) => `/admin/departments/${row.id}`}
            emptyState={
              rows.length === 0 && status === 'active' ? (
                <EmptyState
                  icon={<Building aria-hidden="true" />}
                  title="Создайте первое подразделение"
                  description="После этого можно будет назначить руководителей и добавить сотрудников."
                  action={
                    <Button onClick={() => setCreatorOpen(true)}>Создать подразделение</Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Search aria-hidden="true" />}
                  title="Подразделения не найдены"
                  description="Измените поиск или выбранный фильтр."
                />
              )
            }
          />
        </>
      )}

      <DepartmentCreator
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        returnFocusRef={createTrigger}
      />
    </>
  );
}

function DepartmentCreator({
  open,
  onOpenChange,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [name, setName] = useState('');
  const create = useApiMutation<{ name: string }, Envelope<AdminDepartmentDetail>>(
    (body) => api.post('/admin/departments', body),
    {
      invalidate: [['admin', 'departments']],
      onSuccess: () => {
        notify.success('Подразделение создано');
        setName('');
        onOpenChange(false);
      },
      onError: (error) =>
        error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
    },
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !create.isPending) {
          setName('');
          create.reset();
        }
        onOpenChange(next);
      }}
      title="Новое подразделение"
      description="Название можно изменить позже, постоянный ID при этом сохранится."
      returnFocusRef={returnFocusRef}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ name });
        }}
      >
        {create.error && create.error.problem.fieldErrors.length === 0 ? (
          <ErrorState
            title={create.error.problem.title}
            requestId={create.error.problem.requestId}
          />
        ) : null}
        <Field label="Название" required error={create.error?.fieldError('name')}>
          {({ inputId, describedBy }) => (
            <TextInput
              id={inputId}
              aria-describedby={describedBy}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
              autoFocus
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          disabled={name.trim().length === 0}
        >
          Создать
        </Button>
      </form>
    </Sheet>
  );
}
