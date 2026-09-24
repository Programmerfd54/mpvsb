'use client';

import { CheckCircle2, Circle, Play } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

import type {
  EmployeeAssessmentDetail,
  EmployeeParticipationSession,
  Envelope,
} from '@context/contracts';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, ErrorState, PageSkeleton } from '@/components/ui/states';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';

export default function EmployeeAssessmentPage() {
  const assignmentId = useParams<{ assignmentId: string }>().assignmentId;
  const router = useRouter();
  const query = useApiQuery<Envelope<EmployeeAssessmentDetail>>(
    ['employee', 'assessment', assignmentId],
    `/employee/assessments/${assignmentId}`,
  );
  const open = useApiMutation<void, Envelope<EmployeeParticipationSession>>(
    () => api.post(`/employee/assessments/${assignmentId}/open`),
    { onSuccess: (result) => router.push(result.data.nextPath) },
  );
  if (query.error)
    return (
      <ErrorState
        title={query.error.status === 404 ? 'Оценка не найдена' : query.error.problem.title}
        description={
          query.error.status === 404
            ? 'Она не существует или принадлежит другому сотруднику.'
            : undefined
        }
        requestId={query.error.problem.requestId}
        action={<ButtonLink href="/employee/assessments">К списку оценок</ButtonLink>}
        onRetry={query.error.status === 404 ? undefined : () => void query.refetch()}
      />
    );
  if (!query.data) return <PageSkeleton variant="detail" label="Загружаем оценку" />;
  const item = query.data.data;
  return (
    <>
      <PageHeader
        title={item.title}
        description="Цель, этапы и текущее состояние оценки."
        breadcrumbs={[{ label: 'Оценки', href: '/employee/assessments' }, { label: item.title }]}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <Card>
          <CardHeader
            title="Этапы"
            description={`${item.submittedCount} из ${item.methodCount} отправлено`}
          />
          <CardBody className="flex flex-col gap-3">
            {item.stages.map((stage, index) => {
              const done = stage.state === 'submitted' || stage.state === 'scored';
              return (
                <div
                  key={stage.id}
                  className="flex items-start gap-3 rounded-[var(--radius-nested)] bg-[var(--bg-inset)] p-4"
                >
                  {done ? (
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 size-5 text-[var(--success-text)]"
                    />
                  ) : (
                    <Circle
                      aria-hidden="true"
                      className="mt-0.5 size-5 text-[var(--text-tertiary)]"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {index + 1}. {stage.title}
                    </p>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">
                      Отвечено {stage.answeredCount} из {stage.itemCount}
                    </p>
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Состояние" />
            <CardBody className="flex flex-col gap-3">
              <Badge>{item.statusLabel}</Badge>
              <p className="text-sm text-[var(--text-secondary)]">
                {item.dueAt ? `Срок до ${formatDate(item.dueAt)}` : 'Срок не ограничен'}
              </p>
              {item.canOpen ? (
                <Button
                  variant="primary"
                  icon={<Play aria-hidden="true" />}
                  loading={open.isPending}
                  onClick={() => open.mutate()}
                >
                  {item.actionLabel}
                </Button>
              ) : null}
            </CardBody>
          </Card>
          {open.error ? (
            <Callout tone="danger" title="Не удалось открыть оценку">
              {open.error.problem.title}
            </Callout>
          ) : null}
          {item.status === 'submitted' || item.status === 'report_preparing' ? (
            <Callout tone="info" title="Ответы отправлены">
              Результат принят. Заключение готовится без обещания выдуманного срока.
            </Callout>
          ) : null}
          {item.status === 'completed' ? (
            <Callout tone="success" title="Оценка завершена">
              Доступен объём результата, разрешённый условиями участия.
            </Callout>
          ) : null}
        </div>
      </div>
    </>
  );
}
