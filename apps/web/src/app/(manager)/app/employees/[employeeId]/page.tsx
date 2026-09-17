'use client';

import {
  Archive,
  CircleCheck,
  ClipboardList,
  FileText,
  Pencil,
  Trash2,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { use, useRef, useState } from 'react';

import type {
  AssignmentSummary,
  EmployeeDetail,
  EmployeeTimelineEntry,
  Envelope,
  ListEnvelope,
  ReportSummary,
} from '@context/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Timeline } from '@/components/ui/data-list';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/menu';
import { FadeIn } from '@/components/ui/motion';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingBlock,
  PageSkeleton,
} from '@/components/ui/states';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { formatDateTime, formatRemaining } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useSession } from '@/lib/session';

import { assignmentTone } from '../../assessments/_components/tone';
import { EmployeeEditor } from '../_components/employee-editor';

type Tab = 'assessments' | 'reports' | 'timeline';
const TABS: readonly Tab[] = ['assessments', 'reports', 'timeline'];

const TIMELINE_TONE: Record<
  EmployeeTimelineEntry['kind'],
  'accent' | 'danger' | 'success' | 'info' | 'warning'
> = {
  assignment_created: 'accent',
  assignment_cancelled: 'danger',
  assignment_completed: 'success',
  report_published: 'info',
  decision_recorded: 'warning',
};

/**
 * Карточка сотрудника.
 *
 * В шапке нет ни балла, ни процента, ни «уровня» человека: платформа не ведёт
 * постоянный профиль. Каждая оценка относится к своему вопросу и своей дате
 * и хранит собственный снимок контекста (ТЗ M04).
 */
export default function EmployeePage({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = use(params);
  const session = useSession();
  const organizationId = session.organization?.organizationId;
  const canManage = session.has('employees.manage');

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(
    initialTab && (TABS as readonly string[]).includes(initialTab)
      ? (initialTab as Tab)
      : 'assessments',
  );

  const [editorOpen, setEditorOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [cancelActive, setCancelActive] = useState(false);
  const menuTriggerRef = useRef<HTMLElement | null>(null);

  const canQuery = Boolean(organizationId && canManage);

  const employeeQuery = useApiQuery<Envelope<EmployeeDetail>>(
    ['employee', organizationId, employeeId],
    canQuery ? `/orgs/${organizationId}/employees/${employeeId}` : null,
  );
  const assignmentsQuery = useApiQuery<ListEnvelope<AssignmentSummary>>(
    ['employee-assignments', organizationId, employeeId],
    canQuery ? `/orgs/${organizationId}/assignments?employeeId=${employeeId}&pageSize=50` : null,
  );
  const reportsQuery = useApiQuery<ListEnvelope<ReportSummary>>(
    ['employee-reports', organizationId, employeeId],
    canQuery ? `/orgs/${organizationId}/reports?employeeId=${employeeId}&pageSize=50` : null,
  );
  const timelineQuery = useApiQuery<Envelope<EmployeeTimelineEntry[]>>(
    ['employee-timeline', organizationId, employeeId],
    canQuery ? `/orgs/${organizationId}/employees/${employeeId}/timeline` : null,
  );

  const archiveMutation = useApiMutation<
    { cancelActiveAssignments: boolean },
    Envelope<{ archived: boolean; cancelledAssignments: number }>
  >(
    ({ cancelActiveAssignments }) =>
      api.post(`/orgs/${organizationId}/employees/${employeeId}/archive`, {
        cancelActiveAssignments,
      }),
    {
      invalidate: [
        ['employee', organizationId, employeeId],
        ['employees', organizationId],
        ['employee-timeline', organizationId, employeeId],
      ],
      onSuccess: (result) => {
        notify.success(
          result.data.cancelledAssignments > 0
            ? `Сотрудник в архиве. Отменено оценок: ${result.data.cancelledAssignments}.`
            : 'Сотрудник переведён в архив',
        );
        setArchiveOpen(false);
        setCancelActive(false);
      },
      onError: (apiError) => {
        if (apiError) {
          notify.error(apiError.problem.title, { requestId: apiError.problem.requestId });
        }
      },
    },
  );

  function changeTab(next: string): void {
    setTab(next as Tab);
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'assessments') {
      params.delete('tab');
    } else {
      params.set('tab', next);
    }
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  function captureMenuTrigger(): void {
    menuTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  if (session.status === 'authenticated' && !canManage) {
    return (
      <ForbiddenState description="Карточка сотрудника доступна по отдельному разрешению. Обратитесь к владельцу организации." />
    );
  }

  if (employeeQuery.error) {
    const notFound = employeeQuery.error.status === 404;
    return (
      <ErrorState
        title={notFound ? 'Сотрудник не найден' : 'Не удалось загрузить карточку'}
        description={
          notFound
            ? 'Возможно, запись относится к другой организации или была удалена.'
            : 'Проверьте подключение и повторите попытку.'
        }
        requestId={employeeQuery.error.problem.requestId}
        onRetry={notFound ? undefined : employeeQuery.refetch}
      />
    );
  }

  if (employeeQuery.isLoading || !employeeQuery.data) {
    return <PageSkeleton variant="detail" label="Загружаем карточку сотрудника" />;
  }

  const employee = employeeQuery.data.data;
  const label = employee.displayName ?? employee.externalCode ?? 'Без имени';
  const assignments = assignmentsQuery.data?.data ?? [];
  const reports = reportsQuery.data?.data ?? [];
  const timeline = timelineQuery.data?.data ?? [];
  const activeCount = assignments.filter(
    (item) => item.state === 'invited' || item.state === 'in_progress' || item.state === 'draft',
  ).length;

  const menuItems: ActionMenuItem[] = [
    {
      id: 'edit',
      label: 'Редактировать',
      icon: <Pencil aria-hidden="true" />,
      onSelect: () => {
        captureMenuTrigger();
        setEditorOpen(true);
      },
    },
  ];
  if (employee.archivedAt === null) {
    menuItems.push({
      id: 'archive',
      label: 'Архивировать',
      icon: <Archive aria-hidden="true" />,
      destructive: true,
      onSelect: () => {
        captureMenuTrigger();
        setArchiveOpen(true);
      },
    });
  }
  menuItems.push({
    id: 'erase',
    label: 'Запросить удаление данных — пока недоступно',
    icon: <Trash2 aria-hidden="true" />,
    disabled: true,
    separatorBefore: true,
  });

  return (
    <>
      <PageHeader
        title={label}
        description={
          [employee.jobTitle, employee.department].filter(Boolean).join(' · ') ||
          'Должность не указана'
        }
        breadcrumbs={[{ label: 'Сотрудники', href: '/app/employees' }, { label }]}
        meta={
          <>
            {employee.archivedAt ? (
              <Badge tone="neutral">В архиве с {formatDateTime(employee.archivedAt)}</Badge>
            ) : (
              <Badge tone="success">Активен</Badge>
            )}
            {employee.externalCode ? (
              <Badge tone="neutral">Код {employee.externalCode}</Badge>
            ) : null}
            <Badge tone="accent">Активных оценок: {activeCount}</Badge>
          </>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={<UserPlus aria-hidden="true" />}
              onClick={() => router.push('/app/assessments/new')}
              disabled={employee.archivedAt !== null}
              disabledReason={employee.archivedAt !== null ? 'Сотрудник в архиве' : undefined}
            >
              Назначить оценку
            </Button>
            <ActionMenu label={`Действия с сотрудником «${label}»`} items={menuItems} />
          </div>
        }
      />

      <Tabs
        value={tab}
        onValueChange={changeTab}
        label="Разделы карточки сотрудника"
        items={[
          { value: 'assessments', label: 'Оценки', count: assignments.length },
          { value: 'reports', label: 'Заключения', count: reports.length },
          { value: 'timeline', label: 'История действий' },
        ]}
      >
        <TabPanel value="assessments">
          <FadeIn>
            <Card>
              <CardHeader
                title="Оценки"
                description="Каждая оценка относится к своему вопросу и хранит контекст на момент создания."
                icon={<ClipboardList aria-hidden="true" />}
              />
              <CardBody>
                {assignmentsQuery.error ? (
                  <ErrorState
                    title="Не удалось загрузить оценки"
                    requestId={assignmentsQuery.error.problem.requestId}
                    onRetry={assignmentsQuery.refetch}
                  />
                ) : assignmentsQuery.isLoading ? (
                  <LoadingBlock label="Загружаем оценки" />
                ) : assignments.length === 0 ? (
                  <EmptyState
                    compact
                    title="Оценок пока не было"
                    description="Назначьте первую оценку, чтобы увидеть её здесь."
                    icon={<ClipboardList aria-hidden="true" />}
                  />
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {assignments.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-nested)] bg-[var(--bg-inset)] p-3.5"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/app/assessments/${item.id}`}
                            className="text-sm font-semibold text-[var(--text-primary)] no-underline hover:text-[var(--accent)] hover:underline"
                          >
                            {item.scenarioTitle}
                          </Link>
                          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                            Создана {formatDateTime(item.createdAt)} · тестов{' '}
                            {item.attemptsSubmitted} из {item.attemptsTotal}
                            {item.state === 'invited' || item.state === 'in_progress'
                              ? ` · ${formatRemaining(item.dueAt)}`
                              : ''}
                          </p>
                        </div>
                        <Badge tone={assignmentTone(item.state)}>{item.stateLabel}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </FadeIn>
        </TabPanel>

        <TabPanel value="reports">
          <FadeIn>
            <Card>
              <CardHeader
                title="Заключения"
                description="Новый вывод не отменяет предыдущий: история публикаций сохраняется."
                icon={<FileText aria-hidden="true" />}
              />
              <CardBody>
                {reportsQuery.error ? (
                  <ErrorState
                    title="Не удалось загрузить заключения"
                    requestId={reportsQuery.error.problem.requestId}
                    onRetry={reportsQuery.refetch}
                  />
                ) : reportsQuery.isLoading ? (
                  <LoadingBlock label="Загружаем заключения" />
                ) : reports.length === 0 ? (
                  <EmptyState
                    compact
                    title="Опубликованных заключений пока нет"
                    description="Заключение появится здесь после обработки и проверки."
                    icon={<FileText aria-hidden="true" />}
                  />
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {reports.map((report) => (
                      <li
                        key={report.reportId}
                        className="rounded-[var(--radius-nested)] bg-[var(--bg-inset)] p-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Link
                            href={`/app/reports/${report.reportId}`}
                            className="text-sm font-semibold text-[var(--text-primary)] no-underline hover:text-[var(--accent)] hover:underline"
                          >
                            {report.scenarioTitle}
                          </Link>
                          <div className="flex flex-wrap gap-2">
                            {report.superseded ? <Badge tone="warning">Заменено</Badge> : null}
                            <Badge tone="neutral">Версия {report.revisionNo}</Badge>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-[var(--text-secondary)]">
                          Опубликовано {formatDateTime(report.publishedAt)} ·{' '}
                          {report.supportLevelLabel}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </FadeIn>
        </TabPanel>

        <TabPanel value="timeline">
          <FadeIn>
            <Card>
              <CardHeader
                title="История действий"
                description="Что происходило с оценками. Ответы сотрудника и технические поля здесь не показываются."
                icon={<CircleCheck aria-hidden="true" />}
              />
              <CardBody>
                {timelineQuery.error ? (
                  <ErrorState
                    title="Не удалось загрузить историю"
                    requestId={timelineQuery.error.problem.requestId}
                    onRetry={timelineQuery.refetch}
                  />
                ) : timelineQuery.isLoading ? (
                  <LoadingBlock label="Загружаем историю действий" />
                ) : timeline.length === 0 ? (
                  <EmptyState
                    compact
                    title="Событий пока нет"
                    icon={<CircleCheck aria-hidden="true" />}
                  />
                ) : (
                  <Timeline
                    items={timeline.map((entry) => ({
                      id: entry.id,
                      at: entry.occurredAt,
                      title: entry.title,
                      tone: TIMELINE_TONE[entry.kind],
                    }))}
                  />
                )}
              </CardBody>
            </Card>
          </FadeIn>
        </TabPanel>
      </Tabs>

      {organizationId ? (
        <EmployeeEditor
          organizationId={organizationId}
          open={editorOpen}
          employee={employee}
          onOpenChange={setEditorOpen}
          onSaved={() => setEditorOpen(false)}
          returnFocusRef={menuTriggerRef}
        />
      ) : null}

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Перевести «${label}» в архив?`}
        description="Сотрудник исчезнет из активного списка. Заключения и история сохранятся."
        consequences={
          activeCount > 0
            ? [
                `У сотрудника активных оценок: ${activeCount}.`,
                'Решение по ним нужно принять явно — тихой отмены не происходит.',
              ]
            : ['Активных оценок нет.']
        }
        confirmLabel="Архивировать"
        loading={archiveMutation.isPending}
        returnFocusRef={menuTriggerRef}
        onConfirm={() => archiveMutation.mutate({ cancelActiveAssignments: cancelActive })}
      >
        {activeCount > 0 ? (
          <Checkbox
            checked={cancelActive}
            onChange={setCancelActive}
            label="Также отменить активные оценки"
            description="Персональные ссылки перестанут работать, открытые сессии закроются."
          />
        ) : null}
      </ConfirmDialog>
    </>
  );
}
