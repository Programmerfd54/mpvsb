'use client';

import type { EmployeeAssessment, EmployeeProfile, Envelope } from '@context/contracts';

import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { useApiQuery } from '@/lib/query';
import { AssessmentCard } from './_components/assessment-card';

export default function EmployeeHomePage() {
  const profile = useApiQuery<Envelope<EmployeeProfile>>(
    ['employee', 'profile'],
    '/employee/profile',
  );
  const assessments = useApiQuery<Envelope<EmployeeAssessment[]>>(
    ['employee', 'assessments'],
    '/employee/assessments',
  );
  const error = profile.error ?? assessments.error;
  if (error)
    return (
      <ErrorState
        title={error.status === 403 ? 'Доступ к кабинету закрыт' : error.problem.title}
        requestId={error.problem.requestId}
        onRetry={() => {
          void profile.refetch();
          void assessments.refetch();
        }}
      />
    );
  if (!profile.data || !assessments.data)
    return <PageSkeleton variant="dashboard" label="Загружаем кабинет" />;

  const list = assessments.data.data;
  const primary = list.find((item) => item.canOpen) ?? null;
  const rest = primary
    ? list.filter((item) => item.id !== primary.id).slice(0, 3)
    : list.slice(0, 3);
  return (
    <>
      <PageHeader
        title={`Здравствуйте, ${profile.data.data.displayName}`}
        description="Здесь находятся только ваши оценки и их текущее состояние."
      />
      <div className="flex flex-col gap-6">
        {primary ? (
          <AssessmentCard assessment={primary} primary />
        ) : (
          <EmptyState
            title="Новых оценок нет"
            description={
              profile.data.data.organizationContact
                ? `По вопросам можно обратиться: ${profile.data.data.organizationContact}`
                : 'Когда руководитель назначит оценку, она появится здесь.'
            }
          />
        )}
        {rest.length ? (
          <section>
            <h2 className="mb-3 text-lg font-semibold">Остальные оценки</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {rest.map((item) => (
                <AssessmentCard key={item.id} assessment={item} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
