'use client';

import { useRouter } from 'next/navigation';
import { use } from 'react';

import type {
  Envelope,
  ParticipantAttemptDetail,
  ParticipantAttemptSummary,
} from '@context/contracts';

import { ParticipantTopbarInfo } from '@/components/layout/participant-shell';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, ErrorState, LoadingBlock } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';

const TYPE_LABELS = {
  single_choice: 'выбор одного варианта',
  multiple_choice: 'выбор нескольких вариантов',
  likert: 'шкала с подписями',
  numeric: 'числовой ответ',
  short_text: 'текстовый ответ',
  situational: 'ситуационный вопрос',
} as const;

export default function TestIntroPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const router = useRouter();
  const attemptQuery = useApiQuery<Envelope<ParticipantAttemptDetail>>(
    ['participant-attempt', attemptId],
    `/participant/attempts/${attemptId}`,
    { staleTime: 0 },
  );
  const summariesQuery = useApiQuery<Envelope<ParticipantAttemptSummary[]>>(
    ['participant-attempts'],
    '/participant/attempts',
  );
  const start = useApiMutation<void, Envelope<ParticipantAttemptDetail>>(
    () => api.post(`/participant/attempts/${attemptId}/start`),
    {
      invalidate: [['participant-attempts'], ['participant-attempt', attemptId]],
      onSuccess: () => router.push(`/participant/tests/${attemptId}`),
    },
  );

  if (attemptQuery.error) {
    return (
      <ErrorState
        title={attemptQuery.error.problem.title}
        requestId={attemptQuery.error.problem.requestId}
        onRetry={attemptQuery.refetch}
        action={<ButtonLink href="/participant">К списку тестов</ButtonLink>}
      />
    );
  }
  if (!attemptQuery.data || attemptQuery.isFetching)
    return <LoadingBlock label="Загружаем инструкцию" />;

  const attempt = attemptQuery.data.data;
  const summary = summariesQuery.data?.data.find((item) => item.attemptId === attemptId);
  if (!attempt.canEdit) {
    return (
      <ErrorState
        title="Ответы уже отправлены"
        description="Этот тест нельзя начать повторно."
        action={<ButtonLink href="/participant">К списку тестов</ButtonLink>}
      />
    );
  }

  const types = [...new Set(attempt.items.map((item) => TYPE_LABELS[item.type]))];
  const requiredCount = attempt.items.filter((item) => item.required).length;

  return (
    <>
      <ParticipantTopbarInfo context={attempt.title} />
      <header className="mb-6 flex flex-col gap-2">
        <p className="text-sm text-[var(--text-secondary)]">Перед началом теста</p>
        <h1>{attempt.title}</h1>
        <Badge tone="neutral">{attempt.items.length} вопросов</Badge>
      </header>
      <Card>
        <CardHeader title="Как проходит тест" />
        <CardBody className="flex flex-col gap-5">
          <p className="max-w-[var(--reading-max)] whitespace-pre-line break-words leading-relaxed">
            {attempt.participantIntro}
          </p>
          <div>
            <h2 className="font-semibold">Формат вопросов</h2>
            <p className="mt-1 text-[var(--text-secondary)]">{types.join(', ')}.</p>
            {summary?.estimatedMinutes ? (
              <p className="mt-1 text-[var(--text-secondary)]">
                Ориентировочно {summary.estimatedMinutes} мин.
              </p>
            ) : null}
          </div>
          {summary && summary.limitations.length > 0 ? (
            <div>
              <h2 className="font-semibold">Что важно знать</h2>
              <ul className="mt-2 list-disc space-y-1 pl-6 text-[var(--text-secondary)]">
                {summary.limitations.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h2 className="font-semibold">Ответы и завершение</h2>
            <p className="mt-1 text-[var(--text-secondary)]">
              Обязательных вопросов: {requiredCount} из {attempt.items.length}. Вы сможете
              возвращаться к вопросам; переход ждёт сохранения ответа на сервере. Перед отправкой
              увидите список пропущенных обязательных вопросов.
            </p>
          </div>
          {start.error ? (
            <Callout tone="danger" role="alert" title="Не удалось начать тест">
              {start.error.problem.title} Проверьте подключение и повторите попытку.
            </Callout>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              size="lg"
              loading={start.isPending}
              onClick={() => start.mutate()}
            >
              {attempt.state === 'not_started' ? 'Начать тест' : 'Продолжить тест'}
            </Button>
            <ButtonLink href="/participant" variant="secondary" size="lg">
              К списку тестов
            </ButtonLink>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
