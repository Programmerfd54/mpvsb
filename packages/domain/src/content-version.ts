import { StateMachine } from './state-machine';

/** Жизненный цикл версии методики и версии сценария (ТЗ 01.5). */
export const CONTENT_VERSION_STATES = [
  'draft',
  'review',
  'published',
  'suspended_for_new_assignments',
  'retired',
] as const;

export type ContentVersionState = (typeof CONTENT_VERSION_STATES)[number];

/**
 * Опубликованное содержимое не редактируется. `suspended_for_new_assignments`
 * запрещает новые назначения, не ломая уже выданные.
 */
export const contentVersionStateMachine = new StateMachine<ContentVersionState>('content_version', {
  draft: ['review', 'retired'],
  review: ['draft', 'published', 'retired'],
  published: ['suspended_for_new_assignments', 'retired'],
  suspended_for_new_assignments: ['published', 'retired'],
  retired: [],
});

/** Понятные названия состояний для сообщений пользователю. */
export const CONTENT_VERSION_STATE_LABELS: Readonly<Record<ContentVersionState, string>> = {
  draft: 'черновик',
  review: 'на проверке',
  published: 'опубликована',
  suspended_for_new_assignments: 'приостановлена для новых назначений',
  retired: 'снята',
};

/** Версию можно назначать новым сотрудникам. */
export function isAssignable(state: ContentVersionState): boolean {
  return state === 'published';
}

/** Содержимое версии неизменяемо. */
export function isImmutable(state: ContentVersionState): boolean {
  return state !== 'draft';
}

/**
 * Уровень готовности содержимого (ТЗ 00.3).
 * `published` означает доступность в системе, а не доказанную точность.
 */
export const APPLICABILITY_MODES = ['demo', 'research', 'validated_use'] as const;
export type ApplicabilityMode = (typeof APPLICABILITY_MODES)[number];

export const APPLICABILITY_MODE_LABELS: Readonly<Record<ApplicabilityMode, string>> = {
  demo: 'Демонстрация на синтетических данных',
  research: 'Исследовательское применение',
  validated_use: 'Проверенное применение в заявленных границах',
};

const MODE_RANK: Readonly<Record<ApplicabilityMode, number>> = {
  demo: 0,
  research: 1,
  validated_use: 2,
};

/**
 * Методику режима `demo` нельзя назначить в организации режима `research`.
 * Содержимое должно быть не ниже режима запуска.
 */
export function isContentAllowedInMode(
  contentMode: ApplicabilityMode,
  runMode: ApplicabilityMode,
): boolean {
  return MODE_RANK[contentMode] >= MODE_RANK[runMode];
}
