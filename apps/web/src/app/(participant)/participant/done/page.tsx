'use client';

import { useState } from 'react';

import type { Envelope, ParticipantCompletion, ParticipantTerms } from '@context/contracts';

import { ParticipantTopbarInfo } from '@/components/layout/participant-shell';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, ErrorState, LoadingBlock } from '@/components/ui/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiQuery, useQueryClient } from '@/lib/query';

function contactHref(contact: string | null): string | undefined {
  if (!contact) return undefined;
  if (contact.includes('@')) return `mailto:${contact}`;
  if (/^[+\d][\d\s()-]{5,}$/.test(contact)) return `tel:${contact.replace(/[\s()-]/g, '')}`;
  return undefined;
}

export default function DonePage() {
  const queryClient = useQueryClient();
  const [termsOpen, setTermsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);

  const completionQuery = useApiQuery<Envelope<ParticipantCompletion>>(
    ['participant-completion'],
    loggedOut ? null : '/participant/completion',
    { staleTime: 0 },
  );
  const termsQuery = useApiQuery<Envelope<ParticipantTerms>>(
    ['participant-terms'],
    termsOpen && !loggedOut ? '/participant/terms' : null,
  );
  const data = completionQuery.data?.data;
  const error = completionQuery.error;

  async function logout(): Promise<void> {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(false);
    try {
      await api.post('/participant/logout');
      queryClient.clear();
      setLoggedOut(true);
    } catch {
      setLogoutError(true);
    } finally {
      setLoggingOut(false);
    }
  }

  if (loggedOut) {
    return (
      <Card>
        <CardHeader title="Сеанс завершён" />
        <CardBody>
          <p>Вы вышли из участия. Чтобы вернуться, используйте действующую персональную ссылку.</p>
        </CardBody>
      </Card>
    );
  }

  if (error?.status === 401) {
    return (
      <ErrorState
        title="Сессия завершена"
        description="Чтобы проверить состояние участия, откройте действующую персональную ссылку заново."
      />
    );
  }

  if (error && !data) {
    return (
      <ErrorState
        title={error.problem.title}
        requestId={error.problem.requestId}
        onRetry={completionQuery.refetch}
      />
    );
  }

  if (!data) return <LoadingBlock label="Проверяем состояние" />;

  const contactLink = contactHref(data.organizationContact);

  return (
    <>
      <ParticipantTopbarInfo help={data.organizationContact ?? undefined} helpHref={contactLink} />

      <header className="mb-6">
        <h1>{data.allSubmitted ? 'Ответы отправлены' : 'Остались незавершённые тесты'}</h1>
        {data.allSubmitted && data.submittedAt ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Отправлено {formatDateTime(data.submittedAt)}
          </p>
        ) : null}
      </header>

      {error ? (
        <div className="mb-5">
          <Callout tone="warning" role="alert" title="Не удалось обновить статус">
            Ранее полученная информация остаётся на экране. Проверьте подключение и повторите
            попытку.
          </Callout>
        </div>
      ) : null}

      <Card>
        <CardHeader title={data.allSubmitted ? 'Текущий статус' : 'Продолжить участие'} />
        <CardBody className="flex flex-col gap-4">
          <p className="font-medium">{data.stageLabel}</p>
          <p className="max-w-[var(--reading-max)] text-[var(--text-secondary)]">
            {data.explanation}
          </p>
          {!data.allSubmitted ? (
            <ButtonLink href="/participant" variant="primary">
              Вернуться к тестам
            </ButtonLink>
          ) : null}
          <div>
            <Button
              variant="secondary"
              loading={completionQuery.isFetching}
              onClick={completionQuery.refetch}
            >
              Обновить статус
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Информация об участии" />
        <CardBody className="flex flex-col gap-4">
          <p className="text-[var(--text-secondary)]">
            Условия участия и сведения об использовании ответов можно открыть ниже.
          </p>
          <details open={termsOpen} onToggle={(event) => setTermsOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer font-medium">Показать условия участия</summary>
            {termsQuery.error ? (
              <div className="mt-3">
                <Callout tone="danger" role="alert" title="Не удалось загрузить условия">
                  <Button size="sm" onClick={termsQuery.refetch}>
                    Повторить
                  </Button>
                </Callout>
              </div>
            ) : termsQuery.data?.data ? (
              <div className="mt-3 max-w-[var(--reading-max)] whitespace-pre-line break-words text-sm leading-relaxed">
                {termsQuery.data.data.bodyMarkdown.replace(/^#{1,3} /gm, '')}
              </div>
            ) : termsOpen ? (
              <LoadingBlock label="Загружаем условия" />
            ) : null}
          </details>
          {contactLink ? (
            <ButtonLink href={contactLink} variant="secondary">
              Связаться с ответственным
            </ButtonLink>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              По вопросам об участии обратитесь к отправителю приглашения.
            </p>
          )}
          <div>
            <ButtonLink href="/participant/privacy" variant="secondary">
              Управление участием
            </ButtonLink>
          </div>
          {logoutError ? (
            <Callout tone="danger" role="alert" title="Не удалось завершить сеанс">
              Проверьте подключение и повторите попытку.
            </Callout>
          ) : null}
          <div>
            <Button variant="ghost" loading={loggingOut} onClick={() => void logout()}>
              Завершить сеанс
            </Button>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
