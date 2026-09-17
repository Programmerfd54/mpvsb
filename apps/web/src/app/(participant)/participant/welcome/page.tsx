'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { Envelope, ParticipantSession, ParticipantTerms } from '@context/contracts';

import { ParticipantTopbarInfo } from '@/components/layout/participant-shell';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/field';
import { LoadingBlock, ErrorState, Callout } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';

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
 * Информирование и согласие.
 *
 * Флажок не предвыбран, кнопка «Согласен» недоступна до подтверждения.
 * Отказ фиксируется нейтрально и не интерпретируется как свойство человека.
 */
export default function WelcomePage() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const sessionQuery = useApiQuery<Envelope<ParticipantSession>>(
    ['participant-session'],
    '/participant/session',
  );
  const termsQuery = useApiQuery<Envelope<ParticipantTerms>>(
    ['participant-terms'],
    '/participant/terms',
  );

  const session = sessionQuery.data?.data;
  const terms = termsQuery.data?.data;

  useEffect(() => {
    if (session?.consentGiven) {
      router.replace('/participant');
    }
  }, [session?.consentGiven, router]);

  const acceptMutation = useApiMutation<void, Envelope<unknown>>(
    () => {
      if (!terms) {
        return Promise.reject(new Error('Условия ещё не загружены'));
      }
      return api.post('/participant/consents', {
        documentVersionId: terms.documentVersionId,
        documentHash: terms.contentHash,
        accepted: true,
      });
    },
    {
      onSuccess: () => router.push('/participant'),
      onError: (apiError) => {
        if (apiError?.status === 401) {
          setSessionExpired(true);
          return;
        }
        notify.error(apiError?.problem.title ?? 'Не удалось сохранить согласие', {
          requestId: apiError?.problem.requestId,
        });
      },
    },
  );

  const declineMutation = useApiMutation<void, Envelope<unknown>>(
    () => api.post('/participant/decline'),
    {
      onSuccess: () => router.push('/participant/done?declined=1'),
      onError: (apiError) => {
        if (apiError?.status === 401) {
          setSessionExpired(true);
          return;
        }
        notify.error(apiError?.problem.title ?? 'Не удалось сохранить отказ', {
          requestId: apiError?.problem.requestId,
        });
      },
    },
  );

  const loadError = sessionQuery.error ?? termsQuery.error;

  if (sessionExpired || loadError?.status === 401) {
    return (
      <ErrorState
        title="Сессия участия истекла"
        description="Откройте персональную ссылку заново. Сохранённые ответы останутся на месте."
      />
    );
  }

  if (loadError) {
    return (
      <ErrorState
        title={loadError.problem.title}
        requestId={loadError.problem.requestId}
        onRetry={() => {
          void sessionQuery.refetch();
          void termsQuery.refetch();
        }}
      />
    );
  }

  if (!session || !terms) {
    return <LoadingBlock label="Загружаем приглашение" />;
  }

  const pending = acceptMutation.isPending || declineMutation.isPending;
  const questionHref = contactHref(session.organizationContact);

  return (
    <>
      <ParticipantTopbarInfo
        context={session.organizationName}
        help={session.organizationContact ?? undefined}
        helpHref={contactHref(session.organizationContact)}
      />

      <header className="mb-6 flex flex-col gap-2">
        <h1>{session.scenarioTitle}</h1>
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">
            {session.methodCount} {session.methodCount === 1 ? 'тест' : 'теста'}
          </Badge>
          {session.mode === 'demo' ? <Badge tone="info">Демонстрация</Badge> : null}
        </div>
      </header>

      {terms.status !== 'approved' ? (
        <div className="mb-5">
          <Callout tone="warning" title="Образец документа">
            Это черновик для демонстрации. Для оценки реальных сотрудников требуется утверждённая
            версия условий.
          </Callout>
        </div>
      ) : null}

      <Card>
        <CardHeader title={terms.title} />
        <CardBody>
          <div className="flex max-w-[var(--reading-max)] flex-col gap-3 text-sm leading-relaxed">
            {terms.bodyMarkdown.split('\n').map((line, index) => {
              if (line.startsWith('## ')) {
                return (
                  <h2 key={index} className="mt-3 text-base font-semibold">
                    {line.slice(3)}
                  </h2>
                );
              }
              if (line.startsWith('# ')) {
                return (
                  <h2 key={index} className="text-base font-semibold">
                    {line.slice(2)}
                  </h2>
                );
              }
              if (line.trim() === '') {
                return null;
              }
              return <p key={index}>{line}</p>;
            })}
          </div>
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardBody className="flex flex-col gap-4">
          <Checkbox
            checked={accepted}
            onChange={setAccepted}
            label="Я прочитал(а) условия участия и согласен(на) пройти оценку."
          />

          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              size="lg"
              disabled={!accepted}
              disabledReason={!accepted ? 'Сначала подтвердите согласие' : undefined}
              loading={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()}
            >
              Согласен, начать
            </Button>
            {questionHref ? (
              <ButtonLink href={questionHref} variant="secondary" size="lg">
                Задать вопрос
              </ButtonLink>
            ) : null}
            <Button
              variant="ghost"
              size="lg"
              loading={declineMutation.isPending}
              disabled={pending && !declineMutation.isPending}
              onClick={() => declineMutation.mutate()}
            >
              Не участвовать
            </Button>
          </div>

          {session.organizationContact ? (
            <p className="text-sm text-[var(--text-secondary)]">
              Вопросы об участии: {session.organizationContact}
            </p>
          ) : null}
        </CardBody>
      </Card>
    </>
  );
}
