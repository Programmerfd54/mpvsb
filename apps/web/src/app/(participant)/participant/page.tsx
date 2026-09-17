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

  if (!session || !attempts) {
    return <LoadingBlock label="Загружаем список тестов" />;
  }

  const completed = attempts.filter(
    (item) => item.state === 'submitted' || item.state === 'scored',
  ).length;
  const nextAttempt = attempts.find(
    (item) => item.state !== 'submitted' && item.state !== 'scored',
  );
  const allDone = attempts.length > 0 && completed === attempts.length;

  return (
    <>
      <ParticipantTopbarInfo
        context={session.organizationName}
        help={session.organizationContact ?? undefined}
        helpHref={contactHref(session.organizationContact)}
      />

      <header className="mb-6 flex flex-col gap-3">
        <p className="eyebrow text-[var(--accent)]">Ваше участие</p>
        <h1>Шаг за шагом, в своём темпе</h1>
        <p className="max-w-prose text-[var(--text-secondary)]">
          Здесь собраны назначенные вам опросы. Можно прерваться и продолжить позже — до окончания
          срока участия.
        </p>
        {attempts.length > 0 ? (
          <Progress completed={completed} total={attempts.length} label="Завершено тестов" />
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

      {allDone ? (
        <div className="mb-5">
          <Callout
            tone="success"
            title="Все тесты завершены"
            action={<ButtonLink href="/participant/done">Что дальше</ButtonLink>}
          >
            Спасибо за участие. Ответы переданы на обработку.
          </Callout>
        </div>
      ) : null}

      <Stagger className="flex list-none flex-col gap-4 p-0" as="ul">
        {attempts.map((attempt, index) => {
          const done = attempt.state === 'submitted' || attempt.state === 'scored';
          const started = attempt.state === 'in_progress';

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
                            ? 'Завершено'
                            : attempt.attemptId === nextAttempt?.attemptId
                              ? 'Следующий шаг'
                              : `Опрос ${index + 1}`}
                        </p>
                        <h2 className="text-base font-semibold">{attempt.title}</h2>
                        <p className="mt-1 text-sm text-[var(--text-secondary)]">
                          {attempt.itemCount} вопросов ·{' '}
                          {attempt.estimatedMinutes
                            ? `около ${attempt.estimatedMinutes} мин.`
                            : 'время прохождения пока не измерено'}
                        </p>
                      </div>
                    </div>
                    <Badge tone={done ? 'success' : started ? 'accent' : 'neutral'}>
                      {attempt.stateLabel}
                    </Badge>
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
                        href={`/participant/tests/${attempt.attemptId}`}
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
