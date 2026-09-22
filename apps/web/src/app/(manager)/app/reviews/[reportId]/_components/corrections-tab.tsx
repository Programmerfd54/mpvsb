'use client';

import type { CorrectionRequestView, Envelope } from '@context/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
import { useApiQuery } from '@/lib/query';

export function CorrectionsTab({
  organizationId,
  reportId,
}: {
  organizationId: string;
  reportId: string;
}) {
  const requests = useApiQuery<Envelope<CorrectionRequestView[]>>(
    ['review-corrections', organizationId, reportId],
    `/orgs/${organizationId}/reports/${reportId}/corrections`,
    { staleTime: 0 },
  );

  if (requests.error) {
    return (
      <ErrorState
        title={requests.error.problem.title}
        requestId={requests.error.problem.requestId}
        onRetry={requests.refetch}
      />
    );
  }
  if (!requests.data) return <LoadingBlock label="Загружаем запросы на исправление" />;

  return (
    <Card>
      <CardHeader
        title="Запросы на исправление"
        description="Содержание обращений доступно только рецензенту. Изменение заключения оформляется отдельной версией."
      />
      <CardBody className="flex flex-col gap-4">
        <div>
          <Button
            variant="secondary"
            size="sm"
            loading={requests.isFetching}
            onClick={requests.refetch}
          >
            Обновить список
          </Button>
        </div>
        {requests.data.data.length === 0 ? (
          <EmptyState
            compact
            title="Запросов пока нет"
            description="Когда поступит обращение, его содержание появится здесь."
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {requests.data.data.map((request) => (
              <li
                key={request.id}
                className="rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {request.blockLabel ?? 'Заключение в целом'}
                  </p>
                  <Badge tone={request.state === 'received' ? 'warning' : 'neutral'}>
                    {request.stateLabel}
                  </Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                  {request.description}
                </p>
                <p className="mt-3 text-xs text-[var(--text-secondary)]">
                  {request.requesterType === 'manager' ? 'От руководителя' : 'От участника'} ·{' '}
                  {formatDateTime(request.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
