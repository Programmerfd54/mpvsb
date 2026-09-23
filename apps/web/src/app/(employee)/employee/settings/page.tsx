'use client';

import type { EmployeeProfile, Envelope } from '@context/contracts';

import { ChangePasswordCard } from '@/app/(manager)/app/profile/_components/change-password-card';
import { SessionsCard } from '@/app/(manager)/app/profile/_components/sessions-card';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KeyValueList } from '@/components/ui/data-list';
import { Callout, ErrorState, PageSkeleton } from '@/components/ui/states';
import { useApiQuery } from '@/lib/query';

export default function EmployeeSettingsPage() {
  const query = useApiQuery<Envelope<EmployeeProfile>>(
    ['employee', 'profile'],
    '/employee/profile',
  );
  if (query.error)
    return (
      <ErrorState
        title={query.error.problem.title}
        requestId={query.error.problem.requestId}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <PageSkeleton variant="form" label="Загружаем настройки" />;
  const profile = query.data.data;
  return (
    <>
      <PageHeader title="Настройки" description="Ваши данные, пароль и активные сессии." />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Профиль сотрудника" />
          <CardBody>
            <KeyValueList
              columns={2}
              items={[
                { label: 'ФИО', value: profile.displayName },
                { label: 'Должность', value: profile.jobTitle ?? 'Не указана' },
                { label: 'Подразделение', value: profile.departmentName ?? 'Не назначено' },
                { label: 'Рабочая почта', value: profile.email ?? 'Не указана' },
              ]}
            />
          </CardBody>
        </Card>
        <Callout tone="info" title="Как исправить данные">
          ФИО, должность и подразделение изменяет администратор пространства.
          {profile.organizationContact ? ` Контакт: ${profile.organizationContact}.` : ''}
        </Callout>
        <ChangePasswordCard />
        <SessionsCard />
      </div>
    </>
  );
}
