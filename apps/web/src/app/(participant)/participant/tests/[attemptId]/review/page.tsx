'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useRef, useState } from 'react';

import type { Envelope, ParticipantAttemptDetail, SubmitAttemptResult } from '@context/contracts';

import { ParticipantTopbarInfo } from '@/components/layout/participant-shell';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Callout, ErrorState, LoadingBlock } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';

/**
 * Проверка перед отправкой.
 *
 * Показываются пропуски и ссылки на конкретные вопросы. Содержание уже данных
 * ответов не перечисляется: право на просмотр зависит от методики, а по
 * умолчанию его нет (ТЗ E06).
 */
export default function AttemptReviewPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  const attemptQuery = useApiQuery<Envelope<ParticipantAttemptDetail>>(
    ['participant-attempt', attemptId],
    `/participant/attempts/${attemptId}`,
    { staleTime: 0 },
  );
  const attempt = attemptQuery.data?.data;

  const submitMutation = useApiMutation<
    { expectedRevision: number },
    Envelope<SubmitAttemptResult>
  >((body) => api.post(`/participant/attempts/${attemptId}/submit`, body), {
    onSuccess: (result) => {
      setConfirmOpen(false);
      notify.success('Ответы отправлены');
      router.push(
        result.data.allSubmitted
          ? '/participant/done'
          : result.data.nextAttemptId
            ? `/participant/tests/${result.data.nextAttemptId}`
            : '/participant',
      );
    },
    onError: () => setConfirmOpen(false),
  });

  if (attemptQuery.error?.status === 401) {
    return (
      <ErrorState
        title="Сессия участия истекла"
        description="Откройте персональную ссылку заново. Отправленные ответы сохранены на сервере."
      />
    );
  }

  if (attemptQuery.error && !attempt) {
    return (
      <ErrorState
        title={attemptQuery.error.problem.title}
        requestId={attemptQuery.error.problem.requestId}
        onRetry={attemptQuery.refetch}
      />
    );
  }

  if (!attempt || attemptQuery.isFetching) {
    return <LoadingBlock label="Готовим проверку" />;
  }

  const missing = attempt.items.filter((item) => item.required && !attempt.answers[item.id]);
  const answered = Object.keys(attempt.answers).length;
  const submitError = submitMutation.error;

  return (
    <>
      <ParticipantTopbarInfo context={attempt.title} />

      <header className="mb-5 flex flex-col gap-2">
        <p className="text-sm text-[var(--text-secondary)]">{attempt.title}</p>
        <h1>Проверка перед отправкой</h1>
      </header>

      {submitError ? (
        <div className="mb-5">
          <Callout tone="danger" role="alert" title="Не удалось отправить ответы">
            {submitError.problem.fieldErrors.map((item) => item.message).join('; ') ||
              submitError.problem.title}
          </Callout>
        </div>
      ) : null}

      <Card>
        <CardHeader title={`Отвечено ${answered} из ${attempt.items.length}`} />
        <CardBody className="flex flex-col gap-4">
          {missing.length === 0 ? (
            <p className="text-sm">Все обязательные вопросы заполнены.</p>
          ) : (
            <>
              <p className="text-sm">
                Остались без ответа обязательные вопросы: {missing.length}. Вернитесь и заполните
                их.
              </p>
              <ul className="flex list-none flex-col gap-2 p-0">
                {missing.map((item) => {
                  const position = attempt.items.findIndex((candidate) => candidate.id === item.id);
                  return (
                    <li key={item.id}>
                      <Link
                        href={`/participant/tests/${attemptId}#item-${item.id}`}
                        className="text-sm"
                      >
                        Перейти к вопросу {position + 1}: {item.prompt.slice(0, 80)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              ref={submitButtonRef}
              variant="primary"
              size="lg"
              disabled={missing.length > 0}
              disabledReason={
                missing.length > 0 ? 'Сначала ответьте на обязательные вопросы' : undefined
              }
              onClick={() => setConfirmOpen(true)}
            >
              Отправить ответы
            </Button>
            <ButtonLink href={`/participant/tests/${attemptId}`} variant="secondary" size="lg">
              Вернуться к вопросам
            </ButtonLink>
          </div>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Отправить ответы?"
        description="После отправки изменить ответы этого теста будет нельзя."
        consequences={[
          'Ответы будут переданы на обработку.',
          'Остальные тесты, если они есть, останутся доступны.',
        ]}
        confirmLabel="Отправить"
        loading={submitMutation.isPending}
        onConfirm={() => submitMutation.mutate({ expectedRevision: attempt.revision })}
        returnFocusRef={submitButtonRef}
      />
    </>
  );
}
