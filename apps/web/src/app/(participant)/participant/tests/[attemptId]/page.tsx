'use client';

import { useRouter } from 'next/navigation';
import { use, useEffect, useRef, useState } from 'react';

import type {
  AnswerResponse,
  Envelope,
  MethodItem,
  ParticipantAttemptDetail,
  SaveAnswerResult,
} from '@context/contracts';

import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { AnswerSaveQueue } from '@/lib/answer-save-queue';
import { Badge } from '@/components/ui/badge';
import { ParticipantTopbarInfo } from '@/components/layout/participant-shell';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Callout, ErrorState, LoadingBlock } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

import { QuestionRenderer } from '@/components/assessment/question-renderer';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * Прохождение теста.
 *
 * Правила сохранения (ТЗ E05):
 *   * ответ уходит на сервер с задержкой, но переход к следующему вопросу
 *     ждёт подтверждения — несохранённое не выдаётся за сохранённое;
 *   * ревизия защищает от тихой перезаписи из второй вкладки;
 *   * ответы не хранятся в localStorage: персональные данные остаются на сервере.
 */
export default function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const router = useRouter();

  const [attempt, setAttempt] = useState<ParticipantAttemptDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerResponse>>({});
  const [moving, setMoving] = useState(false);
  const [invalidDraft, setInvalidDraft] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<AnswerSaveQueue<AnswerResponse> | null>(null);
  const navigationLock = useRef(false);
  const blocked = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    api
      .post<Envelope<ParticipantAttemptDetail>>(`/participant/attempts/${attemptId}/start`)
      .then((response) => {
        if (controller.signal.aborted) return;
        setAttempt(response.data);
        setAnswers(response.data.answers);
        queue.current = new AnswerSaveQueue(
          response.data.revision,
          async (id, value, revision) => {
            const result = await api.put<Envelope<SaveAnswerResult>>(
              `/participant/attempts/${attemptId}/answers/${id}`,
              { response: value, expectedRevision: revision },
            );
            return result.data.attemptRevision;
          },
          (state, cause) => {
            setSaveState((previous) =>
              state === 'idle' && previous === 'failed' ? 'failed' : state,
            );
            if (state === 'saved') setError(null);
            if (state === 'failed') {
              const apiError = cause instanceof ApiError ? cause : null;
              setError(apiError);
              if (apiError?.code === 'REVISION_CONFLICT') {
                blocked.current = true;
                setConflict(true);
              }
            }
          },
        );

        // Ссылка «Перейти к вопросу» со страницы проверки указывает на
        // конкретный вопрос через #item-<id>; иначе открываем последний
        // активный вопрос, который помнит сервер.
        const requestedId = window.location.hash.match(/^#item-(.+)$/)?.[1];
        const requestedPosition = requestedId
          ? response.data.items.findIndex((item) => item.id === requestedId)
          : -1;
        if (requestedPosition >= 0) {
          setIndex(requestedPosition);
          return;
        }
        const active = response.data.activeItemId;
        const position = active ? response.data.items.findIndex((item) => item.id === active) : 0;
        setIndex(position >= 0 ? position : 0);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof ApiError ? cause : null);
          setLoadFailed(true);
        }
      });
    return () => {
      controller.abort();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      queue.current?.dispose();
    };
  }, [attemptId]);

  // Фокус переводится на заголовок вопроса: экранный диктор объявляет смену шага.
  useEffect(() => {
    headingRef.current?.focus();
  }, [index, attempt]);

  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (queue.current?.dirty || invalidDraft) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [invalidDraft]);

  function handleChange(itemId: string, response: AnswerResponse): void {
    if (blocked.current || navigationLock.current) return;
    setAnswers((prev) => ({ ...prev, [itemId]: response }));
    queue.current?.enqueue(itemId, response);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!blocked.current) void queue.current?.flush();
    }, 600);
  }

  async function navigate(target: number | string): Promise<void> {
    if (!attempt || !queue.current || blocked.current || invalidDraft || navigationLock.current)
      return;
    navigationLock.current = true;
    setMoving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      if (!(await queue.current.flush())) return;
      if (typeof target === 'string') router.push(target);
      else setIndex(Math.min(Math.max(0, target), attempt.items.length - 1));
    } finally {
      navigationLock.current = false;
      setMoving(false);
    }
  }

  if (error?.status === 401) {
    return (
      <ErrorState
        title="Сессия участия истекла"
        description="Откройте персональную ссылку заново. Отправленные ответы сохранены на сервере."
      />
    );
  }

  if (loadFailed && !attempt) {
    return (
      <ErrorState
        title={error?.problem.title ?? 'Не удалось открыть тест'}
        description="Проверьте подключение и повторите попытку."
        requestId={error?.problem.requestId}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!attempt) {
    return <LoadingBlock label="Открываем тест" />;
  }

  if (!attempt.canEdit) {
    return (
      <ErrorState
        title="Ответы уже отправлены"
        description="Этот тест завершён, изменить ответы нельзя."
        action={<ButtonLink href="/participant">К списку тестов</ButtonLink>}
      />
    );
  }

  const item: MethodItem | undefined = attempt.items[index];
  if (!item) {
    return (
      <ErrorState
        title="В этом тесте пока нет вопросов"
        action={<ButtonLink href="/participant">К списку тестов</ButtonLink>}
      />
    );
  }

  const answeredCount = Object.keys(answers).length;
  const isLast = index === attempt.items.length - 1;

  return (
    <>
      {/* Название теста — в верхнюю строку оболочки; статус сохранения
          остаётся единственным aria-live внизу, чтобы диктор не повторялся. */}
      <ParticipantTopbarInfo context={attempt.title} />

      <header className="mb-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-[var(--text-secondary)]">{attempt.title}</p>
          <Badge tone="accent">
            Вопрос {index + 1} из {attempt.items.length}
          </Badge>
        </div>
        <Progress
          completed={answeredCount}
          total={attempt.items.length}
          label="Ответов заполнено"
        />
      </header>

      {conflict ? (
        <div className="mb-4">
          <Callout
            tone="warning"
            title="Тест открыт в другом окне"
            role="alert"
            action={
              <Button size="sm" onClick={() => window.location.reload()}>
                Обновить страницу
              </Button>
            }
          >
            Сервер получил изменения из другого окна. Обновление покажет последнюю сохранённую
            версию; неподтверждённый ввод в этой вкладке будет потерян.
          </Callout>
        </div>
      ) : null}

      {saveState === 'failed' && !conflict ? (
        <div className="mb-4">
          <Callout
            tone="danger"
            role="alert"
            title="Ответ не сохранён"
            action={
              <Button onClick={() => void queue.current?.flush()}>Повторить сохранение</Button>
            }
          >
            {error?.problem.title ??
              'Нет связи с сервером. Не закрывайте вкладку — ваш ответ остаётся здесь.'}
          </Callout>
        </div>
      ) : null}
      <Card>
        <CardBody className="flex flex-col gap-6 sm:p-8">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
            <span className="eyebrow">Ваш ответ</span>
            <span aria-hidden="true">·</span>
            <span>{item.required ? 'Обязательный вопрос' : 'Можно пропустить'}</span>
          </div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold leading-relaxed outline-none sm:text-2xl"
          >
            {item.type === 'situational' ? item.situation : item.prompt}
          </h1>

          {item.type === 'situational' ? (
            <p className="text-base font-medium">{item.prompt}</p>
          ) : null}

          {item.hint ? <p className="text-sm text-[var(--text-secondary)]">{item.hint}</p> : null}

          <fieldset
            disabled={conflict || moving}
            className="min-w-0 border-0 p-0 m-0 disabled:opacity-60"
          >
            <legend className="sr-only">Ответ на вопрос {index + 1}</legend>
            <QuestionRenderer
              key={item.id}
              onValidityChange={setInvalidDraft}
              item={item}
              value={answers[item.id]}
              onChange={(response) => handleChange(item.id, response)}
            />
          </fieldset>

          {!item.required ? (
            <p className="text-xs text-[var(--text-secondary)]">
              На этот вопрос можно не отвечать.
            </p>
          ) : null}
          {invalidDraft ? (
            <p role="alert" className="text-sm text-[var(--danger-text)]">
              Исправьте значение в поле, прежде чем переходить дальше.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <div
        className="surface-glass sticky bottom-0 -mx-4 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-hairline)] px-4 py-4"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        <p
          className="flex w-full items-center justify-center gap-2 text-xs text-[var(--text-secondary)] sm:order-2 sm:w-auto"
          aria-live="polite"
        >
          {saveState === 'saved' ? (
            <CheckCircle2 aria-hidden="true" className="size-4 text-[var(--success-text)]" />
          ) : null}
          {saveState === 'saving'
            ? 'Сохраняем…'
            : saveState === 'saved'
              ? 'Ответы сохранены'
              : saveState === 'failed'
                ? 'Ответ не сохранён'
                : queue.current?.dirty
                  ? 'Есть несохранённые изменения'
                  : 'Можно отвечать в своём темпе'}
        </p>
        <Button
          variant="ghost"
          icon={<ArrowLeft aria-hidden="true" />}
          onClick={() => void navigate(index - 1)}
          disabled={index === 0 || moving || conflict || invalidDraft}
        >
          Назад
        </Button>
        <Button
          variant="primary"
          className="sm:order-3"
          iconRight={<ArrowRight aria-hidden="true" />}
          loading={moving}
          disabled={conflict || invalidDraft}
          onClick={() =>
            void navigate(isLast ? `/participant/tests/${attemptId}/review` : index + 1)
          }
        >
          {isLast ? 'К проверке' : 'Далее'}
        </Button>
      </div>

      <div className="mt-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={moving || conflict || invalidDraft}
          onClick={() => void navigate('/participant')}
        >
          Сохранить и вернуться к списку
        </Button>
      </div>
    </>
  );
}
