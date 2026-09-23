'use client';

import { Copy, Plus, Search, Users } from 'lucide-react';
import { useMemo, useRef, useState, type RefObject } from 'react';

import type {
  AdminDepartment,
  AdminUser,
  AdminUserInvitation,
  Envelope,
  InviteAdminUser,
} from '@context/contracts';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Sheet } from '@/components/ui/dialog';
import { Checkbox, Field, SearchInput, Select, TextInput } from '@/components/ui/field';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { DataTable, type Column } from '@/components/ui/table';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';

const ROLE_LABELS = {
  manager: 'Руководитель',
  reviewer: 'Рецензент',
  employee: 'Сотрудник',
} as const;

type AdminUserRow = AdminUser & { id: string };

export default function AdminUsersPage() {
  const query = useApiQuery<Envelope<AdminUser[]>>(['admin', 'users'], '/admin/users');
  const departments = useApiQuery<Envelope<AdminDepartment[]>>(
    ['admin', 'departments', 'active'],
    '/admin/departments?status=active',
  );
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'all' | AdminUser['role']>('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const inviteTrigger = useRef<HTMLButtonElement | null>(null);
  const rows: AdminUserRow[] = (query.data?.data ?? []).map((item) => ({
    ...item,
    id: item.userId ?? item.employeeId!,
  }));
  const visibleRows = useMemo(() => {
    const value = search.trim().toLocaleLowerCase('ru-RU');
    return rows.filter(
      (item) =>
        (role === 'all' || item.role === role) &&
        (value === '' ||
          item.displayName.toLocaleLowerCase('ru-RU').includes(value) ||
          item.email?.toLocaleLowerCase('ru-RU').includes(value)),
    );
  }, [rows, role, search]);

  const columns: ReadonlyArray<Column<AdminUserRow>> = [
    {
      key: 'name',
      header: 'Пользователь',
      render: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.displayName}</span>
          <span className="block truncate text-sm text-[var(--text-secondary)]">
            {row.email ?? 'Email не указан'}
          </span>
        </span>
      ),
    },
    { key: 'role', header: 'Роль', render: (row) => ROLE_LABELS[row.role] },
    {
      key: 'department',
      header: 'Подразделение',
      hideOnMobile: true,
      render: (row) => row.departments.map((item) => item.name).join(', ') || 'Не назначено',
    },
    {
      key: 'delivery',
      header: 'Письмо',
      hideOnMobile: true,
      render: (row) =>
        row.deliveryStatus === 'unavailable' ? (
          <Badge tone="neutral">Доставка недоступна</Badge>
        ) : (
          <Badge tone="warning">Ожидает отправки</Badge>
        ),
    },
    {
      key: 'activation',
      header: 'Доступ',
      render: (row) => (
        <Badge
          tone={
            row.activationStatus === 'activated'
              ? 'success'
              : row.activationStatus === 'blocked'
                ? 'danger'
                : 'warning'
          }
        >
          {row.activationStatus === 'activated'
            ? 'Активирован'
            : row.activationStatus === 'blocked'
              ? 'Заблокирован'
              : 'Ожидает активации'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Пользователи"
        description="Доставка письма и активация доступа показываются раздельно."
        action={
          <Button
            ref={inviteTrigger}
            variant="primary"
            icon={<Plus aria-hidden="true" />}
            onClick={() => setInviteOpen(true)}
          >
            Пригласить
          </Button>
        }
      />
      {query.error ? (
        <ErrorState
          title="Не удалось загрузить пользователей"
          requestId={query.error.problem.requestId}
          onRetry={query.refetch}
        />
      ) : query.isLoading ? (
        <PageSkeleton variant="list" label="Загружаем пользователей" />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              label="Поиск по имени или email"
              placeholder="Имя или email"
              className="sm:max-w-xs"
            />
            <Select
              aria-label="Фильтр по роли"
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
              wrapperClassName="sm:w-52"
            >
              <option value="all">Все роли</option>
              <option value="manager">Руководители</option>
              <option value="reviewer">Рецензенты</option>
              <option value="employee">Сотрудники</option>
            </Select>
          </div>
          <DataTable
            rows={visibleRows}
            columns={columns}
            caption="Пользователи пространства"
            emptyState={
              rows.length === 0 ? (
                <EmptyState
                  icon={<Users aria-hidden="true" />}
                  title="Пользователей пока нет"
                  description="Пригласите первого руководителя или рецензента."
                  action={<Button onClick={() => setInviteOpen(true)}>Пригласить</Button>}
                />
              ) : (
                <EmptyState
                  icon={<Search aria-hidden="true" />}
                  title="Ничего не найдено"
                  description="Измените поиск или фильтр роли."
                />
              )
            }
          />
        </>
      )}
      <InviteUserSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        returnFocusRef={inviteTrigger}
        departments={departments.data?.data ?? []}
        departmentsError={departments.error?.problem.title}
      />
    </>
  );
}

function InviteUserSheet({
  open,
  onOpenChange,
  returnFocusRef,
  departments,
  departmentsError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  departments: AdminDepartment[];
  departmentsError?: string;
}) {
  const [displayName, setDisplayName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'manager' | 'reviewer' | 'employee'>('manager');
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const invite = useApiMutation<InviteAdminUser, Envelope<AdminUserInvitation>>(
    (body) => api.post('/admin/users', body),
    {
      invalidate: [
        ['admin', 'users'],
        ['admin', 'departments'],
      ],
      onSuccess: () => notify.success('Приглашение создано'),
      onError: (error) =>
        error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
    },
  );

  function reset(): void {
    setDisplayName('');
    setJobTitle('');
    setEmail('');
    setRole('manager');
    setDepartmentIds([]);
    invite.reset();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !invite.isPending) reset();
        onOpenChange(next);
      }}
      title="Пригласить пользователя"
      description="Роль определяет кабинет и доступные данные после активации."
      returnFocusRef={returnFocusRef}
    >
      {invite.data ? (
        <Card>
          <CardHeader
            title="Ссылка активации создана"
            description={invite.data.data.deliveryMessage}
          />
          <CardBody className="flex flex-col gap-3">
            <code className="overflow-x-auto rounded-[var(--radius-control)] bg-[var(--bg-inset)] p-3 text-xs">
              {invite.data.data.activation.url}
            </code>
            <Button
              icon={<Copy aria-hidden="true" />}
              onClick={() => {
                void navigator.clipboard.writeText(invite.data!.data.activation.url);
                notify.success('Ссылка скопирована');
              }}
            >
              Скопировать ссылку
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Готово
            </Button>
          </CardBody>
        </Card>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            invite.mutate({
              displayName,
              jobTitle: jobTitle.trim() || null,
              email,
              role,
              departmentIds,
            });
          }}
        >
          {invite.error && invite.error.problem.fieldErrors.length === 0 ? (
            <ErrorState
              title={invite.error.problem.title}
              requestId={invite.error.problem.requestId}
            />
          ) : null}
          <Field label="ФИО" required error={invite.error?.fieldError('displayName')}>
            {({ inputId }) => (
              <TextInput
                id={inputId}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={200}
                required
              />
            )}
          </Field>
          <Field label="Должность" error={invite.error?.fieldError('jobTitle')}>
            {({ inputId }) => (
              <TextInput
                id={inputId}
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                maxLength={120}
              />
            )}
          </Field>
          <Field label="Рабочая почта" required error={invite.error?.fieldError('email')}>
            {({ inputId }) => (
              <TextInput
                id={inputId}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={320}
                required
              />
            )}
          </Field>
          <Field label="Роль" required>
            {({ inputId }) => (
              <Select
                id={inputId}
                value={role}
                onChange={(event) => {
                  const nextRole = event.target.value as typeof role;
                  setRole(nextRole);
                  if (nextRole === 'employee') {
                    setDepartmentIds((current) => current.slice(0, 1));
                  }
                }}
              >
                <option value="manager">Руководитель</option>
                <option value="reviewer">Рецензент</option>
                <option value="employee">Сотрудник</option>
              </Select>
            )}
          </Field>
          <fieldset className="flex flex-col">
            <legend className="text-sm font-semibold">Подразделения</legend>
            {departmentsError ? (
              <p className="mt-2 text-sm text-[var(--danger-text)]">{departmentsError}</p>
            ) : null}
            {departments.map((department) => (
              <Checkbox
                key={department.id}
                checked={departmentIds.includes(department.id)}
                onChange={(checked) =>
                  setDepartmentIds((current) =>
                    checked
                      ? role === 'employee'
                        ? [department.id]
                        : [...current, department.id]
                      : current.filter((id) => id !== department.id),
                  )
                }
                label={department.name}
              />
            ))}
          </fieldset>
          <Button
            type="submit"
            variant="primary"
            loading={invite.isPending}
            disabled={!displayName.trim() || !email.trim() || departmentIds.length === 0}
          >
            Создать приглашение
          </Button>
        </form>
      )}
    </Sheet>
  );
}
