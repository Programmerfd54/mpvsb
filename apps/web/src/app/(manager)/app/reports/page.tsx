'use client';

import { FileText } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ListEnvelope, ReportSummary } from '@context/contracts';
import { SCENARIO_CODES, SCENARIO_TITLES } from '@context/domain';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { ActionMenu } from '@/components/ui/menu';
import { EmptyState, ErrorState, ForbiddenState } from '@/components/ui/states';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/manager-shell';
import { formatDateTime } from '@/lib/format';
import { useApiQuery } from '@/lib/query';
import { useSession } from '@/lib/session';

const PAGE_SIZE = 20;

type ReportRow = ReportSummary & { readonly id: string };

/**
 * Список опубликованных заключений.
 *
 * Свободный текстовый поиск и фильтр по датам в спецификации (M08) сейчас
 * нечем подкрепить: у `GET /orgs/:orgId/reports` есть только `scenarioCode`
 * и `employeeId` (см. `apps/api/.../reports.controller.ts`). Придумывать
 * поиск, который фильтрует лишь уже загруженную страницу, значило бы молча
 * прятать часть результатов — вместо этого подключён единственный реальный
 * фильтр, а пробел описан в отчёте о работе.
 */
export default function ReportsPage() {
  const session = useSession();
  const organizationId = session.organization?.organizationId;

  const [page, setPage] = useState(1);
  const [scenarioCode, setScenarioCode] = useState('');

  const path = organizationId
    ? `/orgs/${organizationId}/reports?page=${page}&pageSize=${PAGE_SIZE}${
        scenarioCode ? `&scenarioCode=${scenarioCode}` : ''
      }`
    : null;

  const { data, error, isLoading, refetch } = useApiQuery<ListEnvelope<ReportSummary>>(
    ['reports', organizationId, page, scenarioCode],
    path,
    { keepPreviousData: true },
  );

  const rows: ReportRow[] = useMemo(
    () => (data?.data ?? []).map((report) => ({ ...report, id: report.reportId })),
    [data],
  );
  const total = data?.meta.total ?? 0;

  if (error?.status === 403) {
    return (
      <ForbiddenState description="Просмотр заключений доступен по отдельному разрешению. Обратитесь к владельцу организации." />
    );
  }

  const columns: ReadonlyArray<Column<ReportRow>> = [
    {
      key: 'employee',
      header: 'Сотрудник',
      render: (row) => row.employeeLabel,
    },
    {
      key: 'scenario',
      header: 'Сценарий',
      render: (row) => row.scenarioTitle,
      hideOnMobile: true,
    },
    {
      key: 'support',
      header: 'Достаточность сведений',
      render: (row) => <Badge tone="neutral">{row.supportLevelLabel}</Badge>,
    },
    {
      key: 'flags',
      header: 'Метки',
      render: (row) =>
        row.mode === 'demo' || row.superseded ? (
          <div className="flex flex-wrap gap-1.5">
            {row.mode === 'demo' ? <Badge tone="info">Демонстрация</Badge> : null}
            {row.superseded ? <Badge tone="warning">Заменено</Badge> : null}
          </div>
        ) : (
          <span className="text-[var(--text-tertiary)]">—</span>
        ),
      hideOnMobile: true,
    },
    {
      key: 'published',
      header: 'Опубликовано',
      render: (row) => formatDateTime(row.publishedAt),
      nowrap: true,
      hideOnMobile: true,
    },
    {
      key: 'revision',
      header: 'Версия',
      render: (row) => row.revisionNo,
      align: 'right',
      nowrap: true,
    },
    {
      key: 'actions',
      header: 'Действия',
      align: 'right',
      render: (row) => (
        <ActionMenu
          label={`Действия с заключением: ${row.employeeLabel}`}
          items={[
            { id: 'open', label: 'Открыть', href: `/app/reports/${row.reportId}` },
            {
              id: 'print',
              label: 'Печатная версия',
              href: `/app/reports/${row.reportId}?print=1`,
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Заключения" description="Опубликованные записки по завершённым оценкам." />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex w-full max-w-xs flex-col gap-1.5 text-sm">
          <span className="font-medium text-[var(--text-secondary)]">Сценарий</span>
          <Select
            value={scenarioCode}
            onChange={(event) => {
              setScenarioCode(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Все сценарии</option>
            {SCENARIO_CODES.map((code) => (
              <option key={code} value={code}>
                {SCENARIO_TITLES[code]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {error ? (
        <ErrorState
          title="Не удалось загрузить заключения"
          description="Проверьте подключение и повторите попытку."
          requestId={error.problem.requestId}
          onRetry={refetch}
        />
      ) : (
        <>
          <DataTable<ReportRow>
            rows={rows}
            columns={columns}
            caption="Опубликованные заключения"
            rowHref={(row) => `/app/reports/${row.reportId}`}
            loading={isLoading}
            emptyState={
              <EmptyState
                icon={<FileText strokeWidth={1.75} />}
                title={
                  scenarioCode
                    ? 'По выбранному сценарию заключений нет'
                    : 'Опубликованных заключений пока нет'
                }
                description="Заключение появится здесь после того, как сотрудник завершит тесты и рецензент проверит черновик."
                action={
                  scenarioCode ? (
                    <Button variant="secondary" size="sm" onClick={() => setScenarioCode('')}>
                      Сбросить фильтр
                    </Button>
                  ) : undefined
                }
              />
            }
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
    </>
  );
}
