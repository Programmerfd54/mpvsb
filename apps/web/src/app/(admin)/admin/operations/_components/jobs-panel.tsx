'use client';

import { ListRestart, OctagonPause, PlayCircle, ScrollText } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  JOB_STATES,
  type AdminJob,
  type AdminJobDetails,
  type AdminOperationsFacets,
  type Envelope,
  type JobState,
} from '@context/contracts';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KeyValueList } from '@/components/ui/data-list';
import { DetailDrawer } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/menu';
import { Callout, EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';

const STATE_LABELS: Record<JobState, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  done: 'Выполнено',
  failed: 'Ошибка',
  stopped: 'Повторы остановлены',
};

const STATE_TONES: Record<JobState, BadgeTone> = {
  queued: 'warning',
  running: 'info',
  done: 'success',
  failed: 'danger',
  stopped: 'neutral',
};

const PERIODS: ReadonlyArray<readonly [string, string]> = [
  ['', 'За всё время'],
  ['24', 'За сутки'],
  ['168', 'За неделю'],
  ['720', 'За 30 дней'],
];

/** Максимум, который допускает `adminJobFilterSchema`: постраничность ниже — на клиенте. */
const FETCH_LIMIT = 200;
const PAGE_SIZE = 20;

type JobRow = AdminJob;

/**
 * Очередь фоновой обработки.
 *
 * Строка содержит идентификатор, код организации, код случая, тип, число
 * попыток, время постановки в очередь и код ошибки. Полезная нагрузка, ответы
 * участников и тексты заключений на этот экран не попадают (ТЗ A09).
 */
export function JobsPanel({ facets }: { facets: AdminOperationsFacets | null }) {
  const [eventType, setEventType] = useState('');
  const [state, setState] = useState('');
  const [periodHours, setPeriodHours] = useState('');
  const [organizationCode, setOrganizationCode] = useState('');
  const [page, setPage] = useState(1);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const detailsTriggerRef = useRef<HTMLElement | null>(null);

  const query = new URLSearchParams({ limit: String(FETCH_LIMIT) });
  if (eventType) query.set('eventType', eventType);
  if (state) query.set('state', state);
  if (periodHours) query.set('periodHours', periodHours);
  if (organizationCode) query.set('organizationCode', organizationCode);

  const list = useApiQuery<Envelope<JobRow[]>>(
    ['admin-jobs', eventType, state, periodHours, organizationCode],
    `/admin/jobs?${query.toString()}`,
    { keepPreviousData: true },
  );
  const allRows = list.data?.data ?? [];
  const total = allRows.length;
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const detailsQuery = useApiQuery<Envelope<AdminJobDetails>>(
    ['admin-job-details', selectedJobId],
    selectedJobId ? `/admin/jobs/${selectedJobId}` : null,
  );
  const details = detailsQuery.data?.data ?? null;

  const retryMutation = useApiMutation<string, Envelope<AdminJobDetails>>(
    (jobId) => api.post<Envelope<AdminJobDetails>>(`/admin/jobs/${jobId}/retry`),
    {
      invalidate: [['admin-jobs'], ['admin-job-details']],
      onSuccess: () => {
        notify.success('Задание возвращено в очередь');
        setPendingJobId(null);
      },
      onError: (error) => {
        setPendingJobId(null);
        if (error) {
          notify.error(error.problem.title, { requestId: error.problem.requestId });
        }
      },
    },
  );

  const retriesMutation = useApiMutation<
    { jobId: string; stopped: boolean },
    Envelope<AdminJobDetails>
  >(
    ({ jobId, stopped }) =>
      api.post<Envelope<AdminJobDetails>>(`/admin/jobs/${jobId}/retries`, { stopped }),
    {
      invalidate: [['admin-jobs'], ['admin-job-details']],
      onSuccess: (_result, variables) => {
        notify.success(variables.stopped ? 'Повторы остановлены' : 'Повторы снова разрешены');
        setPendingJobId(null);
      },
      onError: (error) => {
        setPendingJobId(null);
        if (error) {
          notify.error(error.problem.title, { requestId: error.problem.requestId });
        }
      },
    },
  );

  function resetPage(): void {
    setPage(1);
  }

  /**
   * Панель открывается по клику на разные элементы строки (кнопка первой
   * колонки, пункт меню действий), а не через `Dialog.Trigger`, поэтому
   * запоминаем элемент, у которого фокус на момент клика, и возвращаем
   * фокус туда при закрытии.
   */
  function openDetails(jobId: string): void {
    detailsTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedJobId(jobId);
  }

  function retry(jobId: string): void {
    setPendingJobId(jobId);
    retryMutation.mutate(jobId);
  }

  function setRetries(jobId: string, stopped: boolean): void {
    setPendingJobId(jobId);
    retriesMutation.mutate({ jobId, stopped });
  }

  function rowMenuItems(job: JobRow): ActionMenuItem[] {
    const busy = pendingJobId === job.id;
    const items: ActionMenuItem[] = [
      {
        id: 'details',
        label: 'Технические детали',
        icon: <ScrollText aria-hidden="true" strokeWidth={1.75} />,
        onSelect: () => openDetails(job.id),
      },
      {
        id: 'retry',
        label: 'Повторить допустимую ошибку',
        icon: <ListRestart aria-hidden="true" strokeWidth={1.75} />,
        disabled: !job.retryable || busy,
        onSelect: () => retry(job.id),
      },
    ];
    if (job.state === 'stopped') {
      items.push({
        id: 'resume',
        label: 'Разрешить повторы',
        icon: <PlayCircle aria-hidden="true" strokeWidth={1.75} />,
        disabled: busy,
        onSelect: () => setRetries(job.id, false),
      });
    } else {
      items.push({
        id: 'stop',
        label: 'Остановить будущие повторы',
        icon: <OctagonPause aria-hidden="true" strokeWidth={1.75} />,
        disabled: busy,
        onSelect: () => setRetries(job.id, true),
      });
    }
    return items;
  }

  const columns: ReadonlyArray<Column<JobRow>> = [
    {
      key: 'job',
      header: 'Задание',
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-[var(--text-primary)]">{row.eventType}</span>
          <span className="truncate font-mono text-xs text-[var(--text-secondary)]">{row.id}</span>
        </span>
      ),
    },
    {
      key: 'tenant',
      header: 'Организация',
      render: (row) => row.organizationCode ?? 'Платформа',
    },
    {
      key: 'assignment',
      header: 'Код случая',
      hideOnMobile: true,
      render: (row) => row.assignmentCode ?? '—',
    },
    {
      key: 'attempts',
      header: 'Попыток',
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.attempts}</span>,
    },
    {
      key: 'queued',
      header: 'В очереди с',
      hideOnMobile: true,
      nowrap: true,
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'latency',
      header: 'Задержка',
      hideOnMobile: true,
      align: 'right',
      render: (row) => (row.latencyMs !== null ? formatLatency(row.latencyMs) : '—'),
    },
    {
      key: 'error',
      header: 'Код ошибки',
      render: (row) => (row.lastErrorCode ? <Badge tone="danger">{row.lastErrorCode}</Badge> : '—'),
    },
    {
      key: 'state',
      header: 'Статус',
      render: (row) => <Badge tone={STATE_TONES[row.state]}>{STATE_LABELS[row.state]}</Badge>,
    },
    {
      key: 'actions',
      header: 'Действия',
      align: 'right',
      className: 'w-14',
      render: (row) => (
        <ActionMenu label={`Действия с заданием ${row.eventType}`} items={rowMenuItems(row)} />
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Очередь обработки"
        description="Состояние выводится из отметок самого задания. Задержка измеряется, а не оценивается."
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Тип события">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={eventType}
                onChange={(event) => {
                  resetPage();
                  setEventType(event.target.value);
                }}
              >
                <option value="">Любой</option>
                {(facets?.eventTypes ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Состояние">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={state}
                onChange={(event) => {
                  resetPage();
                  setState(event.target.value);
                }}
              >
                <option value="">Любое</option>
                {JOB_STATES.map((value) => (
                  <option key={value} value={value}>
                    {STATE_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Период">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={periodHours}
                onChange={(event) => {
                  resetPage();
                  setPeriodHours(event.target.value);
                }}
              >
                {PERIODS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Организация">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={organizationCode}
                onChange={(event) => {
                  resetPage();
                  setOrganizationCode(event.target.value);
                }}
              >
                <option value="">Любая</option>
                {(facets?.organizationCodes ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {list.error && !list.data ? (
          <ErrorState
            title="Не удалось загрузить очередь"
            description="Проверьте подключение и повторите попытку."
            requestId={list.error.problem.requestId}
            onRetry={() => list.refetch()}
          />
        ) : (
          <>
            <DataTable
              rows={rows}
              columns={columns}
              caption="Очередь фоновой обработки"
              loading={list.isLoading}
              onRowOpen={(row) => openDetails(row.id)}
              emptyState={
                <EmptyState
                  title="Заданий нет"
                  description="По выбранным условиям в журнале обработки ничего не нашлось."
                />
              }
            />
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </>
        )}
      </CardBody>

      <DetailDrawer
        open={selectedJobId !== null}
        onOpenChange={(next) => {
          if (!next) {
            setSelectedJobId(null);
          }
        }}
        title="Техническая карточка задания"
        description="Значения полезной нагрузки не показываются: перечисляются только имена полей."
        returnFocusRef={detailsTriggerRef}
      >
        {detailsQuery.error ? (
          <ErrorState
            title="Не удалось загрузить карточку задания"
            requestId={detailsQuery.error.problem.requestId}
            onRetry={() => detailsQuery.refetch()}
          />
        ) : !details ? (
          <LoadingBlock label="Загружаем техническую карточку" />
        ) : (
          <div className="flex flex-col gap-6 text-sm">
            <KeyValueList
              columns={2}
              items={[
                {
                  label: 'Идентификатор',
                  value: <code className="text-xs break-all">{details.job.id}</code>,
                },
                { label: 'Событие', value: details.job.eventType },
                { label: 'Очередь', value: details.queueName ?? 'не доставляется' },
                {
                  label: 'Объект',
                  value: (
                    <code className="text-xs break-all">
                      {details.job.entityType} {details.entityId}
                    </code>
                  ),
                },
                { label: 'Организация', value: details.job.organizationCode ?? 'платформа' },
                { label: 'Код случая', value: details.job.assignmentCode ?? '—' },
                {
                  label: 'Состояние',
                  value: (
                    <Badge tone={STATE_TONES[details.job.state]}>
                      {STATE_LABELS[details.job.state]}
                    </Badge>
                  ),
                },
                { label: 'Попыток', value: details.job.attempts },
                { label: 'Поколение данных', value: details.dataGeneration },
                { label: 'Создано', value: formatDateTime(details.job.createdAt) },
                {
                  label: 'Доставлено',
                  value: details.job.publishedAt ? formatDateTime(details.job.publishedAt) : '—',
                },
                {
                  label: 'Завершено',
                  value: details.job.completedAt
                    ? formatDateTime(details.job.completedAt)
                    : details.job.failedAt
                      ? formatDateTime(details.job.failedAt)
                      : '—',
                },
                {
                  label: 'Задержка',
                  value:
                    details.job.latencyMs !== null ? formatLatency(details.job.latencyMs) : '—',
                },
                { label: 'Код ошибки', value: details.job.lastErrorCode ?? '—' },
                {
                  label: 'Повтор',
                  value: details.retriedAt ? formatDateTime(details.retriedAt) : 'не запускался',
                },
              ]}
            />

            <div>
              <p className="mb-2 text-[13px] font-medium text-[var(--text-secondary)]">
                Поля полезной нагрузки
              </p>
              {details.payloadKeys.length === 0 ? (
                <p className="text-sm">Полезной нагрузки нет.</p>
              ) : (
                <ul className="flex list-none flex-wrap gap-2 p-0">
                  {details.payloadKeys.map((key) => (
                    <li key={key}>
                      <Badge tone="neutral">{key}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Значения остаются на сервере: технический экран не является способом прочитать
                данные организации.
              </p>
            </div>

            {details.retryBlockers.length > 0 ? (
              <Callout tone="warning" title="Повтор сейчас невозможен">
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {details.retryBlockers.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button
                variant="primary"
                loading={pendingJobId === details.job.id && retryMutation.isPending}
                disabled={details.retryBlockers.length > 0}
                disabledReason={details.retryBlockers[0] ?? undefined}
                onClick={() => retry(details.job.id)}
              >
                Повторить
              </Button>

              {details.retriesStoppedAt ? (
                <Button
                  variant="secondary"
                  loading={pendingJobId === details.job.id && retriesMutation.isPending}
                  onClick={() => setRetries(details.job.id, false)}
                >
                  Разрешить повторы
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  loading={pendingJobId === details.job.id && retriesMutation.isPending}
                  onClick={() => setRetries(details.job.id, true)}
                >
                  Остановить повторы
                </Button>
              )}
            </div>
          </div>
        )}
      </DetailDrawer>
    </Card>
  );
}

/** Измеренная задержка: миллисекунды для быстрых заданий, секунды для остальных. */
function formatLatency(ms: number): string {
  if (ms < 1000) {
    return `${ms} мс`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} с`;
  }
  return `${Math.round(ms / 60_000)} мин`;
}
