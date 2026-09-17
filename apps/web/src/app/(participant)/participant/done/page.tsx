'use client';

import { useEffect, useState } from 'react';

import type { Envelope, ParticipantCompletion } from '@context/contracts';

import { ParticipantTopbarInfo } from '@/components/layout/participant-shell';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StageIndicator } from '@/components/ui/progress';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiQuery } from '@/lib/query';

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
 * Завершение участия.
 *
 * Стадия отражает реальное состояние обработки. Точный срок готовности не
 * обещается: он зависит от проверки человеком (ТЗ E07).
 */
export default function DonePage() {
  const [declined, setDeclined] = useState<boolean | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setDeclined(new URLSearchParams(window.location.search).get('declined') === '1');
  }, []);

  const completionQuery = useApiQuery<Envelope<ParticipantCompletion>>(
    ['participant-completion'],
    declined === false ? '/participant/completion' : null,
  );
  const data = completionQuery.data?.data;
  const error = completionQuery.error;

  if (declined) {
    return (
      <Card>
        <CardHeader title="Вы отказались от участия" />
        <CardBody className="flex flex-col gap-3">
          <p className="text-sm">
            Мы записали ваш ответ. Это нейтральная отметка: она не интерпретируется как оценка вас
            или вашей работы.
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            Если вы передумаете, обратитесь к тому, кто передал вам ссылку.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (error?.status === 401) {
    return (
      <ErrorState
        title="Сеанс завершён"
        description="Ваши ответы сохранены. Дополнительных действий не требуется."
      />
    );
  }

  if (error) {
    return (
      <ErrorState
        title={error.problem.title}
        requestId={error.problem.requestId}
        onRetry={completionQuery.refetch}
      />
    );
  }

  if (declined === null || !data) {
    return <LoadingBlock label="Проверяем состояние" />;
  }

  const stage = !data.allSubmitted
    ? 'received'
    : data.stageLabel.includes('проверк')
      ? 'review'
      : data.stageLabel.includes('передано')
        ? 'ready'
        : 'processing';

  const contactLink = contactHref(data.organizationContact);

  return (
    <>
      <ParticipantTopbarInfo help={data.organizationContact ?? undefined} helpHref={contactLink} />

      <header className="mb-6">
        <h1>Спасибо, ответы получены</h1>
        {data.submittedAt ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Отправлено {formatDateTime(data.submittedAt)}
          </p>
        ) : null}
      </header>

      <Card>
        <CardHeader title="Что происходит сейчас" />
        <CardBody className="flex flex-col gap-4">
          <StageIndicator stage={stage as 'received' | 'processing' | 'review' | 'ready'} />
          <p className="text-sm">{data.stageLabel}</p>
          <p className="max-w-[var(--reading-max)] text-sm text-[var(--text-secondary)]">
            {data.explanation}
          </p>
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Ваши возможности" />
        <CardBody className="flex flex-col gap-3">
          <p className="text-sm text-[var(--text-secondary)]">
            Вы можете запросить копию своих данных, их исправление или прекращение обработки.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/participant/privacy" variant="secondary">
              Информация об участии
            </ButtonLink>
            {contactLink ? (
              <ButtonLink href={contactLink} variant="secondary">
                Связаться с ответственным
              </ButtonLink>
            ) : null}
            <Button
              variant="ghost"
              loading={loggingOut}
              onClick={() => {
                setLoggingOut(true);
                void api.post('/participant/logout').finally(() => {
                  window.location.assign('/participate');
                });
              }}
            >
              Завершить сеанс
            </Button>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
