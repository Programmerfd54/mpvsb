'use client';

import { useState } from 'react';

import type {
  Envelope,
  ParticipantSession,
  ParticipantTerms,
  PrivacyReceipt,
  PrivacyRequestInput,
} from '@context/contracts';

import { ParticipantTopbarInfo } from '@/components/layout/participant-shell';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select, TextArea } from '@/components/ui/field';
import { Callout, ErrorState, LoadingBlock } from '@/components/ui/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query';

const REQUEST_LABELS: Record<PrivacyReceipt['requestType'], string> = {
  correction: 'Исправить сведения',
  access: 'Получить сведения об участии',
  withdrawal: 'Отозвать участие',
  deletion: 'Удалить данные',
};

function contactHref(contact: string | null): string | undefined {
  if (!contact) return undefined;
  if (contact.includes('@')) return `mailto:${contact}`;
  if (/^[+\d][\d\s()-]{5,}$/.test(contact)) return `tel:${contact.replace(/[\s()-]/g, '')}`;
  return undefined;
}

export default function ParticipantPrivacyPage() {
  const session = useApiQuery<Envelope<ParticipantSession>>(
    ['participant-session'],
    '/participant/session',
  );
  const terms = useApiQuery<Envelope<ParticipantTerms>>(
    ['participant-terms'],
    '/participant/terms',
  );
  const [requestType, setRequestType] = useState<PrivacyRequestInput['requestType']>('correction');
  const [description, setDescription] = useState('');

  const create = useApiMutation<PrivacyRequestInput, Envelope<PrivacyReceipt>>(
    (body) => api.post('/participant/privacy-requests', body),
    {
      onSuccess: () => setDescription(''),
    },
  );

  const data = session.data?.data;
  const contact = data?.organizationContact ?? null;
  const contactLink = contactHref(contact);

  if (session.error?.status === 401) {
    return (
      <ErrorState
        title="Сессия завершена"
        description="Откройте действующую персональную ссылку, чтобы отправить заявку по участию."
      />
    );
  }
  if (session.error) {
    return (
      <ErrorState
        title={session.error.problem.title}
        requestId={session.error.problem.requestId}
        onRetry={session.refetch}
      />
    );
  }
  if (!data) return <LoadingBlock label="Загружаем сведения об участии" />;

  return (
    <>
      <ParticipantTopbarInfo
        context={data.organizationName}
        help={contact ?? undefined}
        helpHref={contactLink}
      />

      <header className="mb-6">
        <h1>Информация об участии</h1>
        <p className="mt-2 max-w-[var(--reading-max)] text-[var(--text-secondary)]">
          Здесь можно отправить запрос по своим данным участия. Заявка фиксируется на сервере и
          получает номер; дальнейшая обработка идёт по внутренней процедуре организации.
        </p>
      </header>

      {create.data ? (
        <Card className="mb-5">
          <CardHeader title="Заявка получена" />
          <CardBody className="flex flex-col gap-3">
            <p>
              Номер заявки: <strong>{create.data.data.receiptCode}</strong>
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              Тип: {REQUEST_LABELS[create.data.data.requestType]} · создана{' '}
              {formatDateTime(create.data.data.submittedAt)}
            </p>
            <p className="max-w-[var(--reading-max)] text-[var(--text-secondary)]">
              {create.data.data.explanation}
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Отправить заявку" />
        <CardBody>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate({ requestType, description });
            }}
          >
            {create.error && create.error.problem.fieldErrors.length === 0 ? (
              <ErrorState
                title={create.error.problem.title}
                requestId={create.error.problem.requestId}
              />
            ) : null}
            <Field label="Тип заявки" required error={create.error?.fieldError('requestType')}>
              {({ inputId, describedBy }) => (
                <Select
                  id={inputId}
                  aria-describedby={describedBy}
                  value={requestType}
                  onChange={(event) =>
                    setRequestType(event.target.value as PrivacyRequestInput['requestType'])
                  }
                >
                  <option value="correction">{REQUEST_LABELS.correction}</option>
                  <option value="access">{REQUEST_LABELS.access}</option>
                  <option value="withdrawal">{REQUEST_LABELS.withdrawal}</option>
                </Select>
              )}
            </Field>
            <Field
              label="Описание"
              required
              hint="Не указывайте лишние персональные данные. Достаточно описать, что нужно проверить или изменить."
              error={create.error?.fieldError('description')}
            >
              {({ inputId, describedBy }) => (
                <TextArea
                  id={inputId}
                  aria-describedby={describedBy}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  maxLength={2000}
                  required
                />
              )}
            </Field>
            <div>
              <Button
                type="submit"
                variant="primary"
                loading={create.isPending}
                disabled={description.trim().length < 5}
              >
                Отправить заявку
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Условия участия" />
        <CardBody>
          {terms.error ? (
            <Callout tone="danger" role="alert" title="Не удалось загрузить условия">
              <Button size="sm" onClick={terms.refetch}>
                Повторить
              </Button>
            </Callout>
          ) : terms.data ? (
            <div className="max-w-[var(--reading-max)] whitespace-pre-line break-words text-sm leading-relaxed">
              {terms.data.data.bodyMarkdown.replace(/^#{1,3} /gm, '')}
            </div>
          ) : (
            <LoadingBlock label="Загружаем условия" />
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href="/participant/done">Назад к статусу</ButtonLink>
            {contactLink ? (
              <ButtonLink href={contactLink} variant="secondary">
                Связаться с ответственным
              </ButtonLink>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </>
  );
}
