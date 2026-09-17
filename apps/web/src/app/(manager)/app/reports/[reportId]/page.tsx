'use client';

import { FileCheck2, MessageSquareWarning, Printer, TriangleAlert } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { use, useEffect, useRef, useState } from 'react';

import type { Envelope, ReportDetail } from '@context/contracts';
import { FINDING_KIND_LABELS, REPORT_STATE_LABELS } from '@context/domain';

import { EvidenceCard } from '@/components/reports/evidence-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KeyValueList, Timeline } from '@/components/ui/data-list';
import { Callout, ErrorState, ForbiddenState, PageSkeleton } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/manager-shell';
import { formatDateTime } from '@/lib/format';
import { useApiQuery } from '@/lib/query';
import { useSession } from '@/lib/session';

import { CorrectionRequestSheet } from './_components/correction-request-sheet';
import { DecisionPanel } from './_components/decision-panel';

export default function ReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = use(params);
  const session = useSession();
  const organizationId = session.organization?.organizationId;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const printRequested = searchParams.get('print') === '1';
  const printedRef = useRef(false);

  const { data, error, refetch } = useApiQuery<Envelope<ReportDetail>>(
    ['report', organizationId, reportId],
    organizationId ? `/orgs/${organizationId}/reports/${reportId}` : null,
  );

  const [correctionOpen, setCorrectionOpen] = useState(false);
  const correctionTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (printRequested && data && !printedRef.current) {
      printedRef.current = true;
      window.print();
      router.replace(pathname);
    }
  }, [printRequested, data, router, pathname]);

  if (error?.status === 403) {
    return (
      <ForbiddenState description="Просмотр этого заключения доступен по отдельному разрешению." />
    );
  }

  if (error) {
    return (
      <ErrorState
        title={error.status === 404 ? 'Заключение недоступно' : 'Не удалось загрузить заключение'}
        description={
          error.status === 404
            ? 'Оно ещё не опубликовано, относится к другой организации или было удалено.'
            : 'Проверьте подключение и повторите попытку.'
        }
        requestId={error.problem.requestId}
        onRetry={refetch}
      />
    );
  }

  if (!data) {
    return <PageSkeleton variant="detail" label="Загружаем заключение" />;
  }

  const report = data.data;
  const content = report.content;
  const evidenceByCode = new Map(report.evidence.map((item) => [item.evidenceCode, item]));
  // Данные загружены — значит запрос выполнялся с известным organizationId
  // (иначе useApiQuery не выполнил бы запрос, см. `path` выше).
  const orgId = organizationId as string;

  return (
    <>
      <PageHeader
        title={report.employeeLabel}
        eyebrow={report.scenarioTitle}
        description={`Опубликовано ${formatDateTime(report.publishedAt)} · версия ${report.revisionNo}`}
        breadcrumbs={[
          { label: 'Заключения', href: '/app/reports' },
          { label: report.employeeLabel },
        ]}
      />

      <div className="no-print mb-5 flex flex-col gap-3">
        {report.superseded ? (
          <Callout tone="warning" title="Эта версия заменена" role="status">
            Более новая ревизия этого заключения уже опубликована. Откройте карточку заключения
            заново из списка, чтобы увидеть актуальную версию.
          </Callout>
        ) : null}

        {report.mode === 'demo' ? (
          <Callout tone="demo" title="Демонстрационный материал" role="note">
            Все сведения синтетические. {report.generationModeLabel}.
          </Callout>
        ) : null}
      </div>

      <nav aria-label="Разделы заключения" className="no-print mb-5 flex flex-wrap gap-2">
        {[
          ['report-summary', 'Вывод'],
          ['report-evidence', `Основания · ${content.findings.length}`],
          ['report-limits', `Ограничения · ${content.limitations.length}`],
          ...(content.nextActions.length ? [['report-actions', 'Следующие шаги']] : []),
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="inline-flex min-h-11 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-secondary)] no-underline hover:bg-[var(--accent-soft)]"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="report-layout grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <article className="print-full flex max-w-[var(--reading-max)] flex-col gap-5">
          <Card id="report-summary" className="scroll-mt-24 border-t-4 border-t-[var(--accent)]">
            <CardHeader
              eyebrow="Главное для решения"
              title="Вывод"
              icon={<FileCheck2 aria-hidden="true" />}
            />
            <CardBody className="flex flex-col gap-3">
              <p className="text-base leading-relaxed">{content.summary}</p>
              <Badge tone="neutral">{report.supportLevelLabel}</Badge>
            </CardBody>
          </Card>

          {content.decisionNotes.length > 0 ? (
            <Card>
              <CardHeader title="Что это означает для решения" />
              <CardBody>
                <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                  {content.decisionNotes.map((note) => (
                    <li key={note} className="flex gap-2">
                      <span aria-hidden="true">•</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <Card id="report-evidence" className="scroll-mt-24">
            <CardHeader
              title="Основания"
              description="У каждого утверждения указан источник, его вид и ограничение."
            />
            <CardBody>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {content.findings.map((finding) => (
                  <Card key={finding.id} as="li" tone="inset" className="flex flex-col gap-3 p-4">
                    <Badge tone={finding.kind === 'data_gap' ? 'warning' : 'neutral'}>
                      {FINDING_KIND_LABELS[finding.kind]}
                    </Badge>
                    <p className="text-[15px] leading-relaxed">{finding.statement}</p>

                    {finding.evidenceIds.length > 0 ? (
                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {finding.evidenceIds.map((code) => {
                          const evidence = evidenceByCode.get(code);
                          return (
                            <li key={code}>
                              {evidence ? (
                                <EvidenceCard evidence={evidence} />
                              ) : (
                                <Callout tone="danger" title="Источник не найден">
                                  Сведения по коду {code} отсутствуют в перечне источников.
                                </Callout>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}

                    {finding.limitations.length > 0 ? (
                      <Callout tone="warning" role="note">
                        {finding.limitations.join(' ')}
                      </Callout>
                    ) : null}
                  </Card>
                ))}
              </ul>
            </CardBody>
          </Card>

          {/*
            Ограничения показываются сразу после оснований, а не мелким шрифтом
            внизу; противоречия — рядом, чтобы обе оговорки были видны без прокрутки.
          */}
          <Card id="report-limits" className="scroll-mt-24">
            <CardHeader
              title="Ограничения и противоречия"
              tint="warning"
              icon={<TriangleAlert aria-hidden="true" strokeWidth={1.75} />}
            />
            <CardBody className="flex flex-col gap-3">
              <Callout tone="warning" role="note">
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {content.limitations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Callout>

              {content.contradictions.length > 0 ? (
                <Callout tone="danger" title="Обнаружены противоречия в источниках" role="note">
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {content.contradictions.map((item) => (
                      <li key={item.statement}>{item.statement}</li>
                    ))}
                  </ul>
                </Callout>
              ) : null}
            </CardBody>
          </Card>

          {content.nextActions.length > 0 ? (
            <Card id="report-actions" className="scroll-mt-24">
              <CardHeader title="Что сделать дальше" />
              <CardBody>
                <ol className="m-0 flex list-none flex-col gap-3 p-0">
                  {content.nextActions.map((item) => (
                    <li
                      key={item.title}
                      className="flex flex-col gap-2 rounded-2xl border border-[var(--border-subtle)] p-4"
                    >
                      <Badge tone="accent">
                        {
                          {
                            manager: 'Руководителю',
                            employee: 'Сотруднику',
                            joint: 'Обсудить вместе',
                          }[item.owner]
                        }
                      </Badge>
                      <span className="text-[15px] font-semibold">{item.title}</span>
                      <span className="text-sm text-[var(--text-secondary)]">{item.why}</span>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          ) : null}

          {content.reconsiderWhen.length > 0 ? (
            <Card>
              <CardHeader title="Что может изменить вывод" />
              <CardBody>
                <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                  {content.reconsiderWhen.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Сведения о подготовке" />
            <CardBody>
              <KeyValueList
                items={[
                  {
                    label: 'Методики',
                    value:
                      report.preparation.methods
                        .map((method) => `${method.title} (${method.version})`)
                        .join(', ') || '—',
                  },
                  { label: 'Версия сценария', value: report.preparation.scenarioVersion },
                  { label: 'Способ подготовки', value: report.generationModeLabel },
                  {
                    label: 'Проверка',
                    value: report.preparation.reviewerName
                      ? `${report.preparation.reviewerName}, ${formatDateTime(report.preparation.reviewedAt)}`
                      : 'Не проверено',
                  },
                  ...(report.revisionState
                    ? [
                        {
                          label: 'Состояние ревизии',
                          value: REPORT_STATE_LABELS[report.revisionState],
                        },
                      ]
                    : []),
                ]}
              />
            </CardBody>
          </Card>
        </article>

        <aside className="no-print flex flex-col gap-5 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-100px)] xl:overflow-y-auto xl:pr-1">
          <DecisionPanel organizationId={orgId} reportId={reportId} />

          <Card>
            <CardHeader title="Действия" />
            <CardBody className="flex flex-col gap-3">
              <Button
                variant="secondary"
                icon={<Printer aria-hidden="true" strokeWidth={1.75} />}
                onClick={() => window.print()}
                fullWidth
              >
                Печатная версия
              </Button>
              <Button
                ref={correctionTriggerRef}
                variant="secondary"
                icon={<MessageSquareWarning aria-hidden="true" strokeWidth={1.75} />}
                onClick={() => setCorrectionOpen(true)}
                fullWidth
              >
                Сообщить о неточности
              </Button>
            </CardBody>
          </Card>

          {report.decisions.length > 0 ? (
            <Card>
              <CardHeader title="История решений" />
              <CardBody>
                <Timeline
                  items={report.decisions.map((decision) => ({
                    id: `${decision.createdAt}-${decision.actorName}`,
                    at: decision.createdAt,
                    title: decision.actionLabel,
                    description: (
                      <>
                        {decision.comment ? <p className="m-0">{decision.comment}</p> : null}
                        <p className="m-0 text-xs">{decision.actorName}</p>
                      </>
                    ),
                  }))}
                />
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>

      <CorrectionRequestSheet
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        organizationId={orgId}
        reportId={reportId}
        returnFocusRef={correctionTriggerRef}
      />
    </>
  );
}
