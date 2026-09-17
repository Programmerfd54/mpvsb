'use client';

import { useLayoutEffect, useState, type FormEvent, type RefObject } from 'react';

import type { EmployeeDetail, Envelope } from '@context/contracts';

import { Button } from '@/components/ui/button';
import { DetailDrawer } from '@/components/ui/dialog';
import { Field, TextInput } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/query';

interface EmployeeFormPayload {
  displayName?: string;
  externalCode?: string;
  jobTitle?: string;
  department?: string;
}

/**
 * Поля, нужные редактору. И `EmployeeSummary` (список), и `EmployeeDetail`
 * (карточка) подходят под эту форму — редактор можно открыть из обоих мест.
 */
export interface EmployeeEditable {
  readonly id: string;
  readonly displayName: string | null;
  readonly externalCode: string | null;
  readonly jobTitle: string | null;
  readonly department: string | null;
}

/**
 * Добавление и редактирование сотрудника (одна панель, два режима).
 *
 * Обязательно одно из двух: имя или внутренний код — компания может вести учёт
 * только по кодам. Однофамильцы допускаются: совпадение имени не блокирует ввод.
 */
export function EmployeeEditor({
  organizationId,
  open,
  onOpenChange,
  onSaved,
  employee = null,
  returnFocusRef,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (employee: EmployeeDetail) => void;
  /** Сотрудник для редактирования. `null`/не задан — режим добавления. */
  employee?: EmployeeEditable | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const isEdit = employee !== null;

  const [displayName, setDisplayName] = useState('');
  const [externalCode, setExternalCode] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState('');

  const mutation = useApiMutation<EmployeeFormPayload, Envelope<EmployeeDetail>>(
    (payload) =>
      employee
        ? api.patch<Envelope<EmployeeDetail>>(
            `/orgs/${organizationId}/employees/${employee.id}`,
            payload,
          )
        : api.post<Envelope<EmployeeDetail>>(`/orgs/${organizationId}/employees`, payload),
    {
      invalidate: [
        ['employees', organizationId],
        ...(employee ? [['employee', organizationId, employee.id]] : []),
      ],
      onSuccess: (result) => {
        // Сообщение об успехе — только после подтверждения сервером.
        notify.success(isEdit ? 'Изменения сохранены' : 'Сотрудник добавлен');
        onSaved(result.data);
      },
      onError: (apiError) => {
        if (apiError && apiError.problem.fieldErrors.length === 0) {
          notify.error(apiError.problem.title, { requestId: apiError.problem.requestId });
        }
      },
    },
  );

  // Панель не размонтируется при закрытии, поэтому поля и ошибку заполняем
  // заново при каждом открытии: иначе форма редактирования одного сотрудника
  // показала бы значения предыдущего.
  useLayoutEffect(() => {
    if (open) {
      setDisplayName(employee?.displayName ?? '');
      setExternalCode(employee?.externalCode ?? '');
      setJobTitle(employee?.jobTitle ?? '');
      setDepartment(employee?.department ?? '');
      mutation.reset();
    }
    // Зависимость от `mutation` намеренно не добавлена: её ссылка меняется
    // каждый рендер, а обновлять форму нужно только при открытии панели
    // или смене редактируемого сотрудника.
  }, [open, employee]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (mutation.isPending) {
      return;
    }
    void mutation.mutateAsync({
      displayName: displayName.trim() || undefined,
      externalCode: externalCode.trim() || undefined,
      jobTitle: jobTitle.trim() || undefined,
      department: department.trim() || undefined,
    });
  }

  const error = mutation.error;

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={
        isEdit
          ? `Редактировать «${employee.displayName ?? employee.externalCode ?? 'сотрудника'}»`
          : 'Добавить сотрудника'
      }
      description="Укажите имя или внутренний код. Остальные поля можно заполнить позже."
      returnFocusRef={returnFocusRef}
      footer={
        <div className="flex flex-wrap gap-3">
          <Button type="submit" form="employee-form" variant="primary" loading={mutation.isPending}>
            Сохранить
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="employee-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {error && error.problem.fieldErrors.length === 0 ? (
          <ErrorState title={error.problem.title} requestId={error.problem.requestId} />
        ) : null}

        <Field
          label="Имя сотрудника"
          hint="Так его увидит руководитель в списке. Можно оставить пустым, если ведёте учёт по кодам."
          error={error?.fieldError('displayName')}
        >
          {({ inputId, describedBy }) => (
            <TextInput
              id={inputId}
              aria-describedby={describedBy}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={200}
              invalid={Boolean(error?.fieldError('displayName'))}
            />
          )}
        </Field>

        <Field
          label="Внутренний код"
          hint="Уникален внутри организации, если задан."
          error={error?.fieldError('externalCode')}
        >
          {({ inputId, describedBy }) => (
            <TextInput
              id={inputId}
              aria-describedby={describedBy}
              value={externalCode}
              onChange={(event) => setExternalCode(event.target.value)}
              maxLength={64}
              invalid={Boolean(error?.fieldError('externalCode'))}
            />
          )}
        </Field>

        <Field label="Должность" error={error?.fieldError('jobTitle')}>
          {({ inputId, describedBy }) => (
            <TextInput
              id={inputId}
              aria-describedby={describedBy}
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
              maxLength={120}
            />
          )}
        </Field>

        <Field label="Подразделение" error={error?.fieldError('department')}>
          {({ inputId, describedBy }) => (
            <TextInput
              id={inputId}
              aria-describedby={describedBy}
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              maxLength={120}
            />
          )}
        </Field>
      </form>
    </DetailDrawer>
  );
}
