/** Три исходных бизнес-вопроса (ТЗ 00.1). */
export const SCENARIO_CODES = [
  'development_investment',
  'role_readiness',
  'retention_conditions',
] as const;

export type ScenarioCode = (typeof SCENARIO_CODES)[number];

export const SCENARIO_TITLES: Readonly<Record<ScenarioCode, string>> = {
  development_investment: 'Обучение и развитие',
  role_readiness: 'Готовность к новой роли',
  retention_conditions: 'Условия продолжения работы',
};

export const SCENARIO_PURPOSES: Readonly<Record<ScenarioCode, string>> = {
  development_investment:
    'Собрать основания для вложения в конкретное обучение и условия применения результата.',
  role_readiness:
    'Сопоставить подтверждённые сведения с требованиями указанной роли и показать пробелы.',
  retention_conditions:
    'Собрать сведения об условиях и намерениях, которые стоит обсудить с сотрудником.',
};

/** Что платформа не обещает по каждому сценарию. Показывается до создания назначения. */
export const SCENARIO_LIMITS: Readonly<Record<ScenarioCode, string>> = {
  development_investment:
    'Платформа не рассчитывает окупаемость обучения и не подтверждает причинную связь между курсом и результатом.',
  role_readiness:
    'Платформа не гарантирует успех в новой роли и не заменяет проверку профессиональных требований.',
  retention_conditions:
    'Платформа не прогнозирует уход сотрудника: прогноз доступен только при отдельно проверенной модели.',
};

/** Действия руководителя, доступные при фиксации решения (ТЗ M09). */
export const DECISION_ACTIONS = [
  'discussed_with_employee',
  'collected_more_information',
  'scheduled_follow_up',
  'approved_next_step',
  'postponed',
  'no_action',
] as const;

export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export const DECISION_ACTION_LABELS: Readonly<Record<DecisionAction, string>> = {
  discussed_with_employee: 'Обсудил с сотрудником',
  collected_more_information: 'Собираю дополнительные сведения',
  scheduled_follow_up: 'Назначил следующее обсуждение',
  approved_next_step: 'Согласовал следующий шаг',
  postponed: 'Отложил решение',
  no_action: 'Решение пока не требуется',
};
