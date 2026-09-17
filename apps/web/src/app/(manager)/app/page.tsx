'use client';

import {
  ClipboardList,
  Clock3,
  FileCheck2,
  FileText,
  Loader2,
  RotateCcw,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';

import type { DashboardSummary, Envelope } from '@context/contracts';

import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/card';
import { Monogram } from '@/components/ui/avatar';
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/motion';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/page-header';
import { formatDateTime, formatRemaining } from '@/lib/format';
import { useApiQuery } from '@/lib/query';
import { useSession } from '@/lib/session';

import { assignmentTone } from './assessments/_components/tone';

const ATTENTION_ICON: Record<DashboardSummary['attention'][number]['kind'], typeof Clock3> = {
  expiring_soon: Clock3,
  report_ready: FileCheck2,
  generation_failed: TriangleAlert,
  revision_requested: RotateCcw,
};

const ATTENTION_TONE: Record<
  DashboardSummary['attention'][number]['kind'],
  'warning' | 'success' | 'danger' | 'info'
> = {
  expiring_soon: 'warning',
  report_ready: 'success',
  generation_failed: 'danger',
  revision_requested: 'info',
};

const ATTENTION_TONE_CLASS: Record<'warning' | 'success' | 'danger' | 'info', string> = {
  warning: 'bg-[var(--warning-soft)] text-[var(--warning-text)]',
  success: 'bg-[var(--success-soft)] text-[var(--success-text)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger-text)]',
  info: 'bg-[var(--info-soft)] text-[var(--info-text)]',
};

export default function DashboardPage() {
  const session = useSession();
  const organizationId = session.organization?.organizationId;

  const { data, error, isLoading, refetch } = useApiQuery<Envelope<DashboardSummary>>(
    ['dashboard', organizationId],
    organizationId ? `/orgs/${organizationId}/dashboard` : null,
  );

  if (error) {
    return (
      <>
        <PageHeader title="Обзор" description="Состояние работы и следующий шаг." />
        <ErrorState
          title="Не удалось загрузить обзор"
          description="Данные не получены. Проверьте подключение и повторите попытку."
          requestId={error.problem.requestId}
          onRetry={refetch}
        />
      </>
    );
  }

  if (isLoading || !data) {
    return <PageSkeleton variant="dashboard" label="Загружаем обзор" />;
  }

  const summary = data.data;
  const nothingYet =
    summary.activeAssignments === 0 &&
    summary.awaitingStart === 0 &&
    summary.inProcessing === 0 &&
    summary.newReports === 0 &&
    summary.recentAssessments.length === 0;

  return (
    <>
      <PageHeader
        title="Обзор"
        description="Состояние работы и следующий шаг."
        action={
          <ButtonLink
            href="/app/assessments/new"
            variant="primary"
            icon={<UserPlus aria-hidden="true" />}
          >
            Назначить оценку
          </ButtonLink>
        }
      />

      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" as="div">
        <StaggerItem index={0}>
          <StatCard
            label="Активные оценки"
            value={summary.activeAssignments}
            href="/app/assessments?state=in_progress"
            tint="accent"
            icon={<ClipboardList aria-hidden="true" />}
          />
        </StaggerItem>
        <StaggerItem index={1}>
          <StatCard
            label="Ожидают начала"
            value={summary.awaitingStart}
            href="/app/assessments?state=invited"
            tint="sky"
            icon={<Clock3 aria-hidden="true" />}
          />
        </StaggerItem>
        <StaggerItem index={2}>
          <StatCard
            label="На обработке и проверке"
            value={summary.inProcessing}
            href="/app/assessments?reportStatus=pending"
            tint="lavender"
            icon={<Loader2 aria-hidden="true" />}
          />
        </StaggerItem>
        <StaggerItem index={3}>
          <StatCard
            label="Новые заключения"
            value={summary.newReports}
            href="/app/reports"
            tint="peach"
            icon={<FileText aria-hidden="true" />}
          />
        </StaggerItem>
      </Stagger>

      {nothingYet ? (
        <FadeIn delay={0.05} className="mt-6">
          <EmptyState
            title="Оценок пока нет"
            description="Добавьте сотрудника и назначьте первую оценку. Все данные в этой среде синтетические."
            icon={<UserPlus aria-hidden="true" />}
            action={
              <>
                <ButtonLink href="/app/employees" variant="primary">
                  Добавить сотрудника
                </ButtonLink>
                <ButtonLink href="/app/assessments/new" variant="secondary">
                  Назначить оценку
                </ButtonLink>
              </>
            }
          />
        </FadeIn>
      ) : (
        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <FadeIn delay={0.05}>
            <Card>
              <CardHeader
                title="Требуют внимания"
                description="Истекающие ссылки и готовые заключения."
                icon={<TriangleAlert aria-hidden="true" />}
                tint="warning"
              />
              <CardBody>
                {summary.attention.length === 0 ? (
                  <p className="text-sm text-[var(--text-secondary)]">
                    Сейчас ничего не требует вашего участия.
                  </p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {summary.attention.map((item) => {
                      const Icon = ATTENTION_ICON[item.kind];
                      return (
                        <li
                          key={`${item.kind}:${item.assignmentId ?? item.reportId}`}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-nested)] bg-[var(--bg-inset)] p-3.5"
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <span
                              aria-hidden="true"
                              className={`grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-4 ${ATTENTION_TONE_CLASS[ATTENTION_TONE[item.kind]]}`}
                            >
                              <Icon strokeWidth={1.75} />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-snug">{item.title}</p>
                              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                                {item.kind === 'expiring_soon'
                                  ? formatRemaining(item.occurredAt)
                                  : formatDateTime(item.occurredAt)}
                              </p>
                            </div>
                          </div>
                          <ButtonLink
                            size="sm"
                            variant="secondary"
                            href={
                              item.reportId
                                ? `/app/reports/${item.reportId}`
                                : `/app/assessments/${item.assignmentId}`
                            }
                          >
                            {item.reportId ? 'Открыть заключение' : 'Открыть оценку'}
                          </ButtonLink>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>
          </FadeIn>

          <FadeIn delay={0.1}>
            <Card>
              <CardHeader
                title="Последние оценки"
                icon={<ClipboardList aria-hidden="true" />}
                tint="accent"
              />
              <CardBody>
                {summary.recentAssessments.length === 0 ? (
                  <p className="text-sm text-[var(--text-secondary)]">Пока нет ни одной оценки.</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {summary.recentAssessments.map((item) => (
                      <li key={item.assignmentId} className="flex items-start gap-3">
                        <Monogram name={item.employeeLabel} seed={item.assignmentId} size="sm" />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/app/assessments/${item.assignmentId}`}
                            className="text-sm font-semibold text-[var(--text-primary)] no-underline hover:text-[var(--accent)] hover:underline"
                          >
                            {item.employeeLabel}
                          </Link>
                          <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                            {item.scenarioTitle}
                          </p>
                          <Badge className="mt-1.5" tone={assignmentTone(item.state)}>
                            {item.stateLabel}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </FadeIn>
        </div>
      )}

      <p className="mt-6 text-xs text-[var(--text-secondary)]">
        Обновлено {formatDateTime(summary.generatedAt)}
      </p>
    </>
  );
}
