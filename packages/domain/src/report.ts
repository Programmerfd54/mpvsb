import { StateMachine } from './state-machine';

/** Состояния ревизии заключения (ТЗ 01.5). */
export const REPORT_REVISION_STATES = [
  'queued',
  'generating',
  'generation_failed',
  'pending_review',
  'revision_requested',
  'published',
  'superseded',
] as const;

export type ReportRevisionState = (typeof REPORT_REVISION_STATES)[number];

/**
 * Публикация неизменяема: `published` переходит только в `superseded`,
 * когда опубликована следующая ревизия. Исправление — всегда новая ревизия.
 */
export const reportRevisionStateMachine = new StateMachine<ReportRevisionState>('report_revision', {
  queued: ['generating'],
  generating: ['pending_review', 'generation_failed'],
  generation_failed: ['generating'],
  pending_review: ['published', 'revision_requested'],
  revision_requested: [],
  published: ['superseded'],
  superseded: [],
});

/** Ревизия видна обычному руководителю. */
export function isVisibleToManager(state: ReportRevisionState): boolean {
  return state === 'published' || state === 'superseded';
}

/** Ревизия доступна рецензенту с соответствующим разрешением. */
export function isReviewable(state: ReportRevisionState): boolean {
  return state === 'pending_review';
}

/**
 * Статус, который показываем руководителю по назначению.
 * Служебные подробности конвейера наружу не выводим.
 */
export const REPORT_STATE_LABELS: Readonly<Record<ReportRevisionState, string>> = {
  queued: 'Ответы получены · готовим заключение',
  generating: 'Ответы получены · готовим заключение',
  generation_failed: 'Подготовка задерживается',
  pending_review: 'Заключение на проверке',
  revision_requested: 'Заключение на доработке',
  published: 'Заключение готово',
  superseded: 'Заменено более новой версией',
};

/** Достаточность сведений для заявленного объёма вывода (ТЗ 09.6). */
export const SUPPORT_LEVELS = [
  'sufficient_for_stated_scope',
  'partial',
  'insufficient',
  'not_applicable',
] as const;

export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export const SUPPORT_LEVEL_LABELS: Readonly<Record<SupportLevel, string>> = {
  sufficient_for_stated_scope: 'Сведений достаточно для заявленного объёма вывода',
  partial: 'Сведений частично достаточно',
  insufficient: 'Сведений недостаточно',
  not_applicable: 'Вывод неприменим к этому случаю',
};

/** Как подготовлена ревизия. Маркер обязателен в тексте отчёта. */
export const GENERATION_MODES = ['fake', 'template', 'llm'] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const GENERATION_MODE_LABELS: Readonly<Record<GenerationMode, string>> = {
  fake: 'Синтетический пример (демонстрация)',
  template: 'Структурированный шаблон по правилам',
  llm: 'Подготовлено языковой моделью, проверено человеком',
};
