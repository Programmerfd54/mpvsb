'use client';

import { Archive, ArrowRightLeft, Pencil, UserMinus, UserPlus, Users } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState, type RefObject } from 'react';

import type {
  AdminDepartment,
  AdminDepartmentDetail,
  Envelope,
  TransferEmployeeResult,
} from '@context/contracts';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Sheet } from '@/components/ui/dialog';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { KeyValueList } from '@/components/ui/data-list';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';

export default function AdminDepartmentPage() {
  const { departmentId } = useParams<{ departmentId: string }>();
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [transferEmployee, setTransferEmployee] = useState<
    AdminDepartmentDetail['employees'][number] | null
  >(null);
  const renameTrigger = useRef<HTMLButtonElement | null>(null);
  const query = useApiQuery<Envelope<AdminDepartmentDetail>>(
    ['admin', 'department', departmentId],
    `/admin/departments/${departmentId}`,
  );
  const department = query.data?.data;

  const archive = useApiMutation<number, Envelope<AdminDepartmentDetail>>(
    (expectedRevision) =>
      api.post(`/admin/departments/${departmentId}/archive`, { expectedRevision }),
    {
      invalidate: [
        ['admin', 'departments'],
        ['admin', 'department', departmentId],
      ],
      onSuccess: () => {
        notify.success('Подразделение перемещено в архив');
        router.push('/admin/departments?status=archived');
      },
      onError: (error) =>
        error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
    },
  );

  if (query.error) {
    return (
      <ErrorState
        title={
          query.error.status === 404
            ? 'Подразделение не найдено'
            : 'Не удалось загрузить подразделение'
        }
        description="Проверьте ссылку или повторите попытку."
        requestId={query.error.problem.requestId}
        onRetry={query.refetch}
      />
    );
  }
  if (!department) return <PageSkeleton variant="detail" label="Загружаем подразделение" />;

  return (
    <>
      <PageHeader
        title={department.name}
        breadcrumbs={[
          { label: 'Подразделения', href: '/admin/departments' },
          { label: department.name },
        ]}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              ref={renameTrigger}
              icon={<Pencil aria-hidden="true" />}
              onClick={() => setRenameOpen(true)}
              disabled={department.status === 'archived'}
            >
              Переименовать
            </Button>
            <Button
              variant="destructive"
              icon={<Archive aria-hidden="true" />}
              onClick={() => setArchiveOpen(true)}
              disabled={department.status === 'archived'}
            >
              Архивировать
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <Card>
          <CardHeader title="Сотрудники" icon={<Users aria-hidden="true" />} />
          <CardBody>
            {department.employees.length === 0 ? (
              <EmptyState
                compact
                title="В подразделении нет сотрудников"
                description="Сотрудников можно добавить на шаге пользователей в настройке пространства."
              />
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-[var(--border-hairline)] p-0">
                {department.employees.map((employee) => (
                  <li
                    key={employee.employeeId}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {employee.displayName ?? 'Сотрудник без отображаемого имени'}
                      </span>
                      <span className="block truncate text-sm text-[var(--text-secondary)]">
                        {employee.jobTitle ?? 'Должность не указана'}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {employee.archived ? <Badge tone="neutral">В архиве</Badge> : null}
                      {!employee.archived && department.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<ArrowRightLeft aria-hidden="true" />}
                          onClick={() => setTransferEmployee(employee)}
                        >
                          Перевести
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Сведения" />
            <CardBody>
              <KeyValueList
                items={[
                  {
                    label: 'Состояние',
                    value: department.status === 'active' ? 'Активно' : 'В архиве',
                  },
                  { label: 'Сотрудников', value: String(department.employeeCount) },
                  { label: 'Руководителей', value: String(department.managerCount) },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Руководители" />
            <CardBody>
              {department.managers.length === 0 ? (
                <EmptyState compact title="Руководитель не назначен" />
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {department.managers.map((manager) => (
                    <li key={manager.userId} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {manager.displayName}
                      </span>
                      <RevokeManagerButton department={department} userId={manager.userId} />
                    </li>
                  ))}
                </ul>
              )}
              {department.status === 'active' && department.availableManagers.length > 0 ? (
                <AssignManager department={department} />
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>

      <RenameDepartment
        department={department}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        returnFocusRef={renameTrigger}
      />
      <TransferEmployeeSheet
        sourceDepartment={department}
        employee={transferEmployee}
        onOpenChange={(open) => !open && setTransferEmployee(null)}
      />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Архивировать «${department.name}»?`}
        description="Архивирование доступно только для пустого подразделения без назначенных руководителей."
        consequences={[
          'Подразделение исчезнет из списка активных.',
          'История сотрудников и назначений сохранится.',
        ]}
        confirmLabel="Архивировать"
        destructive
        loading={archive.isPending}
        onConfirm={() => archive.mutate(department.revision)}
      >
        {archive.error ? (
          <ErrorState
            title={archive.error.problem.title}
            requestId={archive.error.problem.requestId}
          />
        ) : null}
      </ConfirmDialog>
    </>
  );
}

function AssignManager({ department }: { department: AdminDepartmentDetail }) {
  const [userId, setUserId] = useState('');
  const assign = useApiMutation<string, Envelope<AdminDepartmentDetail>>(
    (selectedUserId) =>
      api.post(`/admin/departments/${department.id}/managers`, { userId: selectedUserId }),
    {
      invalidate: [
        ['admin', 'departments'],
        ['admin', 'department', department.id],
      ],
      onSuccess: () => {
        setUserId('');
        notify.success('Руководитель назначен');
      },
      onError: (error) =>
        error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
    },
  );

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-[var(--border-hairline)] pt-4">
      <Select
        aria-label="Выберите руководителя"
        value={userId}
        onChange={(event) => setUserId(event.target.value)}
      >
        <option value="">Выберите пользователя</option>
        {department.availableManagers.map((manager) => (
          <option key={manager.userId} value={manager.userId}>
            {manager.displayName}
            {manager.membershipStatus === 'invited' ? ' (приглашён)' : ''}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        icon={<UserPlus aria-hidden="true" />}
        loading={assign.isPending}
        disabled={!userId}
        onClick={() => assign.mutate(userId)}
      >
        Назначить руководителя
      </Button>
    </div>
  );
}

function RevokeManagerButton({
  department,
  userId,
}: {
  department: AdminDepartmentDetail;
  userId: string;
}) {
  const revoke = useApiMutation<void, Envelope<AdminDepartmentDetail>>(
    () => api.post(`/admin/departments/${department.id}/managers/${userId}/revoke`),
    {
      invalidate: [
        ['admin', 'departments'],
        ['admin', 'department', department.id],
      ],
      onSuccess: () => notify.success('Назначение руководителя отозвано'),
      onError: (error) =>
        error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
    },
  );
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<UserMinus aria-hidden="true" />}
      loading={revoke.isPending}
      aria-label="Отозвать назначение руководителя"
      onClick={() => revoke.mutate()}
    />
  );
}

function TransferEmployeeSheet({
  sourceDepartment,
  employee,
  onOpenChange,
}: {
  sourceDepartment: AdminDepartmentDetail;
  employee: AdminDepartmentDetail['employees'][number] | null;
  onOpenChange: (open: boolean) => void;
}) {
  const departmentsQuery = useApiQuery<Envelope<AdminDepartment[]>>(
    ['admin', 'departments', 'active'],
    '/admin/departments?status=active',
  );
  const targets =
    departmentsQuery.data?.data.filter((item) => item.id !== sourceDepartment.id) ?? [];
  const [targetDepartmentId, setTargetDepartmentId] = useState('');
  const [reason, setReason] = useState('');
  const [activeAssignmentsAction, setActiveAssignmentsAction] = useState<
    'keep_current_scope' | 'cancel'
  >('keep_current_scope');
  const transfer = useApiMutation<
    {
      targetDepartmentId: string;
      expectedEmployeeRevision: number;
      reason: string;
      activeAssignmentsAction: 'keep_current_scope' | 'cancel';
    },
    Envelope<TransferEmployeeResult>
  >(
    (body) =>
      api.post(
        `/admin/departments/${sourceDepartment.id}/employees/${employee?.employeeId}/transfer`,
        body,
      ),
    {
      invalidate: [
        ['admin', 'departments'],
        ['admin', 'department', sourceDepartment.id],
        ['admin', 'workspace'],
      ],
      onSuccess: (result) => {
        notify.success(
          result.data.cancelledAssignments > 0
            ? `Сотрудник переведён, отменено оценок: ${result.data.cancelledAssignments}`
            : 'Сотрудник переведён',
        );
        setTargetDepartmentId('');
        setReason('');
        onOpenChange(false);
      },
      onError: (error) =>
        error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
    },
  );

  return (
    <Sheet
      open={employee !== null}
      onOpenChange={(open) => {
        if (!open && !transfer.isPending) {
          setTargetDepartmentId('');
          setReason('');
          transfer.reset();
        }
        onOpenChange(open);
      }}
      title="Перевести сотрудника"
      description={employee?.displayName ?? 'Сотрудник без отображаемого имени'}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!employee) return;
          transfer.mutate({
            targetDepartmentId,
            expectedEmployeeRevision: employee.revision,
            reason,
            activeAssignmentsAction,
          });
        }}
      >
        {transfer.error && transfer.error.problem.fieldErrors.length === 0 ? (
          <ErrorState
            title={transfer.error.problem.title}
            requestId={transfer.error.problem.requestId}
          />
        ) : null}
        <Field
          label="Новое подразделение"
          required
          error={transfer.error?.fieldError('targetDepartmentId')}
        >
          {({ inputId }) => (
            <Select
              id={inputId}
              value={targetDepartmentId}
              onChange={(event) => setTargetDepartmentId(event.target.value)}
              required
            >
              <option value="">Выберите подразделение</option>
              {targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Причина перевода" required error={transfer.error?.fieldError('reason')}>
          {({ inputId }) => (
            <TextArea
              id={inputId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              rows={3}
              required
            />
          )}
        </Field>
        <Field label="Активные оценки" required>
          {({ inputId }) => (
            <Select
              id={inputId}
              value={activeAssignmentsAction}
              onChange={(event) =>
                setActiveAssignmentsAction(event.target.value as 'keep_current_scope' | 'cancel')
              }
            >
              <option value="keep_current_scope">Сохранить с прежним снимком доступа</option>
              <option value="cancel">Отменить активные оценки и ссылки</option>
            </Select>
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          loading={transfer.isPending}
          disabled={!employee || !targetDepartmentId || reason.trim().length < 5}
        >
          Подтвердить перевод
        </Button>
      </form>
    </Sheet>
  );
}

function RenameDepartment({
  department,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  department: AdminDepartmentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [name, setName] = useState(department.name);
  const rename = useApiMutation<
    { name: string; expectedRevision: number },
    Envelope<AdminDepartmentDetail>
  >((body) => api.patch(`/admin/departments/${department.id}`, body), {
    invalidate: [
      ['admin', 'departments'],
      ['admin', 'department', department.id],
    ],
    onSuccess: () => {
      notify.success('Название подразделения изменено');
      onOpenChange(false);
    },
    onError: (error) =>
      error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !rename.isPending) {
          setName(department.name);
          rename.reset();
        }
        onOpenChange(next);
      }}
      title="Переименовать подразделение"
      description="Постоянный ID, сотрудники и история останутся без изменений."
      returnFocusRef={returnFocusRef}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          rename.mutate({ name, expectedRevision: department.revision });
        }}
      >
        {rename.error && rename.error.problem.fieldErrors.length === 0 ? (
          <ErrorState
            title={rename.error.problem.title}
            requestId={rename.error.problem.requestId}
          />
        ) : null}
        <Field label="Название" required error={rename.error?.fieldError('name')}>
          {({ inputId }) => (
            <TextInput
              id={inputId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          loading={rename.isPending}
          disabled={name.trim() === '' || name.trim() === department.name}
        >
          Сохранить
        </Button>
      </form>
    </Sheet>
  );
}
