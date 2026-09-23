'use client';

import type { EmployeeAssessment, Envelope } from '@context/contracts';

import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { useApiQuery } from '@/lib/query';
import { AssessmentCard } from '../_components/assessment-card';

export default function EmployeeAssessmentsPage() {
  const query = useApiQuery<Envelope<EmployeeAssessment[]>>(
    ['employee', 'assessments'],
    '/employee/assessments',
  );
  if (query.error)
    return (
      <ErrorState
        title={query.error.problem.title}
        requestId={query.error.problem.requestId}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <PageSkeleton variant="list" label="Загружаем оценки" />;
  return (
    <>
      <PageHeader title="Мои оценки" description="Новые, текущие и завершённые назначения." />
      {query.data.data.length === 0 ? (
        <EmptyState title="Оценок пока нет" description="Назначенные оценки появятся здесь." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {query.data.data.map((item) => (
            <AssessmentCard key={item.id} assessment={item} />
          ))}
        </div>
      )}
    </>
  );
}
