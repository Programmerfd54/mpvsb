'use client';

import { use, useRef, useState } from 'react';
import { Copy, FileText, Link2 } from 'lucide-react';

import type { AssignmentDetail, Envelope } from '@context/contracts';
import type { ReportRevisionState } from '@context/domain';

import { Monogram } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ButtonLink, Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KeyValueList, Timeline } from '@/components/ui/data-list';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, TextArea } from '@/components/ui/field';
import { ProcessTrack, StepProgress, type ProcessStageState } from '@/components/ui/progress';
import { Callout, ErrorState, ForbiddenState, PageSkeleton } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/manager-shell';
import { api } from '@/lib/api';
import { formatDateTime, formatRemaining } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useSession } from '@/lib/session';
import { assignmentTone } from '../_components/tone';

/** Реальные стадии подготовки заключения, по конвейеру из @context/domain. */
const REPORT_TRACK_ORDER: ReadonlyArray<ReportRevisionState> = [
  'queued',
  'generating',
  'pending_review',
  'published',
];
const REPORT_TRACK_LABELS = ['Ответы получены', 'Обрабатываем', 'Проверяем', 'Готово'];

function reportTrackStages(
  reportStatus: string | null,
): ReadonlyArray<{ label: string; state: ProcessStageState }> | null {
  if (!reportStatus) {
    return null;
  }
  let index = REPORT_TRACK_ORDER.indexOf(reportStatus as ReportRevisionState);
  let failed = false;
  if (reportStatus === 'generation_failed') {
    index = 1;
    failed = true;
  } else if (reportStatus === 'revision_requested') {
    index = 2;
  } else if (reportStatus === 'superseded') {
    index = 3;
  }
  if (index === -1) {
    return null;
  }
  return REPORT_TRACK_LABELS.map((label, position) => ({
    label,
    state:
      failed && position === index
        ? 'failed'
        : position < index
          ? 'done'
          : position === index
            ? 'current'
            : 'upcoming',
  }));
}

export default function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = use(params);
  const session = useSession();
  const organizationId = session.organization?.organizationId;

  const [link, setLink] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelTriggerRef = useRef<HTMLButtonElement>(null);

  const detailPath = organizationId ? `/orgs/${organizationId}/assignments/${assignmentId}` : null;
  const { data, error, isLoading, refetch } = useApiQuery<Envelope<AssignmentDetail>>(
    ['assignment', organizationId, assignmentId],
    detailPath,
  );

  const issueMutation = useApiMutation<void, { url: string; replacedPrevious: boolean }>(
    async () => {
      const response = await api.post<Envelope<{ url: string; replacedPrevious: boolean }>>(
        `/orgs/${organizationId}/assignments/${assignmentId}/invitations`,
      );
      return response.data;
    },
    {
      invalidate: [['assignment', organizationId, assignmentId]],
      onSuccess: (result) => {
        setLink(result.url);
        notify.success(
          result.replacedPrevious
            ? 'Новая ссылка выпущена. Прежняя больше не работает.'
            : 'Ссылка выпущена',
        );
      },
      onError: (cause) => {
        if (cause) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        }
      },
    },
  );

  const cancelMutation = useApiMutation<string, void>(
    async (reason) => {
      await api.post(`/orgs/${organizationId}/assignments/${assignmentId}/cancel`, { reason });
    },
    {
      invalidate: [
        ['assignment', organizationId, assignmentId],
        ['assignments', organizationId],
      ],
      onSuccess: () => {
        notify.success('Оценка отменена');
        setCancelOpen(false);
        setLink(null);
      },
      onError: (cause) => {
        if (cause) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        }
      },
    },
  );

  if (error) {
    if (error.status === 403) {
      return <ForbiddenState description="Эта оценка недоступна с вашим набором разрешений." />;
    }
    return (
      <ErrorState
        title={error.status === 404 ? 'Оценка не найдена' : 'Не удалось загрузить оценку'}
        description={
          error.status === 404
            ? 'Возможно, она относится к другой организации или была удалена.'
            : undefined
        }
        requestId={error.problem.requestId}
        onRetry={error.status === 404 ? undefined : refetch}
      />
    );
  }

  if (isLoading || !data) {
    return <PageSkeleton variant="detail" label="Загружаем оценку" />;
  }

  const detail = data.data;
  const canIssue = detail.availableActions.includes('issue_invitation');
  const canCancel = detail.availableActions.includes('cancel');
  const track = reportTrackStages(detail.reportStatus);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Monogram name={detail.employeeLabel} seed={detail.employeeId} />
            {detail.employeeLabel}
          </span>
        }
        description={`${detail.scenarioTitle} · версия ${detail.scenarioVersion}`}
        breadcrumbs={[
          { label: 'Оценки', href: '/app/assessments' },
          { label: detail.employeeLabel },
        ]}
        action={<Badge tone={assignmentTone(detail.state)}>{detail.stateLabel}</Badge>}
      />

      {detail.state === 'cancelled' && detail.cancelReason ? (
        <Callout tone="neutral" title="Причина отмены" className="mb-5">
          {detail.cancelReason}
        </Callout>
      ) : null}

      {detail.replacesAssignmentId ? (
        <Callout tone="info" title="Повторное назначение" className="mb-5">
          Заменяет предыдущую оценку того же сотрудника.{' '}
          <ButtonLink
            href={`/app/assessments/${detail.replacesAssignmentId}`}
            variant="ghost"
            size="sm"
            className="!h-auto !min-w-0 !p-0 underline"
          >
            Открыть прежнюю
          </ButtonLink>
        </Callout>
      ) : null}

      {/*
        Полная ширина, а не узкая правая колонка: ProcessTrack раскладывает 4 стадии
        в строку с брейкпоинта sm (viewport, а не ширина карточки) — в колонке
        ~350px подписи стадий налезали друг на друга.
      */}
      <Card className="mb-5">
        <CardHeader title="Заключение" icon={<FileText aria-hidden="true" />} />
        <CardBody className="flex flex-col gap-4">
          {track ? (
            <ProcessTrack stages={track} />
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              {detail.reportStatusLabel ?? 'Пока не готовится'}
            </p>
          )}
          {detail.reportId ? (
            <ButtonLink href={`/app/reports/${detail.reportId}`} variant="primary" className="self-start">
              Открыть заключение
            </ButtonLink>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Вопрос руководителя" icon={<FileText aria-hidden="true" />} />
            <CardBody>
              <KeyValueList
                columns={2}
                items={detail.contextFields.map((field) => ({
                  label: field.isOpinion ? `${field.label} · мнение руководителя` : field.label,
                  value: field.value,
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Методики"
              description="Показано только состояние прохождения. Ответы сотрудника здесь не отображаются."
            />
            <CardBody className="flex flex-col gap-4">
              <StepProgress
                completed={detail.attemptsSubmitted}
                total={detail.attemptsTotal}
                label="Тестов завершено"
              />
              <ul className="flex list-none flex-col gap-2 p-0">
                {detail.methods.map((method) => (
                  <li
                    key={method.attemptId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{method.title}</p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {method.itemCount} вопросов
                        {method.submittedAt
                          ? ` · отправлен ${formatDateTime(method.submittedAt)}`
                          : ''}
                      </p>
                    </div>
                    <Badge
                      tone={
                        method.state === 'scored' || method.state === 'submitted'
                          ? 'success'
                          : 'neutral'
                      }
                    >
                      {method.stateLabel}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="История" />
            <CardBody>
              {detail.timeline.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)]">Событий пока нет.</p>
              ) : (
                <Timeline
                  items={detail.timeline.map((entry) => ({
                    id: entry.at,
                    at: entry.at,
                    title: entry.title,
                  }))}
                />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Срок и ссылка" />
            <CardBody className="flex flex-col gap-3">
              <p className="text-sm">
                {detail.state === 'invited' || detail.state === 'in_progress'
                  ? formatRemaining(detail.dueAt)
                  : `Срок: ${formatDateTime(detail.dueAt)}`}
              </p>

              {detail.invitation ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  {detail.invitation.lastExchangedAt
                    ? `Сотрудник открыл приглашение ${formatDateTime(detail.invitation.lastExchangedAt)}`
                    : 'Приглашение ещё не открывали'}
                </p>
              ) : (
                <p className="text-xs text-[var(--text-secondary)]">Ссылка ещё не выпускалась.</p>
              )}

              {canIssue ? (
                <Button
                  variant="primary"
                  icon={<Link2 aria-hidden="true" />}
                  loading={issueMutation.isPending}
                  onClick={() => issueMutation.mutate()}
                >
                  {detail.invitation ? 'Выпустить новую ссылку' : 'Выпустить ссылку'}
                </Button>
              ) : null}

              {link ? (
                <div className="flex flex-col gap-2">
                  <code className="overflow-x-auto rounded-[var(--radius-control)] bg-[var(--bg-inset)] p-2 text-xs">
                    {link}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Copy aria-hidden="true" />}
                    onClick={() => {
                      void navigator.clipboard.writeText(link);
                      notify.success('Ссылка скопирована');
                    }}
                  >
                    Скопировать
                  </Button>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Значение показывается один раз. После обновления страницы его не восстановить.
                  </p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {canCancel ? (
            <Card>
              <CardHeader title="Отмена" />
              <CardBody className="flex flex-col gap-3">
                <p className="text-sm text-[var(--text-secondary)]">
                  Ссылка и сессия сотрудника перестанут работать. Сохранённые ответы будут
                  обработаны по политике хранения.
                </p>
                <Button
                  ref={cancelTriggerRef}
                  variant="destructive"
                  onClick={() => setCancelOpen(true)}
                >
                  Отменить оценку
                </Button>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Отменить оценку для «${detail.employeeLabel}»?`}
        description="Действие нельзя отменить. Для повторной оценки нужно создать новое назначение."
        consequences={[
          'Персональная ссылка перестанет работать.',
          'Открытая сессия сотрудника будет закрыта.',
          'Незавершённая обработка результата не будет сохранена.',
        ]}
        confirmLabel="Отменить оценку"
        destructive
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate(cancelReason)}
        returnFocusRef={cancelTriggerRef}
      >
        <Field label="Причина отмены" hint="Не менее 3 символов. Сохранится в истории назначения.">
          {({ inputId, describedBy }) => (
            <TextArea
              id={inputId}
              aria-describedby={describedBy}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              maxLength={1000}
              minLength={3}
              rows={3}
              required
            />
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}
