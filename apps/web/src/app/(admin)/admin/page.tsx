'use client';

import {
  Activity,
  AlertOctagon,
  Ban,
  Building2,
  CircleCheck,
  Clock,
  FileCheck2,
  KeyRound,
  RotateCw,
  ShieldQuestion,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { AdminOverview, Envelope } from '@context/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, StatCard } from '@/components/ui/card';
import { Callout, EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/page-header';
import { useApiQuery } from '@/lib/query';
import { formatDateTime } from '@/lib/format';

import { ATTENTION_KIND_LABELS } from './_lib/labels';

type AttentionKind = AdminOverview['attention'][number]['kind'];

const ATTENTION_ICON: Record<AttentionKind, ReactNode> = {
  generation_failed: <AlertOctagon aria-hidden="true" strokeWidth={1.75} />,
  suspended_method: <Ban aria-hidden="true" strokeWidth={1.75} />,
  expiring_grant: <Clock aria-hidden="true" strokeWidth={1.75} />,
  pending_recovery: <KeyRound aria-hidden="true" strokeWidth={1.75} />,
  pending_privacy_request: <ShieldQuestion aria-hidden="true" strokeWidth={1.75} />,
};

const ATTENTION_BADGE_TONE: Record<AttentionKind, 'danger' | 'warning' | 'info'> = {
  generation_failed: 'danger',
  suspended_method: 'warning',
  expiring_grant: 'warning',
  pending_recovery: 'info',
  pending_privacy_request: 'info',
};

export default function AdminOverviewPage() {
  const overview = useApiQuery<Envelope<AdminOverview>>(['admin', 'overview'], '/admin/overview');
  const data = overview.data?.data;

  if (overview.error) {
    return (
      <>
        <PageHeader title="Состояние платформы" />
        <ErrorState
          title="Не удалось загрузить обзор"
          description="Проверьте подключение и повторите попытку."
          requestId={overview.error.problem.requestId}
          onRetry={overview.refetch}
        />
      </>
    );
  }

  if (!data) {
    return <PageSkeleton variant="dashboard" label="Загружаем состояние платформы" />;
  }

  const hasAttention = data.attention.length > 0;

  return (
    <>
      <PageHeader
        title="Состояние платформы"
        description="Эксплуатационные количества. Содержание оценок в этом разделе не показывается."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Активные организации"
          value={data.organizations.active}
          href="/admin/organizations"
          tint="accent"
          icon={<Building2 aria-hidden="true" strokeWidth={1.75} />}
        />
        <StatCard
          label="Приостановленные организации"
          value={data.organizations.suspended}
          href="/admin/organizations"
          tint={data.organizations.suspended > 0 ? 'peach' : 'none'}
          icon={<Ban aria-hidden="true" strokeWidth={1.75} />}
        />
        <StatCard
          label="Назначений в обработке"
          value={data.assignmentsInProcessing}
          tint="sky"
          icon={<Activity aria-hidden="true" strokeWidth={1.75} />}
        />
        <StatCard
          label="Заключений на проверке"
          value={data.reportsPendingReview}
          tint="lavender"
          icon={<FileCheck2 aria-hidden="true" strokeWidth={1.75} />}
        />
        <StatCard
          label="Заданий с ошибкой"
          value={data.failedJobs}
          hint="Считается по отметке самого задания, а не по оценке."
          href="/admin/operations"
          tint={data.failedJobs > 0 ? 'danger' : 'none'}
          icon={<TriangleAlert aria-hidden="true" strokeWidth={1.75} />}
        />
      </div>

      {/*
        CTA «Открыть очередь проверки» из ТЗ 05 (A01) здесь не добавлена: у
        администратора нет маршрута к очереди проверки заключений — это
        рабочее пространство руководителя с правом `reports.review`
        (`/app/reviews`), а по ТЗ 05 содержание чужих оценок администратору
        не открывается. Добавление такой ссылки было бы либо нерабочим
        переходом, либо обходом границы доступа; вместо неё оставлена ссылка
        на «Заданий с ошибкой» → `/admin/operations`, куда у администратора
        есть настоящий доступ.
      */}

      <div className="mt-6">
        <Card>
          <CardHeader
            icon={
              hasAttention ? (
                <TriangleAlert aria-hidden="true" strokeWidth={1.75} />
              ) : (
                <CircleCheck aria-hidden="true" strokeWidth={1.75} />
              )
            }
            tint={hasAttention ? 'warning' : 'success'}
            title="Требует внимания"
            description="Сбои обработки, приостановленные методики, истекающие доступы и заявки."
          />
          <CardBody>
            {!hasAttention ? (
              <EmptyState
                compact
                tint="success"
                icon={<CircleCheck aria-hidden="true" strokeWidth={1.75} />}
                title="Сейчас ничего не требует вмешательства"
                description="Задания, методики и доступы платформы в порядке."
              />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {data.attention.map((item, index) => (
                  <li
                    key={`${item.kind}-${index}`}
                    className="flex flex-wrap items-start gap-3 rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-3.5"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 text-[var(--text-secondary)] [&_svg]:size-[18px]"
                    >
                      {ATTENTION_ICON[item.kind]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug text-[var(--text-primary)]">
                        {item.title}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge tone={ATTENTION_BADGE_TONE[item.kind]}>
                          {ATTENTION_KIND_LABELS[item.kind] ?? item.kind}
                        </Badge>
                        {item.organizationCode ? (
                          <span className="text-xs text-[var(--text-secondary)]">
                            {item.organizationCode}
                          </span>
                        ) : null}
                        <span className="text-xs text-[var(--text-secondary)]">
                          {formatDateTime(item.occurredAt)}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Callout tone="neutral" className="mt-6" role="note">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Обновлено {formatDateTime(data.generatedAt)}</span>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCw aria-hidden="true" strokeWidth={1.75} />}
            onClick={overview.refetch}
          >
            Обновить
          </Button>
        </div>
      </Callout>
    </>
  );
}
