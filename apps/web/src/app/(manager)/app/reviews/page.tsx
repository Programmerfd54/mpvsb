'use client';

import { ClipboardList } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { Envelope } from '@context/contracts';
import { GENERATION_MODE_LABELS, type GenerationMode } from '@context/domain';

import { Badge } from '@/components/ui/badge';
import { SearchInput, Select } from '@/components/ui/field';
import { Button, ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, ForbiddenState } from '@/components/ui/states';
import { DataTable, type Column } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/manager-shell';
import { formatDateTime } from '@/lib/format';
import { useApiQuery } from '@/lib/query';
import { useSession } from '@/lib/session';

interface PendingReview {
  readonly reportId: string;
  readonly revisionId: string;
  readonly caseCode: string;
  readonly scenarioTitle: string;
  readonly generationMode: GenerationMode;
  readonly createdAt: string;
  readonly evidenceCount: number;
}

type ReviewRow = PendingReview & { readonly id: string };

/**
 * Очередь проверки заключений.
 *
 * В списке используется код случая, а не имя сотрудника: для проверки
 * соответствия текста источникам личность знать не нужно (ТЗ A08).
 */
export default function ReviewsPage() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('oldest');
  const session = useSession();
  const organizationId = session.organization?.organizationId;
  const canReview = session.has('reports.review');

  const { data, error, isLoading, refetch } = useApiQuery<Envelope<PendingReview[]>>(
    ['reviews', organizationId],
    organizationId && canReview ? `/orgs/${organizationId}/reviews` : null,
  );

  const rows: ReviewRow[] = useMemo(
    () => (data?.data ?? []).map((row) => ({ ...row, id: row.reportId })),
    [data],
  );

  if (session.status === 'authenticated' && !canReview) {
    return (
      <ForbiddenState description="Проверка заключений доступна по отдельному разрешению. Обратитесь к владельцу организации." />
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Не удалось загрузить очередь"
        description="Проверьте подключение и повторите попытку."
        requestId={error.problem.requestId}
        onRetry={refetch}
      />
    );
  }

  const filtered = rows
    .filter((row) =>
      `${row.caseCode} ${row.scenarioTitle}`
        .toLocaleLowerCase('ru')
        .includes(query.trim().toLocaleLowerCase('ru')),
    )
    .sort((a, b) =>
      sort === 'oldest'
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    );

  const columns: ReadonlyArray<Column<ReviewRow>> = [
    { key: 'case', header: 'Случай', render: (row) => row.caseCode },
    { key: 'scenario', header: 'Сценарий', render: (row) => row.scenarioTitle },
    {
      key: 'mode',
      header: 'Способ подготовки',
      render: (row) => (
        <Badge tone={row.generationMode === 'fake' ? 'info' : 'neutral'}>
          {GENERATION_MODE_LABELS[row.generationMode]}
        </Badge>
      ),
      hideOnMobile: true,
    },
    {
      key: 'evidence',
      header: 'Источников',
      render: (row) => row.evidenceCount,
      align: 'right',
      nowrap: true,
    },
    {
      key: 'createdAt',
      header: 'Подготовлено',
      render: (row) => formatDateTime(row.createdAt),
      nowrap: true,
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: 'Действия',
      align: 'right',
      render: (row) => (
        <ButtonLink href={`/app/reviews/${row.reportId}`} variant="secondary" size="sm">
          Проверить
        </ButtonLink>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Проверка заключений"
        description="Черновики, ожидающие проверки человеком. Без неё заключение не публикуется."
      />

      <div className="mb-5 flex flex-wrap items-end gap-4 rounded-[var(--radius-panel)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
        <div className="min-w-64 flex-1">
          <SearchInput
            label="Поиск черновика"
            placeholder="Код случая или сценарий"
            value={query}
            onValueChange={setQuery}
          />
        </div>
        <div>
          <label htmlFor="review-sort" className="mb-1 block text-sm font-medium">
            Порядок проверки
          </label>
          <Select id="review-sort" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="oldest">Сначала ожидающие дольше</option>
            <option value="newest">Сначала новые</option>
          </Select>
        </div>
        <p className="pb-3 text-sm text-[var(--text-secondary)]" role="status">
          {isLoading ? 'Загружаем очередь…' : `Найдено ${filtered.length} из ${rows.length}`}
        </p>
      </div>
      <DataTable<ReviewRow>
        rows={filtered}
        columns={columns}
        caption="Черновики заключений на проверке"
        rowHref={(row) => `/app/reviews/${row.reportId}`}
        loading={isLoading}
        emptyState={
          <EmptyState
            icon={<ClipboardList strokeWidth={1.75} />}
            title={
              query.trim() ? 'По вашему запросу ничего не найдено' : 'Черновиков на проверке нет'
            }
            action={
              query.trim() ? (
                <Button onClick={() => setQuery('')}>Сбросить поиск</Button>
              ) : undefined
            }
            description={
              query.trim()
                ? 'Попробуйте другой код случая или название сценария.'
                : 'Новый черновик появится здесь после того, как сотрудник завершит все тесты и система подготовит записку.'
            }
          />
        }
      />
    </>
  );
}
