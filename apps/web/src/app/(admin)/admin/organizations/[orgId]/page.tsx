'use client';

import {
  Ban,
  Building2,
  CircleCheck,
  Construction,
  FolderLock,
  Lock,
  Play,
  ScrollText,
  UserCog,
} from 'lucide-react';
import { use, useRef, useState } from 'react';

import type {
  AdminAuditEvent,
  AdminOrganization,
  Envelope,
  ReadinessCheck,
} from '@context/contracts';
import { READINESS_STATES } from '@context/domain';

import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { KeyValueList, Timeline } from '@/components/ui/data-list';
import { Field, Select, TextArea } from '@/components/ui/field';
import { Tabs, TabPanel, type TabItem } from '@/components/ui/tabs';
import {
  Callout,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageSkeleton,
} from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { formatDateTime } from '@/lib/format';

import {
  AUDIT_OUTCOME_LABELS,
  ORG_AUDIT_ACTION_LABELS,
  ORG_MODE_LABELS,
  READINESS_STATE_LABELS,
} from '../../_lib/labels';

type OrgTab = 'details' | 'access' | 'readiness' | 'data' | 'log';

const READINESS_BADGE_TONE: Record<ReadinessCheck['state'], 'success' | 'warning' | 'neutral'> = {
  verified: 'success',
  pending: 'warning',
  not_applicable: 'neutral',
};

export default function AdminOrganizationPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);

  const organizationQuery = useApiQuery<Envelope<AdminOrganization>>(
    ['admin', 'organization', orgId],
    `/admin/organizations/${orgId}`,
  );
  const readinessQuery = useApiQuery<Envelope<ReadinessCheck[]>>(
    ['admin', 'organization', orgId, 'readiness'],
    `/admin/organizations/${orgId}/readiness`,
  );

  const [tab, setTab] = useState<OrgTab>('details');
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState('');
  const suspendTriggerRef = useRef<HTMLButtonElement | null>(null);

  const suspendMutation = useApiMutation<string, Envelope<AdminOrganization>>(
    (suspendReason) =>
      api.post<Envelope<AdminOrganization>>(`/admin/organizations/${orgId}/suspend`, {
        reason: suspendReason,
      }),
    {
      invalidate: [
        ['admin', 'organization', orgId],
        ['admin', 'organizations'],
      ],
      onSuccess: () => {
        notify.success('Организация приостановлена');
        setSuspendOpen(false);
        setReason('');
      },
      onError: (error) => {
        if (error) {
          notify.error(error.problem.title, { requestId: error.problem.requestId });
        }
      },
    },
  );

  const resumeMutation = useApiMutation<void, Envelope<AdminOrganization>>(
    () => api.post<Envelope<AdminOrganization>>(`/admin/organizations/${orgId}/resume`),
    {
      invalidate: [
        ['admin', 'organization', orgId],
        ['admin', 'organizations'],
      ],
      onSuccess: () => notify.success('Организация возобновлена'),
      onError: (error) => {
        if (error) {
          notify.error(error.problem.title, { requestId: error.problem.requestId });
        }
      },
    },
  );

  const readinessMutation = useApiMutation<
    { key: string; state: string },
    Envelope<ReadinessCheck[]>
  >(
    ({ key, state }) =>
      api.patch<Envelope<ReadinessCheck[]>>(`/admin/organizations/${orgId}/readiness`, {
        key,
        state,
      }),
    {
      invalidate: [
        ['admin', 'organization', orgId, 'readiness'],
        ['admin', 'organization', orgId],
      ],
      onSuccess: () => notify.success('Пункт готовности обновлён'),
      onError: (error) => {
        if (error) {
          notify.error(error.problem.title, { requestId: error.problem.requestId });
        }
      },
    },
  );

  const organization = organizationQuery.data?.data;

  const auditQuery = useApiQuery<Envelope<AdminAuditEvent[]>>(
    organization ? ['admin', 'audit', 'org', organization.code] : ['admin', 'audit', 'org', orgId],
    organization
      ? `/admin/audit?organizationCode=${encodeURIComponent(organization.code)}&limit=50`
      : null,
  );

  if (organizationQuery.error) {
    const notFound = organizationQuery.error.status === 404;
    return (
      <ErrorState
        title={notFound ? 'Организация не найдена' : organizationQuery.error.problem.title}
        description={
          notFound
            ? 'Проверьте ссылку или вернитесь к списку организаций.'
            : 'Проверьте подключение и повторите попытку.'
        }
        requestId={organizationQuery.error.problem.requestId}
        onRetry={notFound ? undefined : organizationQuery.refetch}
        action={
          <ButtonLink href="/admin/organizations" variant="secondary" size="sm">
            К списку организаций
          </ButtonLink>
        }
      />
    );
  }

  if (!organization) {
    return <PageSkeleton variant="detail" label="Загружаем организацию" />;
  }

  const allVerified = organization.readinessVerified === organization.readinessTotal;
  const unresolvedReadiness = organization.readinessTotal - organization.readinessVerified;

  const tabItems: readonly TabItem[] = [
    { value: 'details', label: 'Сведения' },
    { value: 'access', label: 'Доступы' },
    {
      value: 'readiness',
      label: 'Готовность к запуску',
      count: unresolvedReadiness > 0 ? unresolvedReadiness : undefined,
    },
    { value: 'data', label: 'Данные' },
    { value: 'log', label: 'Журнал' },
  ];

  return (
    <>
      <PageHeader
        title={organization.name}
        description={`Код ${organization.code} · часовой пояс ${organization.timezone} · создана ${formatDateTime(organization.createdAt)}`}
        breadcrumbs={[
          { label: 'Организации', href: '/admin/organizations' },
          { label: organization.name },
        ]}
        action={
          organization.status === 'active' ? (
            <Button
              ref={suspendTriggerRef}
              variant="destructive"
              icon={<Ban aria-hidden="true" />}
              onClick={() => setSuspendOpen(true)}
            >
              Приостановить
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<Play aria-hidden="true" />}
              loading={resumeMutation.isPending}
              onClick={() => resumeMutation.mutate()}
            >
              Возобновить
            </Button>
          )
        }
      />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as OrgTab)}
        items={tabItems}
        label="Разделы организации"
      >
        <TabPanel value="details">
          <Card>
            <CardHeader
              icon={<Building2 aria-hidden="true" strokeWidth={1.75} />}
              title="Сведения"
              description="Только технические параметры организации."
            />
            <CardBody className="flex flex-col gap-5">
              <KeyValueList
                columns={2}
                items={[
                  {
                    label: 'Состояние',
                    value:
                      organization.status === 'active' ? (
                        <Badge tone="success">Активна</Badge>
                      ) : (
                        <Badge tone="danger">Приостановлена</Badge>
                      ),
                  },
                  {
                    label: 'Режим',
                    value: (
                      <Badge tone={organization.mode === 'validated_use' ? 'success' : 'info'}>
                        {ORG_MODE_LABELS[organization.mode] ?? organization.mode}
                      </Badge>
                    ),
                  },
                  { label: 'Часовой пояс', value: organization.timezone },
                  { label: 'Создана', value: formatDateTime(organization.createdAt) },
                  { label: 'Руководителей', value: organization.counts.managers },
                  { label: 'Сотрудников', value: organization.counts.employees },
                  { label: 'Активных оценок', value: organization.counts.activeAssignments },
                  { label: 'Заключений в работе', value: organization.counts.pendingReports },
                  { label: 'Лимит сотрудников', value: organization.activeEmployeeLimit },
                ]}
              />

              <Callout tone="neutral" icon={<Lock aria-hidden="true" strokeWidth={1.75} />}>
                Список сотрудников и содержание оценок этой организации администратору недоступны:
                для них нужен отдельный временный доступ с указанием цели и срока.
              </Callout>
            </CardBody>
          </Card>
        </TabPanel>

        <TabPanel value="access">
          <Card>
            <CardHeader
              icon={<UserCog aria-hidden="true" strokeWidth={1.75} />}
              tint="neutral"
              title="Доступы руководителей"
              description="Приглашения, отзыв доступа, права руководителей и очередь восстановления доступа."
            />
            <CardBody>
              <Callout
                tone="neutral"
                icon={<Construction aria-hidden="true" strokeWidth={1.75} />}
                title="Раздел ещё не подключён к API"
              >
                <p>
                  Действующий API администратора отдаёт по организации только список, создание,
                  приостановку, возобновление и готовность к запуску. Управление приглашениями
                  руководителей, отзыв доступа и прав, а также очередь запросов на восстановление
                  доступа (описаны в ТЗ, раздел «Администратор», A03) пока не имеют серверных
                  эндпоинтов — показать здесь реальные данные без их выдумывания невозможно.
                </p>
                <p className="mt-2">
                  Это ограничение только этого раздела: остальные вкладки организации и список
                  организаций работают на реальных данных.
                </p>
              </Callout>
            </CardBody>
          </Card>
        </TabPanel>

        <TabPanel value="readiness">
          <Card>
            <CardHeader
              icon={<CircleCheck aria-hidden="true" strokeWidth={1.75} />}
              tint={allVerified ? 'success' : 'warning'}
              title="Готовность к реальным оценкам"
              description="Отметка фиксирует состояние пункта на момент проверки. Она не заменяет правовую и методическую оценку."
            />
            <CardBody className="flex flex-col gap-4">
              <Badge tone={allVerified ? 'success' : 'warning'}>
                {allVerified ? 'Все пункты закрыты' : `Не закрыто пунктов: ${unresolvedReadiness}`}
              </Badge>

              {readinessQuery.error ? (
                <ErrorState
                  title="Не удалось загрузить пункты готовности"
                  requestId={readinessQuery.error.problem.requestId}
                  onRetry={readinessQuery.refetch}
                />
              ) : !readinessQuery.data ? (
                <LoadingBlock label="Загружаем пункты готовности" />
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {readinessQuery.data.data.map((check) => (
                    <li
                      key={check.key}
                      className="flex flex-col gap-3 rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-4 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-[var(--text-primary)]">
                            {check.label}
                          </p>
                          <Badge tone={READINESS_BADGE_TONE[check.state]}>
                            {READINESS_STATE_LABELS[check.state]}
                          </Badge>
                        </div>
                        {check.note ? (
                          <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                            {check.note}
                          </p>
                        ) : null}
                        {check.verifiedAt ? (
                          <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                            Отмечено {formatDateTime(check.verifiedAt)}
                          </p>
                        ) : null}
                      </div>
                      <label className="flex shrink-0 items-center gap-2">
                        <span className="sr-only">Состояние пункта «{check.label}»</span>
                        <Select
                          value={check.state}
                          disabled={readinessMutation.isPending}
                          onChange={(event) =>
                            readinessMutation.mutate({ key: check.key, state: event.target.value })
                          }
                          wrapperClassName="w-full sm:w-52"
                        >
                          {READINESS_STATES.map((state) => (
                            <option key={state} value={state}>
                              {READINESS_STATE_LABELS[state]}
                            </option>
                          ))}
                        </Select>
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                Кто именно отметил пункт, здесь не показывается: API готовности отдаёт состояние,
                примечание и дату отметки, но не автора.
              </p>
            </CardBody>
          </Card>
        </TabPanel>

        <TabPanel value="data">
          <Card>
            <CardHeader
              icon={<FolderLock aria-hidden="true" strokeWidth={1.75} />}
              tint="neutral"
              title="Данные организации"
              description="Задания на удаление и экспорт, временный доступ администратора к содержанию."
            />
            <CardBody>
              <Callout
                tone="neutral"
                icon={<Construction aria-hidden="true" strokeWidth={1.75} />}
                title="Раздел ещё не подключён к API"
              >
                <p>
                  По ТЗ здесь должны быть задания на удаление и экспорт данных организации со
                  сроками и статусом, а также форма «Запросить временный доступ» (причина, цель,
                  срок; выдаёт уполномоченный владелец организации). Соответствующие эндпоинты
                  администратора сейчас не реализованы — эта часть делается отдельной задачей на
                  стороне backend. Пока показывать здесь нечего: ни фиктивных заданий, ни
                  неработающей формы.
                </p>
              </Callout>
            </CardBody>
          </Card>
        </TabPanel>

        <TabPanel value="log">
          <Card>
            <CardHeader
              icon={<ScrollText aria-hidden="true" strokeWidth={1.75} />}
              title="Журнал"
              description="Действия администратора и системы, связанные с этой организацией."
            />
            <CardBody>
              {auditQuery.error ? (
                <ErrorState
                  title="Не удалось загрузить журнал"
                  requestId={auditQuery.error.problem.requestId}
                  onRetry={auditQuery.refetch}
                />
              ) : !auditQuery.data ? (
                <LoadingBlock label="Загружаем журнал" />
              ) : auditQuery.data.data.length === 0 ? (
                <EmptyState
                  compact
                  icon={<ScrollText aria-hidden="true" strokeWidth={1.75} />}
                  title="Записей пока нет"
                  description="Здесь появятся события этой организации: создание, приостановка, возобновление, изменения готовности."
                />
              ) : (
                <Timeline
                  items={auditQuery.data.data.map((event) => ({
                    id: event.id,
                    at: event.occurredAt,
                    title: ORG_AUDIT_ACTION_LABELS[event.action] ?? event.action,
                    description: [
                      AUDIT_OUTCOME_LABELS[event.outcome] ?? event.outcome,
                      event.resourceType,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    tone:
                      event.outcome === 'success'
                        ? 'success'
                        : event.outcome === 'denied'
                          ? 'warning'
                          : 'danger',
                  }))}
                />
              )}
            </CardBody>
          </Card>
        </TabPanel>
      </Tabs>

      <ConfirmDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        title={`Приостановить «${organization.name}»?`}
        description="Приостановка не удаляет данные и не отменяет уже созданные оценки."
        consequences={[
          'Создание новых назначений станет невозможно.',
          'Опубликованные заключения останутся доступны на чтение.',
          'Возобновить работу можно в любой момент.',
        ]}
        confirmLabel="Приостановить"
        destructive
        loading={suspendMutation.isPending}
        returnFocusRef={suspendTriggerRef}
        onConfirm={() => suspendMutation.mutate(reason)}
      >
        <Field label="Причина" required error={suspendMutation.error?.fieldError('reason')}>
          {({ inputId }) => (
            <TextArea
              id={inputId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              rows={3}
              required
            />
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}
