'use client';

import { useEffect, useState } from 'react';

import type { Envelope, OrganizationSummary, ReadinessSummary } from '@context/contracts';

import type { BadgeTone } from '@/components/ui/badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KeyValueList } from '@/components/ui/data-list';
import { Field, TextInput } from '@/components/ui/field';
import { ErrorState, PageSkeleton } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';

const MODE_LABEL: Record<OrganizationSummary['mode'], string> = {
  demo: 'Демонстрационный',
  research: 'Исследовательский',
  validated_use: 'Проверенное использование',
};

const STATUS_LABEL: Record<OrganizationSummary['status'], string> = {
  active: 'Активна',
  suspended: 'Приостановлена',
};

const STATUS_TONE: Record<OrganizationSummary['status'], BadgeTone> = {
  active: 'success',
  suspended: 'warning',
};

const CHECK_TONE: Record<ReadinessSummary['checks'][number]['state'], BadgeTone> = {
  verified: 'success',
  not_applicable: 'neutral',
  pending: 'warning',
};

const CHECK_LABEL: Record<ReadinessSummary['checks'][number]['state'], string> = {
  verified: 'Подтверждено',
  not_applicable: 'Неприменимо',
  pending: 'Не закрыто',
};

export function OrganizationTab({ organizationId }: { organizationId: string }) {
  const orgQuery = useApiQuery<Envelope<OrganizationSummary>>(
    ['org', organizationId],
    `/orgs/${organizationId}`,
  );
  const readinessQuery = useApiQuery<Envelope<ReadinessSummary>>(
    ['org-readiness', organizationId],
    `/orgs/${organizationId}/readiness`,
  );

  if (orgQuery.error) {
    return (
      <ErrorState
        title="Не удалось загрузить организацию"
        requestId={orgQuery.error.problem.requestId}
        onRetry={orgQuery.refetch}
      />
    );
  }

  if (!orgQuery.data) {
    return <PageSkeleton variant="form" label="Загружаем организацию" />;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <OrganizationForm organization={orgQuery.data.data} />

      <Card>
        <CardHeader title="Сведения" />
        <CardBody>
          <KeyValueList
            columns={2}
            items={[
              { label: 'Код организации', value: <code>{orgQuery.data.data.code}</code> },
              { label: 'Часовой пояс', value: orgQuery.data.data.timezone },
              { label: 'Режим', value: MODE_LABEL[orgQuery.data.data.mode] },
              {
                label: 'Статус',
                value: (
                  <Badge tone={STATUS_TONE[orgQuery.data.data.status]}>
                    {STATUS_LABEL[orgQuery.data.data.status]}
                  </Badge>
                ),
              },
              {
                label: 'Лимит активных сотрудников',
                value: orgQuery.data.data.activeEmployeeLimit,
              },
            ]}
          />
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          title="Готовность к реальным оценкам"
          description="Пока пункты не закрыты, работать можно только с синтетическими участниками."
          action={
            readinessQuery.data ? (
              <Badge tone={readinessQuery.data.data.canRunRealAssessments ? 'success' : 'warning'}>
                {readinessQuery.data.data.canRunRealAssessments ? 'Разрешено' : 'Заблокировано'}
              </Badge>
            ) : undefined
          }
        />
        <CardBody>
          {readinessQuery.error ? (
            <ErrorState
              title="Не удалось загрузить готовность"
              requestId={readinessQuery.error.problem.requestId}
              onRetry={readinessQuery.refetch}
            />
          ) : !readinessQuery.data ? (
            <PageSkeleton variant="form" label="Загружаем готовность" />
          ) : (
            <KeyValueList
              columns={2}
              items={readinessQuery.data.data.checks.map((check) => ({
                label: check.label,
                value: <Badge tone={CHECK_TONE[check.state]}>{CHECK_LABEL[check.state]}</Badge>,
              }))}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function OrganizationForm({ organization }: { organization: OrganizationSummary }) {
  const [name, setName] = useState(organization.name);
  const [contact, setContact] = useState(organization.participantContact ?? '');

  // Поля синхронизируются при обновлении данных с сервера (например, после
  // сохранения из другой вкладки), но не затирают ввод пользователя посреди правки.
  useEffect(() => {
    setName(organization.name);
    setContact(organization.participantContact ?? '');
  }, [organization.id, organization.name, organization.participantContact]);

  const update = useApiMutation<
    { name: string; participantContact: string | null },
    Envelope<OrganizationSummary>
  >((body) => api.patch<Envelope<OrganizationSummary>>(`/orgs/${organization.id}`, body), {
    invalidate: [['org', organization.id]],
    onSuccess: () => notify.success('Настройки сохранены'),
    onError: (error) => {
      if (error && error.problem.fieldErrors.length === 0) {
        notify.error(error.problem.title, { requestId: error.problem.requestId });
      }
    },
  });

  const dirty = name !== organization.name || contact !== (organization.participantContact ?? '');

  return (
    <Card>
      <CardHeader
        title="Организация"
        description="Изменения применяются к будущим назначениям. Уже зафиксированные условия участия не переписываются."
      />
      <CardBody>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate({ name, participantContact: contact.trim() || null });
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Название" required error={update.error?.fieldError('name')}>
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                required
                invalid={Boolean(update.error?.fieldError('name'))}
              />
            )}
          </Field>
          <Field
            label="Контакт для участника"
            hint="Виден сотруднику на странице участия. Указывайте общий адрес, а не личные данные."
            error={update.error?.fieldError('participantContact')}
          >
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                maxLength={300}
                invalid={Boolean(update.error?.fieldError('participantContact'))}
              />
            )}
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={update.isPending} disabled={!dirty}>
              Сохранить
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
