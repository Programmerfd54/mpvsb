import { StateMachine } from './state-machine';

/** Фазы исследования (ТЗ 11.3). */
export const STUDY_PHASES = [
  'draft',
  'locked',
  'collecting',
  'predictions_frozen',
  'outcomes_open',
  'evaluated',
  'archived',
] as const;

export type StudyPhase = (typeof STUDY_PHASES)[number];

export const studyPhaseStateMachine = new StateMachine<StudyPhase>('study', {
  draft: ['locked'],
  locked: ['collecting'],
  collecting: ['predictions_frozen'],
  predictions_frozen: ['outcomes_open'],
  outcomes_open: ['evaluated'],
  evaluated: ['archived', 'outcomes_open'],
  archived: [],
});

export const STUDY_PHASE_LABELS: Readonly<Record<StudyPhase, string>> = {
  draft: 'Черновик протокола',
  locked: 'Протокол зафиксирован',
  collecting: 'Сбор допустимых входных сведений',
  predictions_frozen: 'Прогнозы заморожены',
  outcomes_open: 'Ввод исходов открыт',
  evaluated: 'Сравнение рассчитано',
  archived: 'В архиве',
};

/** Тип данных исследования. Определяет, что вообще допустимо заключать (ТЗ 11.1). */
export const STUDY_TYPES = [
  'historical_snapshot',
  'prospective',
  'retrospective_description',
] as const;

export type StudyType = (typeof STUDY_TYPES)[number];

export const STUDY_TYPE_LABELS: Readonly<Record<StudyType, string>> = {
  historical_snapshot: 'Исторические снимки до события',
  prospective: 'Проспективное наблюдение',
  retrospective_description: 'Описательный ретроспективный разбор',
};

export const STUDY_TYPE_CLAIM_LIMITS: Readonly<Record<StudyType, string>> = {
  historical_snapshot:
    'Ретроспективная проверка метода на сведениях, доступных до события. Не заменяет проспективную проверку.',
  prospective:
    'Проспективная проверка при соблюдении протокола. Качество вывода ограничено размером выборки.',
  retrospective_description:
    'Описательное сопоставление. Не является доказательством предсказания: последствия события могли повлиять на ответы.',
};

/**
 * Исходы принимаются только после заморозки прогнозов.
 * Это проверяется сервером отдельного процесса, а не только UI.
 */
export function acceptsOutcomes(phase: StudyPhase): boolean {
  return phase === 'outcomes_open' || phase === 'evaluated';
}

/** Прогнозы можно вносить и изменять. */
export function acceptsPredictions(phase: StudyPhase): boolean {
  return phase === 'collecting';
}

/** Состав случаев и прогнозы неизменяемы. */
export function isFrozen(phase: StudyPhase): boolean {
  return (
    phase === 'predictions_frozen' ||
    phase === 'outcomes_open' ||
    phase === 'evaluated' ||
    phase === 'archived'
  );
}

/**
 * До заморозки скрываются не только исходы, но и любые агрегаты по ним (ТЗ 11.4).
 */
export function mayRevealOutcomeAggregates(phase: StudyPhase): boolean {
  return phase === 'evaluated' || phase === 'archived';
}
