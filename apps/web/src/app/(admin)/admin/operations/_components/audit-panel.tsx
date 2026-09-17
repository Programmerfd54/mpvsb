'use client';

import { useRef, useState } from 'react';

import type {
  AdminAuditDetails,
  AdminAuditEvent,
  AdminOperationsFacets,
  Envelope,
} from '@context/contracts';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KeyValueList } from '@/components/ui/data-list';
import { DetailDrawer } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { useApiQuery } from '@/lib/query';

type AuditOutcome = AdminAuditEvent['outcome'];

const ACTOR_LABELS: Record<string, string> = {
  manager: 'Руководитель',
  platform_admin: 'Администратор платформы',
  participant: 'Участник',
  service: 'Служебный процесс',
};

const OUTCOME_LABELS: Record<AuditOutcome, string> = {
  success: 'Выполнено',
  denied: 'Отказано',
  failed: 'Ошибка',
};

const OUTCOME_TONES: Record<AuditOutcome, BadgeTone> = {
  success: 'success',
  denied: 'warning',
  failed: 'danger',
};

const PERIODS: ReadonlyArray<readonly [string, string]> = [
  ['', 'За всё время'],
  ['24', 'За сутки'],
  ['168', 'За неделю'],
  ['720', 'За 30 дней'],
];

/** Максимум, который допускает `adminAuditFilterSchema`: постраничность ниже — на клиенте. */
const FETCH_LIMIT = 200;
const PAGE_SIZE = 20;

/**
 * Журнал аудита.
 *
 * Фильтр по организации не превращает администратора в читателя персональных
 * сведений: значения скрытых полей не возвращаются, показывается только имя
 * поля (ТЗ A11). Экспорт журнала на этот экран пока не выведен: у API ещё
 * нет соответствующего эндпоинта (см. отчёт по задаче).
 */
export function AuditPanel({ facets }: { facets: AdminOperationsFacets | null }) {
  const [action, setAction] = useState('');
  const [actorType, setActorType] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [organizationCode, setOrganizationCode] = useState('');
  const [periodHours, setPeriodHours] = useState('');
  const [page, setPage] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const detailsTriggerRef = useRef<HTMLElement | null>(null);

  const query = new URLSearchParams({ limit: String(FETCH_LIMIT) });
  if (action) query.set('action', action);
  if (actorType) query.set('actorType', actorType);
  if (resourceType) query.set('resourceType', resourceType);
  if (organizationCode) query.set('organizationCode', organizationCode);
  if (periodHours) query.set('periodHours', periodHours);

  const list = useApiQuery<Envelope<AdminAuditEvent[]>>(
    ['admin-audit', action, actorType, resourceType, organizationCode, periodHours],
    `/admin/audit?${query.toString()}`,
    { keepPreviousData: true },
  );
  const allRows = list.data?.data ?? [];
  const total = allRows.length;
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const detailsQuery = useApiQuery<Envelope<AdminAuditDetails>>(
    ['admin-audit-details', selectedEventId],
    selectedEventId ? `/admin/audit/${selectedEventId}` : null,
  );
  const details = detailsQuery.data?.data ?? null;

  function resetPage(): void {
    setPage(1);
  }

  /**
   * Панель открывается по клику на разные элементы строки, а не через
   * `Dialog.Trigger`, поэтому запоминаем элемент с фокусом на момент клика
   * и возвращаем фокус туда при закрытии.
   */
  function openDetails(eventId: string): void {
    detailsTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedEventId(eventId);
  }

  const columns: ReadonlyArray<Column<AdminAuditEvent>> = [
    {
      key: 'time',
      header: 'Время',
      nowrap: true,
      render: (row) => formatDateTime(row.occurredAt),
    },
    {
      key: 'action',
      header: 'Действие',
      render: (row) => <span className="font-mono text-xs">{row.action}</span>,
    },
    {
      key: 'actor',
      header: 'Кто',
      render: (row) => ACTOR_LABELS[row.actorType] ?? row.actorType,
    },
    {
      key: 'tenant',
      header: 'Организация',
      hideOnMobile: true,
      render: (row) => row.organizationCode ?? 'Платформа',
    },
    {
      key: 'resource',
      header: 'Ресурс',
      hideOnMobile: true,
      render: (row) => row.resourceType ?? '—',
    },
    {
      key: 'outcome',
      header: 'Итог',
      render: (row) => (
        <Badge tone={OUTCOME_TONES[row.outcome]}>{OUTCOME_LABELS[row.outcome]}</Badge>
      ),
    },
    {
      key: 'requestId',
      header: 'Request ID',
      hideOnMobile: true,
      nowrap: true,
      render: (row) => (row.requestId ? <code className="text-xs">{row.requestId}</code> : '—'),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Аудит"
        description="Кто что сделал и чем закончилось. Содержание прочитанного в журнал не записывается."
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Field label="Действие">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={action}
                onChange={(event) => {
                  resetPage();
                  setAction(event.target.value);
                }}
              >
                <option value="">Любое</option>
                {(facets?.actions ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Кто действовал">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={actorType}
                onChange={(event) => {
                  resetPage();
                  setActorType(event.target.value);
                }}
              >
                <option value="">Любой</option>
                {Object.entries(ACTOR_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Тип ресурса">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={resourceType}
                onChange={(event) => {
                  resetPage();
                  setResourceType(event.target.value);
                }}
              >
                <option value="">Любой</option>
                {(facets?.resourceTypes ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
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
        </div>

        {list.error && !list.data ? (
          <ErrorState
            title="Не удалось загрузить журнал"
            description="Проверьте подключение и повторите попытку."
            requestId={list.error.problem.requestId}
            onRetry={() => list.refetch()}
          />
        ) : (
          <>
            <DataTable
              rows={rows}
              columns={columns}
              caption="Журнал аудита"
              loading={list.isLoading}
              onRowOpen={(row) => openDetails(row.id)}
              emptyState={
                <EmptyState
                  title="Записей нет"
                  description="По выбранным условиям в журнале ничего не нашлось."
                />
              }
            />
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </>
        )}
      </CardBody>

      <DetailDrawer
        open={selectedEventId !== null}
        onOpenChange={(next) => {
          if (!next) {
            setSelectedEventId(null);
          }
        }}
        title="Запись аудита"
        description="Метаданные проходят через allowlist: скрытые поля показываются именем, а не значением."
        returnFocusRef={detailsTriggerRef}
      >
        {detailsQuery.error ? (
          <ErrorState
            title="Не удалось загрузить запись"
            requestId={detailsQuery.error.problem.requestId}
            onRetry={() => detailsQuery.refetch()}
          />
        ) : !details ? (
          <LoadingBlock label="Загружаем запись аудита" />
        ) : (
          <div className="flex flex-col gap-6 text-sm">
            <KeyValueList
              columns={2}
              items={[
                { label: 'Когда', value: formatDateTime(details.event.occurredAt) },
                {
                  label: 'Действие',
                  value: <span className="font-mono text-xs">{details.event.action}</span>,
                },
                {
                  label: 'Кто',
                  value: (
                    <>
                      {ACTOR_LABELS[details.event.actorType] ?? details.event.actorType}
                      {details.event.actorId ? (
                        <code className="ml-2 text-xs break-all">{details.event.actorId}</code>
                      ) : null}
                    </>
                  ),
                },
                { label: 'Организация', value: details.event.organizationCode ?? 'платформа' },
                {
                  label: 'Ресурс',
                  value: (
                    <code className="text-xs break-all">
                      {details.event.resourceType ?? '—'} {details.resourceId ?? ''}
                    </code>
                  ),
                },
                {
                  label: 'Итог',
                  value: (
                    <Badge tone={OUTCOME_TONES[details.event.outcome]}>
                      {OUTCOME_LABELS[details.event.outcome]}
                    </Badge>
                  ),
                },
                { label: 'Назначение доступа', value: details.purpose ?? '—' },
                {
                  label: 'Запрос',
                  value: details.event.requestId ? (
                    <code className="text-xs break-all">{details.event.requestId}</code>
                  ) : (
                    '—'
                  ),
                },
              ]}
            />

            <div>
              <p className="mb-2 text-[13px] font-medium text-[var(--text-secondary)]">
                Метаданные
              </p>
              {details.metadata.length === 0 ? (
                <p className="text-sm">Метаданных нет.</p>
              ) : (
                <KeyValueList
                  items={details.metadata.map((item) => ({
                    label: item.key,
                    value: <span className="break-all">{item.value}</span>,
                  }))}
                />
              )}
            </div>

            {details.redactedKeys.length > 0 ? (
              <div className="rounded-[var(--radius-nested)] bg-[var(--bg-inset)] p-4">
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Скрытые поля</p>
                <ul className="mt-2 flex list-none flex-wrap gap-2 p-0">
                  {details.redactedKeys.map((key) => (
                    <li key={key}>
                      <Badge tone="neutral">{key}</Badge>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-[var(--text-secondary)]">
                  Значения этих полей не возвращаются: журнал показывает факт доступа, а не
                  содержание.
                </p>
              </div>
            ) : null}
          </div>
        )}
      </DetailDrawer>
    </Card>
  );
}
