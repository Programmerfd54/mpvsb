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

/** Группируем строки документа в абзацы и списки, не интерпретируя HTML. */
function TermsContent({ markdown }: { markdown: string }) {
  const blocks = markdown.trim().split(/\n\s*\n/);

  return (
    <div className="flex max-w-[var(--reading-max)] min-w-0 flex-col gap-4 break-words text-base leading-relaxed">
      {blocks.map((block, index) => {
        const lines = block.trim().split('\n');
        const first = lines[0] ?? '';
        if (/^#{1,3} /.test(first)) {
          const heading = first.replace(/^#{1,3} /, '');
          return (
            <section key={index} className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">{heading}</h2>
              {lines.length > 1 ? <p>{lines.slice(1).join(' ')}</p> : null}
            </section>
          );
        }
        if (lines.every((line) => /^[-*] /.test(line))) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-6">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{line.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{lines.join(' ')}</p>;
      })}
    </div>
  );
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
  const [declined, setDeclined] = useState(false);

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
      },
    },
  );

  const declineMutation = useApiMutation<void, Envelope<unknown>>(
    () => api.post('/participant/decline'),
    {
      onSuccess: () => setDeclined(true),
      onError: (apiError) => {
        if (apiError?.status === 401) {
          setSessionExpired(true);
          return;
        }
      },
    },
  );

  const loadError = sessionQuery.error ?? termsQuery.error;

  if (declined) {
    return (
      <Card>
        <CardHeader title="Отказ от участия сохранён" />
        <CardBody className="flex flex-col gap-3">
          <p>Сервер подтвердил ваш отказ. Проходить тесты не нужно.</p>
          <p className="text-[var(--text-secondary)]">
            Если вы передумаете, обратитесь к тому, кто передал вам приглашение.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (sessionExpired || loadError?.status === 401) {
    return (
      <ErrorState
        title="Сеанс участия завершён"
        description="Если вы хотите продолжить участие или уточнить его состояние, обратитесь к отправителю приглашения."
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
          <TermsContent markdown={terms.bodyMarkdown} />
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardBody className="flex flex-col gap-4">
          <Checkbox
            checked={accepted}
            onChange={setAccepted}
            disabled={pending}
            label="Я прочитал(а) условия участия и согласен(на) пройти оценку."
          />

          {acceptMutation.error || declineMutation.error ? (
            <Callout tone="danger" role="alert" title="Не удалось сохранить решение">
              {acceptMutation.error?.problem.title ?? declineMutation.error?.problem.title}{' '}
              Проверьте подключение и повторите попытку.
            </Callout>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              size="lg"
              disabled={!accepted || declineMutation.isPending}
              disabledReason={!accepted && !pending ? 'Сначала подтвердите согласие' : undefined}
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
              disabled={acceptMutation.isPending}
              onClick={() => declineMutation.mutate()}
            >
              Не участвовать
            </Button>
          </div>

          {session.organizationContact ? (
            <p className="text-sm text-[var(--text-secondary)]">
              Вопросы об участии: {session.organizationContact}
            </p>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              Если у вас есть вопросы, обратитесь к тому, кто передал приглашение.
            </p>
          )}
        </CardBody>
      </Card>
    </>
  );
}
