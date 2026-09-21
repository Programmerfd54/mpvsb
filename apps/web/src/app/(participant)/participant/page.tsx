'use client';

import { ArrowRight, Check, ClipboardList } from 'lucide-react';

import type { Envelope, ParticipantAttemptSummary, ParticipantSession } from '@context/contracts';

import { ParticipantTopbarInfo } from '@/components/layout/participant-shell';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Stagger, StaggerItem } from '@/components/ui/motion';
import { Progress } from '@/components/ui/progress';
import { Callout, ErrorState, LoadingBlock } from '@/components/ui/states';
import { useApiQuery } from '@/lib/query';
import { formatRemaining } from '@/lib/format';

/** `mailto:`/`tel:` для контакта организации; без явного признака ссылку не строим. */
function contactHref(contact: string | null): string | undefined {
  if (!contact) {
    return undefined;
  }
  if (contact.includes('@')) {
    return `mailto:${contact}`;
  }
  if (/^[+\d][\d\s()-]{5,}$/.test(contact)) {
    return `tel:${contact.replace(/[\s()-]/g, '')}`;
  }
  return undefined;
}

function isSubmitted(state: ParticipantAttemptSummary['state']): boolean {
  return state === 'submitted' || state === 'scored' || state === 'scoring_failed';
}

/**
 * Список методик участника.
 *
 * Здесь нет баллов, сравнения с другими людьми и оценки «эффективности».
 * Порядок задан версией сценария: участник не выбирает, что проходить первым.
 */
export default function ParticipantHomePage() {
  const sessionQuery = useApiQuery<Envelope<ParticipantSession>>(
    ['participant-session'],
    '/participant/session',
  );
  const attemptsQuery = useApiQuery<Envelope<ParticipantAttemptSummary[]>>(
    ['participant-attempts'],
    '/participant/attempts',
    { staleTime: 0 },
  );

  const error = sessionQuery.error ?? attemptsQuery.error;

  if (error?.status === 401) {
    return (
      <ErrorState
        title="Сессия участия истекла"
        description="Откройте персональную ссылку заново. Сохранённые ответы останутся на месте."
      />
    );
  }

  if (error?.status === 403) {
    return (
      <ErrorState
        title="Сначала подтвердите условия участия"
        description="Вернитесь на страницу приглашения и прочитайте условия."
        action={<ButtonLink href="/participant/welcome">Открыть условия</ButtonLink>}
      />
    );
  }

  if (error) {
    return (
      <ErrorState
        title={error.problem.title}
        requestId={error.problem.requestId}
        onRetry={() => {
          void sessionQuery.refetch();
          void attemptsQuery.refetch();
        }}
      />
    );
  }

  const session = sessionQuery.data?.data;
  const attempts = attemptsQuery.data?.data;

  if (!session || !attempts || attemptsQuery.isFetching) {
    return <LoadingBlock label="Загружаем список тестов" />;
  }

  const orderedAttempts = [...attempts].sort((a, b) => a.orderIndex - b.orderIndex);
  const requiredAttempts = orderedAttempts.filter((item) => item.required);
  const completed = requiredAttempts.filter((item) => isSubmitted(item.state)).length;
  const nextAttempt =
    orderedAttempts.find((item) => item.required && !isSubmitted(item.state)) ??
    orderedAttempts.find((item) => !isSubmitted(item.state));
  const allRequiredDone = orderedAttempts.length > 0 && completed === requiredAttempts.length;

  return (
    <>
      <ParticipantTopbarInfo
        context={session.organizationName}
        help={session.organizationContact ?? undefined}
        helpHref={contactHref(session.organizationContact)}
      />

      <header className="mb-6 flex flex-col gap-3">
        <h1>Ваши тесты</h1>
        <p className="max-w-prose text-[var(--text-secondary)]">
          Здесь собраны назначенные вам опросы. Можно прерваться и продолжить позже — до окончания
          срока участия.
        </p>
        {requiredAttempts.length > 0 ? (
          <Progress
            completed={completed}
            total={requiredAttempts.length}
            label="Обязательных тестов завершено"
          />
        ) : null}
        <p className="text-sm text-[var(--text-secondary)]">{formatRemaining(session.expiresAt)}</p>
      </header>

      {attempts.length === 0 ? (
        <Card>
          <CardBody>
            <Callout tone="info" title="Пока нет назначенных тестов">
              Как только организация назначит тесты, они появятся здесь.
            </Callout>
          </CardBody>
        </Card>
      ) : null}

      {allRequiredDone ? (
        <div className="mb-5">
          <Callout
            tone="success"
            title="Обязательные тесты завершены"
            action={<ButtonLink href="/participant/done">Что дальше</ButtonLink>}
          >
            Ответы на обязательные тесты переданы на обработку.
          </Callout>
        </div>
      ) : null}

      <Stagger className="flex list-none flex-col gap-4 p-0" as="ul">
        {orderedAttempts.map((attempt, index) => {
          const done = isSubmitted(attempt.state);
          const started = attempt.state === 'in_progress';
          const processingDelayed = attempt.state === 'scoring_failed';

          return (
            <StaggerItem key={attempt.attemptId} index={index} as="li">
              <Card
                className={
                  attempt.attemptId === nextAttempt?.attemptId
                    ? 'ring-1 ring-[var(--accent-soft-border)]'
                    : undefined
                }
              >
                <CardBody className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"
                      >
                        {done ? <Check className="size-5" /> : <ClipboardList className="size-5" />}
                      </span>
                      <div className="min-w-0">
                        <p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">
                          {done
                            ? 'Ответы отправлены'
                            : attempt.attemptId === nextAttempt?.attemptId
                              ? 'Следующий шаг'
                              : `Опрос ${index + 1}`}
                        </p>
                        <h2 className="text-base font-semibold">{attempt.title}</h2>
                        <p className="mt-1 text-sm text-[var(--text-secondary)]">
                          {attempt.itemCount} вопросов
                          {attempt.estimatedMinutes
                            ? ` · около ${attempt.estimatedMinutes} мин.`
                            : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!attempt.required ? <Badge tone="neutral">Необязательный</Badge> : null}
                      <Badge
                        tone={
                          processingDelayed
                            ? 'neutral'
                            : done
                              ? 'success'
                              : started
                                ? 'accent'
                                : 'neutral'
                        }
                      >
                        {processingDelayed
                          ? 'Обработка задерживается'
                          : done
                            ? 'Ответы отправлены'
                            : attempt.stateLabel}
                      </Badge>
                    </div>
                  </div>

                  {started ? (
                    <Progress
                      completed={attempt.answeredCount}
                      total={attempt.itemCount}
                      label="Ответов заполнено"
                    />
                  ) : null}
                  <p className="max-w-[var(--reading-max)] text-sm leading-relaxed">
                    {attempt.participantIntro}
                  </p>

                  {processingDelayed ? (
                    <p className="text-sm text-[var(--text-secondary)]">
                      Ответы получены. Повторно проходить тест не нужно.
                    </p>
                  ) : null}

                  {attempt.limitations.length > 0 ? (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-[var(--text-secondary)]">
                        Что важно знать об этом тесте
                      </summary>
                      <ul className="mt-2 flex list-none flex-col gap-1.5 p-0 text-xs text-[var(--text-secondary)]">
                        {attempt.limitations.map((limit) => (
                          <li key={limit}>• {limit}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  {!done ? (
                    <div>
                      <ButtonLink
                        href={
                          started
                            ? `/participant/tests/${attempt.attemptId}`
                            : `/participant/tests/${attempt.attemptId}/intro`
                        }
                        variant={
                          attempt.attemptId === nextAttempt?.attemptId ? 'primary' : 'secondary'
                        }
                        iconRight={<ArrowRight aria-hidden="true" />}
                        size="lg"
                      >
                        {started ? 'Продолжить' : 'Начать'}
                      </ButtonLink>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            </StaggerItem>
          );
        })}
      </Stagger>

      {attempts.length > 0 ? (
        <p className="mt-6 text-sm text-[var(--text-secondary)]">
          Между тестами можно сделать перерыв: ответы сохраняются на сервере.
        </p>
      ) : null}
    </>
  );
}
