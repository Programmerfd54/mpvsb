import { StateMachine } from './state-machine';

/** Состояния назначения (ТЗ 01.5). */
export const ASSIGNMENT_STATES = [
  'draft',
  'invited',
  'in_progress',
  'completed',
  'cancelled',
  'expired',
] as const;

export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

/**
 * `completed` не возвращается назад: повторное прохождение — это новое назначение
 * со ссылкой `replaces_assignment_id`.
 */
export const assignmentStateMachine = new StateMachine<AssignmentState>('assignment', {
  draft: ['invited', 'cancelled'],
  invited: ['in_progress', 'cancelled', 'expired'],
  in_progress: ['completed', 'cancelled', 'expired'],
  completed: [],
  cancelled: [],
  expired: [],
});

/** Назначение принимает ответы участника. */
export function acceptsParticipation(state: AssignmentState): boolean {
  return state === 'invited' || state === 'in_progress';
}

/** Руководитель может выпустить новую ссылку. */
export function canIssueInvitation(state: AssignmentState): boolean {
  return state === 'draft' || state === 'invited' || state === 'in_progress';
}

/** Срок можно изменить только пока назначение живое. */
export function canChangeDeadline(state: AssignmentState): boolean {
  return state === 'invited' || state === 'in_progress';
}

export function canCancel(state: AssignmentState): boolean {
  return assignmentStateMachine.can(state, 'cancelled');
}

/** Пользовательский текст статуса (ТЗ 01.6). Технические детали не показываем. */
export const ASSIGNMENT_STATE_LABELS: Readonly<Record<AssignmentState, string>> = {
  draft: 'Черновик',
  invited: 'Ожидает начала',
  in_progress: 'В процессе',
  completed: 'Ответы получены',
  cancelled: 'Оценка отменена',
  expired: 'Срок ссылки истёк',
};

/**
 * Код случая: короткое обозначение назначения для технических экранов,
 * payload провайдера и экспорта исследования.
 *
 * Выводится из идентификатора назначения и не содержит сведений о человеке:
 * администратору и рецензенту для работы хватает кода, имя сотрудника
 * на эти экраны не выносится (ТЗ A08, A09, 10.4).
 */
export function caseCodeFor(assignmentId: string): string {
  return `CASE-${assignmentId.replaceAll('-', '').slice(-10).toUpperCase()}`;
}
