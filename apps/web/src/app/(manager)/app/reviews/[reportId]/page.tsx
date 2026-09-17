'use client';

import { use, useRef, useState } from 'react';

import type { Envelope, GenericAcknowledgement, ReportDetail } from '@context/contracts';
import { REVIEW_CHECKLIST_ITEMS, REVIEW_CHECKLIST_LABELS } from '@context/contracts';
import { FINDING_KIND_LABELS } from '@context/domain';

import { EvidenceBrowser } from '@/components/reports/evidence-browser';
import { FileCheck2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CharacterCount, Checkbox, TextArea } from '@/components/ui/field';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Callout, ErrorState, ForbiddenState, PageSkeleton } from '@/components/ui/states';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/manager-shell';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useSession } from '@/lib/session';

import { ChecksTab, computeChecks } from './_components/checks-tab';

/**
 * Проверка черновика заключения.
 *
 * Рецензент видит текст и источники рядом. Публикация невозможна, пока не
 * подтверждён каждый пункт чек-листа: это фиксирует, что именно проверял
 * человек (ТЗ A08).
 */
export default function ReviewPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = use(params);
  const session = useSession();
  const organizationId = session.organization?.organizationId;
  const canReview = session.has('reports.review');

  const { data, error, refetch } = useApiQuery<Envelope<ReportDetail>>(
    ['review', organizationId, reportId],
    organizationId && canReview ? `/orgs/${organizationId}/reviews/${reportId}` : null,
  );

  const [tab, setTab] = useState('draft');
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [comment, setComment] = useState('');
  const [highlightedCode, setHighlightedCode] = useState<string | null>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [revisionConfirmOpen, setRevisionConfirmOpen] = useState(false);

  const publishTriggerRef = useRef<HTMLButtonElement>(null);
  const revisionTriggerRef = useRef<HTMLButtonElement>(null);

  const allChecked = REVIEW_CHECKLIST_ITEMS.every((key) => checklist[key] === true);

  const publishMutation = useApiMutation<
    { checklist: Record<string, boolean>; comment?: string },
    Envelope<ReportDetail>
  >(
    (body) =>
      organizationId
        ? api.post(`/orgs/${organizationId}/reviews/${reportId}/publish`, body)
        : Promise.reject(new Error('no organization')),
    {
      invalidate: [['reviews', organizationId]],
      onSuccess: () => {
        notify.success('Заключение опубликовано');
        setPublishConfirmOpen(false);
        window.location.assign('/app/reviews');
      },
      onError: (mutationError) => {
        setPublishConfirmOpen(false);
        if (mutationError) {
          notify.error(mutationError.problem.title, { requestId: mutationError.problem.requestId });
        }
      },
    },
  );

  const revisionMutation = useApiMutation<{ comment: string }, Envelope<GenericAcknowledgement>>(
    (body) =>
      organizationId
        ? api.post(`/orgs/${organizationId}/reviews/${reportId}/request-revision`, body)
        : Promise.reject(new Error('no organization')),
    {
      invalidate: [['reviews', organizationId]],
      onSuccess: (result) => {
        notify.success(result.data.message);
        setRevisionConfirmOpen(false);
        window.location.assign('/app/reviews');
      },
      onError: (mutationError) => {
        setRevisionConfirmOpen(false);
        if (mutationError) {
          notify.error(mutationError.problem.title, { requestId: mutationError.problem.requestId });
        }
      },
    },
  );

  function focusEvidence(code: string): void {
    setHighlightedCode(code);
  }

  const revisionCommentValid = comment.trim().length >= 5;

  if (session.status === 'authenticated' && !canReview) {
    return <ForbiddenState />;
  }

  if (error) {
    return (
      <ErrorState
        title={error.status === 404 ? 'Черновик недоступен' : error.problem.title}
        description={
          error.status === 404
            ? 'Он уже опубликован, возвращён на доработку или относится к другой организации.'
            : 'Проверьте подключение и повторите попытку.'
        }
        requestId={error.problem.requestId}
        onRetry={refetch}
      />
    );
  }

  if (!data) {
    return <PageSkeleton variant="detail" label="Загружаем черновик" />;
  }

  const report = data.data;
  const content = report.content;
  const evidenceByCode = new Map(report.evidence.map((item) => [item.evidenceCode, item]));
  const checks = computeChecks(report);
  const selectedEvidence = evidenceByCode.get(highlightedCode ?? '') ?? report.evidence[0];
  const attentionCount = checks.filter((check) => !check.ok).length;

  return (
    <>
      <PageHeader
        title={`Проверка · ${content.caseCode}`}
        description={`${report.scenarioTitle} · ${report.generationModeLabel}`}
        breadcrumbs={[
          { label: 'Проверка заключений', href: '/app/reviews' },
          { label: content.caseCode },
        ]}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="warning">Черновик · версия {report.revisionNo}</Badge>
          <span className="text-sm text-[var(--text-secondary)]">
            Руководитель увидит текст после публикации
          </span>
        </div>
        <Button
          variant="ghost"
          icon={<ShieldCheck aria-hidden="true" />}
          onClick={() => setTab('checks')}
        >
          {attentionCount ? `Требуют внимания: ${attentionCount}` : 'Автопроверки: замечаний нет'}
        </Button>
      </div>
      {report.mode === 'demo' ? (
        <div className="mb-5">
          <Callout tone="demo" title="Демонстрационный материал">
            Все сведения синтетические.
          </Callout>
        </div>
      ) : null}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,1fr)]">
        <div className="min-w-0">
          <Tabs
            value={tab}
            onValueChange={setTab}
            label="Разделы проверки"
            items={[
              { value: 'draft', label: 'Заключение' },
              { value: 'checks', label: 'Проверки', count: attentionCount || undefined },
            ]}
          >
            <TabPanel value="draft" className="flex flex-col gap-5">
              <Card>
                <CardHeader
                  eyebrow="Прочитайте и сверьте с источниками"
                  title="Заключение"
                  icon={<FileCheck2 aria-hidden="true" />}
                />
                <CardBody className="flex flex-col gap-4">
                  <div>
                    <p className="text-sm font-medium text-[var(--text-secondary)]">Вывод</p>
                    <p className="mt-2 text-base leading-relaxed">{content.summary}</p>
                  </div>

                  <Badge tone="neutral">{report.supportLevelLabel}</Badge>

                  <div>
                    <p className="text-sm font-medium text-[var(--text-secondary)]">
                      Основания ({content.findings.length})
                    </p>
                    <ul className="m-0 mt-2 flex list-none flex-col gap-3 p-0">
                      {content.findings.map((finding) => (
                        <li
                          key={finding.id}
                          className="rounded-[var(--radius-nested)] bg-[var(--bg-inset)] p-3"
                        >
                          <Badge tone={finding.kind === 'data_gap' ? 'warning' : 'neutral'}>
                            {FINDING_KIND_LABELS[finding.kind]}
                          </Badge>
                          <p className="mt-2 text-[15px] leading-relaxed">{finding.statement}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {finding.evidenceIds.length === 0 ? (
                              <span className="text-xs text-[var(--text-secondary)]">
                                Источник не указан
                              </span>
                            ) : null}
                            {finding.evidenceIds.map((code) =>
                              evidenceByCode.has(code) ? (
                                <button
                                  key={code}
                                  type="button"
                                  onClick={() => focusEvidence(code)}
                                  aria-pressed={selectedEvidence?.evidenceCode === code}
                                  className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] bg-[var(--accent-soft)] px-2.5 text-xs font-semibold text-[var(--accent-ink)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-soft-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus-halo-color)]"
                                >
                                  {evidenceByCode.get(code)?.kindLabel} · {code}
                                </button>
                              ) : (
                                <Badge key={code} tone="danger">
                                  Нет источника: {code}
                                </Badge>
                              ),
                            )}
                          </div>
                          {finding.limitations.length > 0 ? (
                            <Callout tone="warning" role="note" className="mt-2">
                              {finding.limitations.join(' ')}
                            </Callout>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {content.contradictions.length > 0 ? (
                    <Callout tone="danger" title="Противоречия между источниками" role="note">
                      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                        {content.contradictions.map((item) => (
                          <li key={item.statement}>
                            {item.statement}{' '}
                            <span className="text-xs text-[var(--text-secondary)]">
                              ({item.evidenceIds.join(', ')})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Callout>
                  ) : null}

                  <div>
                    <p className="text-sm font-medium text-[var(--text-secondary)]">Ограничения</p>
                    <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-sm">
                      {content.limitations.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                </CardBody>
              </Card>

              {content.decisionNotes.length ? (
                <Card>
                  <CardHeader title="Что это означает для решения" />
                  <CardBody>
                    <ul className="list-disc space-y-3 pl-5 text-[15px] leading-relaxed">
                      {content.decisionNotes.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              ) : null}
              {content.nextActions.length ? (
                <Card>
                  <CardHeader title="Предлагаемые следующие шаги" />
                  <CardBody>
                    <ol className="space-y-4 list-decimal pl-5">
                      {content.nextActions.map((action, i) => (
                        <li key={i}>
                          <p className="font-semibold text-sm">{action.title}</p>
                          <p className="text-sm text-[var(--text-secondary)] mt-1">{action.why}</p>
                        </li>
                      ))}
                    </ol>
                  </CardBody>
                </Card>
              ) : null}
              {content.reconsiderWhen.length ? (
                <Card>
                  <CardHeader title="Когда пересмотреть вывод" />
                  <CardBody>
                    <ul className="list-disc space-y-2 pl-5 text-sm">
                      {content.reconsiderWhen.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              ) : null}
            </TabPanel>

            <TabPanel value="checks">
              <ChecksTab report={report} />
            </TabPanel>
          </Tabs>
        </div>

        <aside className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-100px)] xl:overflow-y-auto xl:pr-1">
          <EvidenceBrowser
            evidence={report.evidence}
            selectedCode={highlightedCode}
            onSelect={focusEvidence}
          />
          <Card>
            <CardHeader
              title="Чек-лист проверки"
              description="Публикация невозможна, пока не подтверждён каждый пункт."
            />
            <CardBody className="flex flex-col gap-1">
              <div className="mb-4">
                <Progress
                  completed={REVIEW_CHECKLIST_ITEMS.filter((key) => checklist[key]).length}
                  total={REVIEW_CHECKLIST_ITEMS.length}
                  label="Пунктов проверено"
                />
              </div>
              {REVIEW_CHECKLIST_ITEMS.map((key) => (
                <Checkbox
                  key={key}
                  checked={checklist[key] === true}
                  onChange={(checked) => setChecklist((prev) => ({ ...prev, [key]: checked }))}
                  label={REVIEW_CHECKLIST_LABELS[key]}
                />
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Замечания" description="Видны только вам и другим рецензентам." />
            <CardBody className="flex flex-col gap-3">
              <TextArea
                value={comment}
                onChange={(event) => setComment(event.target.value.slice(0, 4000))}
                maxLength={4000}
                rows={4}
                aria-label="Замечания рецензента"
                placeholder="Например: что нужно доработать перед публикацией."
              />
              <CharacterCount value={comment} max={4000} />
              <Button
                ref={publishTriggerRef}
                variant="primary"
                disabled={!allChecked}
                disabledReason={!allChecked ? 'Подтвердите все пункты проверки' : undefined}
                onClick={() => setPublishConfirmOpen(true)}
                fullWidth
              >
                Опубликовать
              </Button>
              <Button
                ref={revisionTriggerRef}
                variant="secondary"
                disabled={!revisionCommentValid}
                disabledReason={
                  !revisionCommentValid ? 'Опишите замечание: не менее 5 символов' : undefined
                }
                onClick={() => setRevisionConfirmOpen(true)}
                fullWidth
              >
                Вернуть на доработку
              </Button>
            </CardBody>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={publishConfirmOpen}
        onOpenChange={setPublishConfirmOpen}
        title="Опубликовать заключение?"
        description="Заключение станет доступно руководителю с этой версией текста и источников."
        consequences={[
          'Публикация неизменяема: исправление возможно только новой ревизией.',
          comment.trim() ? 'Комментарий будет сохранён вместе с публикацией.' : 'Комментарий пуст.',
        ]}
        confirmLabel="Опубликовать"
        loading={publishMutation.isPending}
        returnFocusRef={publishTriggerRef}
        onConfirm={() =>
          publishMutation.mutate({ checklist, comment: comment.trim() || undefined })
        }
      />

      <ConfirmDialog
        open={revisionConfirmOpen}
        onOpenChange={setRevisionConfirmOpen}
        title="Вернуть на доработку?"
        description="Черновик уйдёт на доработку вместе с вашим комментарием. Нужно описать, что не так, минимум 5 символов."
        confirmLabel="Вернуть на доработку"
        loading={revisionMutation.isPending}
        returnFocusRef={revisionTriggerRef}
        onConfirm={() => {
          if (!revisionCommentValid) {
            notify.error('Опишите, что нужно исправить (минимум 5 символов)');
            return;
          }
          revisionMutation.mutate({ comment: comment.trim() });
        }}
      >
        {!revisionCommentValid ? (
          <p className="text-sm text-[var(--danger-text)]" role="alert">
            Опишите, что нужно исправить, в поле «Замечания» (минимум 5 символов).
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
