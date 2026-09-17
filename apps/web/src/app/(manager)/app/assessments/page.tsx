'use client';

import { useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Copy, Ellipsis, Eye, FileText, Link2, Plus, XCircle } from 'lucide-react';

import type { AssignmentSummary, Envelope, ListEnvelope } from '@context/contracts';
import { ASSIGNMENT_STATES, SCENARIO_CODES, SCENARIO_TITLES } from '@context/domain';

import { EmployeeFilter } from '@/components/employees/employee-picker';
import { Monogram } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink, IconButton } from '@/components/ui/button';
import { ConfirmDialog, Sheet } from '@/components/ui/dialog';
import { Field, Select, TextArea } from '@/components/ui/field';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/menu';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/manager-shell';
import { api } from '@/lib/api';
import { formatDate, formatRemaining } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useSession } from '@/lib/session';
import { assignmentTone } from './_components/tone';

const PAGE_SIZE = 20;

const STATE_LABELS: Record<string, string> = {
  draft: 'Черновик',
  invited: 'Ожидает начала',
  in_progress: 'В процессе',
  completed: 'Ответы получены',
  cancelled: 'Отменена',
  expired: 'Срок истёк',
};

const REPORT_STATUS_LABELS: Record<string, string> = {
  pending: 'Заключение не опубликовано',
  published: 'Заключение опубликовано',
};

/** Состояния, из которых имеет смысл выпустить (или переиздать) ссылку. */
const ISSUE_STATES = new Set(['draft', 'invited', 'in_progress', 'expired']);
/** Состояния, которые ещё можно отменить. Финальные состояния из меню скрыты. */
const CANCEL_STATES = new Set(['draft', 'invited', 'in_progress']);

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

interface CancelTarget {
  readonly id: string;
  readonly employeeLabel: string;
}

interface LinkResult {
  readonly employeeLabel: string;
  readonly url: string;
}

export default function AssessmentsPage() {
  const session = useSession();
  const organizationId = session.organization?.organizationId;
  const canManage = session.status !== 'authenticated' || session.has('assessments.manage');

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const state = searchParams.get('state') ?? '';
  const scenarioCode = searchParams.get('scenarioCode') ?? '';
  const reportStatus = searchParams.get('reportStatus') ?? '';
  const employeeId = searchParams.get('employeeId') ?? '';
  const hasFilters = Boolean(state || scenarioCode || reportStatus || employeeId);

  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [linkResult, setLinkResult] = useState<LinkResult | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(searchParams.toString());
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    next.delete('page');
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, {
      scroll: false,
    });
  }

  function setPage(nextPage: number): void {
    const next = new URLSearchParams(searchParams.toString());
    if (nextPage > 1) {
      next.set('page', String(nextPage));
    } else {
      next.delete('page');
    }
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, {
      scroll: false,
    });
  }

  const listPath = organizationId
    ? `/orgs/${organizationId}/assignments?${buildQuery({
        page,
        pageSize: PAGE_SIZE,
        state: state || undefined,
        scenarioCode: scenarioCode || undefined,
        reportStatus: reportStatus || undefined,
        employeeId: employeeId || undefined,
      })}`
    : null;

  const { data, error, isLoading, refetch } = useApiQuery<ListEnvelope<AssignmentSummary>>(
    ['assignments', organizationId, page, state, scenarioCode, reportStatus, employeeId],
    listPath,
    { keepPreviousData: true },
  );

  const issueMutation = useApiMutation<
    { assignmentId: string; employeeLabel: string },
    { url: string; replacedPrevious: boolean }
  >(
    async ({ assignmentId }) => {
      const response = await api.post<Envelope<{ url: string; replacedPrevious: boolean }>>(
        `/orgs/${organizationId}/assignments/${assignmentId}/invitations`,
      );
      return response.data;
    },
    {
      invalidate: [['assignments', organizationId]],
      onSuccess: (result, variables) => {
        notify.success(
          result.replacedPrevious
            ? 'Новая ссылка выпущена. Прежняя больше не работает.'
            : 'Ссылка выпущена',
        );
        setLinkResult({ employeeLabel: variables.employeeLabel, url: result.url });
      },
      onError: (cause) => {
        if (cause) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        }
      },
    },
  );

  const cancelMutation = useApiMutation<{ assignmentId: string; reason: string }, void>(
    async ({ assignmentId, reason }) => {
      await api.post(`/orgs/${organizationId}/assignments/${assignmentId}/cancel`, { reason });
    },
    {
      invalidate: [['assignments', organizationId]],
      onSuccess: () => {
        notify.success('Оценка отменена');
        setCancelTarget(null);
      },
      onError: (cause) => {
        if (cause) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        }
      },
    },
  );

  function rowActions(row: AssignmentSummary): ActionMenuItem[] {
    const items: ActionMenuItem[] = [
      {
        id: 'open',
        label: 'Открыть',
        icon: <Eye aria-hidden="true" />,
        href: `/app/assessments/${row.id}`,
      },
    ];

    if (row.reportId) {
      items.push({
        id: 'report',
        label: 'Открыть заключение',
        icon: <FileText aria-hidden="true" />,
        href: `/app/reports/${row.reportId}`,
      });
    } else if (row.reportStatusLabel) {
      items.push({
        id: 'report',
        label: row.reportStatusLabel,
        icon: <FileText aria-hidden="true" />,
        disabled: true,
      });
    }

    let separatorPending = true;

    if (canManage && ISSUE_STATES.has(row.state)) {
      items.push({
        id: 'issue',
        label: 'Выпустить новую ссылку',
        icon: <Link2 aria-hidden="true" />,
        separatorBefore: separatorPending,
        onSelect: () =>
          issueMutation.mutate({ assignmentId: row.id, employeeLabel: row.employeeLabel }),
      });
      separatorPending = false;
    }

    if (canManage && CANCEL_STATES.has(row.state)) {
      items.push({
        id: 'cancel',
        label: 'Отменить оценку',
        icon: <XCircle aria-hidden="true" />,
        destructive: true,
        separatorBefore: separatorPending,
        onSelect: () => {
          setCancelTarget({ id: row.id, employeeLabel: row.employeeLabel });
          setCancelReason('');
        },
      });
    }

    return items;
  }

  const columns: ReadonlyArray<Column<AssignmentSummary>> = [
    {
      key: 'employee',
      header: 'Сотрудник',
      render: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Monogram name={row.employeeLabel} seed={row.employeeId} size="sm" />
          <span className="truncate">{row.employeeLabel}</span>
        </span>
      ),
    },
    {
      key: 'scenario',
      header: 'Сценарий',
      render: (row) => (
        <span className="flex flex-col">
          <span>{row.scenarioTitle}</span>
          {!row.reportId && row.reportStatusLabel ? (
            <span className="text-xs text-[var(--text-secondary)]">{row.reportStatusLabel}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'dates',
      header: 'Создано → срок',
      hideOnMobile: true,
      nowrap: true,
      render: (row) => (
        <span className="flex flex-col text-sm">
          <span>{formatDate(row.createdAt)}</span>
          <span className="text-xs text-[var(--text-secondary)]">
            {row.state === 'invited' || row.state === 'in_progress'
              ? formatRemaining(row.dueAt)
              : formatDate(row.dueAt)}
          </span>
        </span>
      ),
    },
    {
      key: 'progress',
      header: 'Тестов завершено',
      align: 'right',
      render: (row) => (
        <span className="tabular-nums">
          {row.attemptsSubmitted} из {row.attemptsTotal}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'Состояние',
      render: (row) => <Badge tone={assignmentTone(row.state)}>{row.stateLabel}</Badge>,
    },
    {
      key: 'actions',
      header: 'Действие',
      align: 'right',
      render: (row) => (
        <ActionMenu
          label={`Действия: ${row.employeeLabel}`}
          items={rowActions(row)}
          trigger={
            <IconButton
              label={`Действия: ${row.employeeLabel}`}
              icon={<Ellipsis aria-hidden="true" />}
              size="sm"
              onClick={(event) => {
                menuButtonRef.current = event.currentTarget;
              }}
            />
          }
        />
      ),
    },
  ];

  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;

  return (
    <>
      <PageHeader
        title="Оценки"
        description="Все назначения организации и их состояние."
        action={
          canManage ? (
            <ButtonLink
              href="/app/assessments/new"
              variant="primary"
              icon={<Plus aria-hidden="true" />}
            >
              Назначить оценку
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 rounded-[var(--radius-panel)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-state" className="text-sm font-medium">
            Состояние
          </label>
          <Select
            id="filter-state"
            value={state}
            onChange={(event) => setFilter('state', event.target.value)}
          >
            <option value="">Любое</option>
            {ASSIGNMENT_STATES.map((value) => (
              <option key={value} value={value}>
                {STATE_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-scenario" className="text-sm font-medium">
            Сценарий
          </label>
          <Select
            id="filter-scenario"
            value={scenarioCode}
            onChange={(event) => setFilter('scenarioCode', event.target.value)}
          >
            <option value="">Любой</option>
            {SCENARIO_CODES.map((code) => (
              <option key={code} value={code}>
                {SCENARIO_TITLES[code]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-report" className="text-sm font-medium">
            Заключение
          </label>
          <Select
            id="filter-report"
            value={reportStatus}
            onChange={(event) => setFilter('reportStatus', event.target.value)}
          >
            <option value="">Любое</option>
            <option value="pending">{REPORT_STATUS_LABELS.pending}</option>
            <option value="published">{REPORT_STATUS_LABELS.published}</option>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-employee" className="text-sm font-medium">
            Сотрудник
          </label>
          <EmployeeFilter
            id="filter-employee"
            organizationId={organizationId}
            value={employeeId}
            onChange={(value) => setFilter('employeeId', value)}
          />
        </div>

        {hasFilters ? (
          <Button variant="ghost" onClick={() => router.replace(pathname, { scroll: false })}>
            Сбросить
          </Button>
        ) : null}
      </div>

      {error ? (
        <ErrorState
          title="Не удалось загрузить оценки"
          requestId={error.problem.requestId}
          onRetry={refetch}
        />
      ) : (
        <>
          <DataTable
            rows={rows}
            columns={columns}
            caption="Назначенные оценки"
            rowHref={(row) => `/app/assessments/${row.id}`}
            loading={isLoading}
            emptyState={
              <EmptyState
                title={hasFilters ? 'По этим условиям оценок нет' : 'Оценок пока нет'}
                description={
                  hasFilters
                    ? 'Измените фильтры или сбросьте их.'
                    : 'Создайте первую оценку: выберите вопрос, заполните контекст и передайте ссылку сотруднику.'
                }
                action={
                  hasFilters ? (
                    <Button onClick={() => router.replace(pathname, { scroll: false })}>
                      Сбросить фильтры
                    </Button>
                  ) : canManage ? (
                    <ButtonLink href="/app/assessments/new" variant="primary">
                      Назначить оценку
                    </ButtonLink>
                  ) : undefined
                }
              />
            }
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setCancelTarget(null);
          }
        }}
        title={`Отменить оценку для «${cancelTarget?.employeeLabel ?? ''}»?`}
        description="Действие нельзя отменить. Для повторной оценки нужно создать новое назначение."
        consequences={[
          'Персональная ссылка перестанет работать.',
          'Открытая сессия сотрудника будет закрыта.',
          'Незавершённая обработка результата не будет сохранена.',
        ]}
        confirmLabel="Отменить оценку"
        destructive
        loading={cancelMutation.isPending}
        onConfirm={() => {
          if (cancelTarget) {
            cancelMutation.mutate({ assignmentId: cancelTarget.id, reason: cancelReason });
          }
        }}
        returnFocusRef={menuButtonRef}
      >
        <Field label="Причина отмены" hint="Не менее 3 символов. Сохранится в истории назначения.">
          {({ inputId, describedBy }) => (
            <TextArea
              id={inputId}
              aria-describedby={describedBy}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              maxLength={1000}
              minLength={3}
              rows={3}
              required
            />
          )}
        </Field>
      </ConfirmDialog>

      <Sheet
        open={Boolean(linkResult)}
        onOpenChange={(open) => {
          if (!open) {
            setLinkResult(null);
          }
        }}
        title="Ссылка для участия"
        description={linkResult ? `Для сотрудника «${linkResult.employeeLabel}».` : undefined}
        returnFocusRef={menuButtonRef}
      >
        {linkResult ? (
          <div className="flex flex-col gap-3">
            <code className="overflow-x-auto rounded-[var(--radius-control)] bg-[var(--bg-inset)] p-3 text-xs">
              {linkResult.url}
            </code>
            <Button
              variant="secondary"
              icon={<Copy aria-hidden="true" />}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(linkResult.url);
                  notify.success('Ссылка скопирована');
                } catch {
                  notify.error('Не удалось скопировать ссылку. Выделите и скопируйте её вручную.');
                }
              }}
            >
              Скопировать
            </Button>
            <p className="text-xs text-[var(--text-secondary)]">
              Значение показывается один раз. После закрытия панели восстановить его нельзя — можно
              только выпустить новую ссылку.
            </p>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
