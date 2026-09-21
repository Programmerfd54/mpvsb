'use client';

import { useState } from 'react';

import {
  ACCESS_GRANT_DEFAULT_HOURS,
  ACCESS_GRANT_MAX_HOURS,
  ACCESS_GRANT_PURPOSE_LABELS,
  ACCESS_GRANT_PURPOSES,
  type AccessGrant,
  type AccessGrantPurpose,
  type AdminAssignmentSummary,
  type CreateAccessGrantInput,
  type Envelope,
  type ListEnvelope,
} from '@context/contracts';

import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select, TextArea } from '@/components/ui/field';
import { Callout, EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';

const PAGE_SIZE = 20;
const MAX_SELECTED = 20;

export function AccessRequest({ organizationId }: { organizationId: string }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [purpose, setPurpose] = useState<AccessGrantPurpose>('report_review');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(ACCESS_GRANT_DEFAULT_HOURS);
  const [success, setSuccess] = useState(false);

  const assignmentsQuery = useApiQuery<ListEnvelope<AdminAssignmentSummary>>(
    ['admin', 'organization', organizationId, 'assignments', page],
    `/admin/organizations/${organizationId}/assignments?page=${page}&pageSize=${PAGE_SIZE}`,
  );

  const request = useApiMutation<CreateAccessGrantInput, Envelope<AccessGrant>>(
    (body) => api.post(`/admin/organizations/${organizationId}/access-grants`, body),
    {
      invalidate: [['admin', 'organization', organizationId, 'access-grants']],
      onSuccess: () => {
        setSuccess(true);
        setSelected([]);
        setReason('');
      },
    },
  );

  const trimmedReason = reason.trim();
  const canSubmit =
    selected.length > 0 &&
    trimmedReason.length >= 10 &&
    trimmedReason.length <= 1000 &&
    Number.isInteger(hours) &&
    hours >= 1 &&
    hours <= ACCESS_GRANT_MAX_HOURS;

  function toggle(id: string): void {
    setSuccess(false);
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length < MAX_SELECTED
          ? [...current, id]
          : current,
    );
  }

  return (
    <Card>
      <CardHeader
        title="Запросить временный доступ"
        description="Доступ к выбранным назначениям сможет выдать только владелец организации. Сам запрос данные не открывает."
      />
      <CardBody className="flex flex-col gap-6">
        {success ? (
          <Callout tone="success" role="status" title="Запрос отправлен">
            Решение принимает владелец организации. До его одобрения доступ закрыт.
          </Callout>
        ) : null}
        {request.error ? (
          <Callout tone="danger" role="alert" title="Не удалось отправить запрос">
            {request.error.problem.title}
          </Callout>
        ) : null}

        <div className="flex flex-col gap-3">
          <div>
            <h3 className="font-semibold">Объём доступа</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Выберите от 1 до {MAX_SELECTED} назначений. Выбрано: {selected.length}. Имена
              сотрудников и ответы здесь не показываются.
            </p>
          </div>
          {assignmentsQuery.error ? (
            <ErrorState
              title="Не удалось загрузить назначения"
              requestId={assignmentsQuery.error.problem.requestId}
              onRetry={assignmentsQuery.refetch}
            />
          ) : !assignmentsQuery.data ? (
            <LoadingBlock label="Загружаем назначения" />
          ) : assignmentsQuery.data.data.length === 0 ? (
            <EmptyState
              compact
              title="Назначений пока нет"
              description="Запросить доступ пока не к чему."
            />
          ) : (
            <>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {assignmentsQuery.data.data.map((assignment) => {
                  const checked = selected.includes(assignment.assignmentId);
                  return (
                    <li key={assignment.assignmentId}>
                      <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-[var(--radius-nested)] border border-[var(--border-hairline)] p-3">
                        <input
                          type="checkbox"
                          className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
                          checked={checked}
                          disabled={
                            request.isPending || (!checked && selected.length >= MAX_SELECTED)
                          }
                          onChange={() => toggle(assignment.assignmentId)}
                        />
                        <span className="min-w-0 text-sm">
                          <span className="block font-medium">
                            {assignment.caseCode} · {assignment.scenarioTitle}
                          </span>
                          <span className="text-[var(--text-secondary)]">
                            {assignment.scenarioCode} · создано{' '}
                            {formatDateTime(assignment.createdAt)}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between gap-3 text-sm">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page === 1 || request.isPending}
                  onClick={() => setPage(page - 1)}
                >
                  Назад
                </Button>
                <span>
                  Страница {page} · всего {assignmentsQuery.data.meta.total}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    page * PAGE_SIZE >= assignmentsQuery.data.meta.total || request.isPending
                  }
                  onClick={() => setPage(page + 1)}
                >
                  Далее
                </Button>
              </div>
            </>
          )}
        </div>

        <Field label="Цель доступа" required error={request.error?.fieldError('purpose')}>
          {({ inputId, describedBy }) => (
            <Select
              id={inputId}
              aria-describedby={describedBy}
              value={purpose}
              disabled={request.isPending}
              onChange={(event) => setPurpose(event.target.value as AccessGrantPurpose)}
            >
              {ACCESS_GRANT_PURPOSES.map((value) => (
                <option key={value} value={value}>
                  {ACCESS_GRANT_PURPOSE_LABELS[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Причина запроса"
          required
          hint="Не менее 10 символов. Причину увидит владелец организации."
          error={request.error?.fieldError('reason')}
        >
          {({ inputId, describedBy }) => (
            <TextArea
              id={inputId}
              aria-describedby={describedBy}
              value={reason}
              maxLength={1000}
              rows={4}
              disabled={request.isPending}
              onChange={(event) => {
                setReason(event.target.value);
                setSuccess(false);
              }}
            />
          )}
        </Field>
        <Field
          label="Запрашиваемый срок, часов"
          required
          hint={`От 1 до ${ACCESS_GRANT_MAX_HOURS}. Владелец может выдать меньший срок.`}
          error={request.error?.fieldError('requestedHours')}
        >
          {({ inputId, describedBy }) => (
            <Select
              id={inputId}
              aria-describedby={describedBy}
              value={hours}
              disabled={request.isPending}
              onChange={(event) => setHours(Number(event.target.value))}
            >
              {[1, 2, 4, 8, 12, 24].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div>
          <Button
            variant="primary"
            loading={request.isPending}
            disabled={!canSubmit}
            disabledReason={
              !canSubmit ? 'Выберите назначения и укажите причину не короче 10 символов' : undefined
            }
            onClick={() =>
              request.mutate({
                purpose,
                reason: trimmedReason,
                assignmentIds: selected,
                requestedHours: hours,
              })
            }
          >
            Отправить запрос владельцу
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
