import { StateMachine } from './state-machine';

/** Состояния попытки прохождения одной методики (ТЗ 01.5). */
export const ATTEMPT_STATES = [
  'not_started',
  'in_progress',
  'submitted',
  'scored',
  'scoring_failed',
] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];

/**
 * После `submitted` ответы неизменяемы. Повтор подсчёта не открывает их для редактирования,
 * поэтому из `scoring_failed` возможен только повторный подсчёт.
 */
export const attemptStateMachine = new StateMachine<AttemptState>('attempt', {
  not_started: ['in_progress'],
  in_progress: ['submitted'],
  submitted: ['scored', 'scoring_failed'],
  scoring_failed: ['scored', 'scoring_failed'],
  scored: [],
});

/** Ответы можно сохранять и изменять. */
export function acceptsAnswers(state: AttemptState): boolean {
  return state === 'not_started' || state === 'in_progress';
}

/** Ответы зафиксированы: редактирование запрещено на уровне API, а не только UI. */
export function isAnswersFrozen(state: AttemptState): boolean {
  return state === 'submitted' || state === 'scored' || state === 'scoring_failed';
}

/** Попытка учтена как завершённая участником. */
export function isSubmitted(state: AttemptState): boolean {
  return isAnswersFrozen(state);
}

export const ATTEMPT_STATE_LABELS: Readonly<Record<AttemptState, string>> = {
  not_started: 'Не начат',
  in_progress: 'В процессе',
  submitted: 'Отправлен',
  scored: 'Обработан',
  scoring_failed: 'Обработка задерживается',
};
