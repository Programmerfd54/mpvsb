import type { ContextSchema } from '@context/contracts';
import {
  SCENARIO_LIMITS,
  SCENARIO_PURPOSES,
  SCENARIO_TITLES,
  type ScenarioCode,
} from '@context/domain';

/**
 * Три сценария P0 с синтетическим наполнением.
 *
 * Состав методик демонстрационный: он показывает, что набор задаётся версией
 * сценария, а не выбирается руководителем. Научного основания связывать эти
 * синтетические методики с бизнес-выводом нет и не заявляется.
 */

export interface SyntheticScenario {
  readonly code: ScenarioCode;
  readonly semanticVersion: string;
  readonly title: string;
  readonly purpose: string;
  readonly limits: string;
  readonly contextSchema: ContextSchema;
  /** Коды методик в зафиксированном порядке прохождения. */
  readonly methodCodes: readonly string[];
  readonly reportingPolicyCode: string;
}

/** Общие поля контекста решения, обязательные для всех сценариев. */
const commonFields: ContextSchema['fields'] = [
  {
    key: 'decisionQuestion',
    label: 'Какое решение вы принимаете',
    hint: 'Опишите конкретный вопрос по этому сотруднику: что именно нужно решить и к какому сроку.',
    type: 'textarea',
    required: true,
    minLength: 20,
    maxLength: 2000,
    isOpinion: false,
    evidenceRole: 'context',
  },
  {
    key: 'decisionHorizon',
    label: 'Когда нужно решение',
    type: 'date',
    required: true,
    isOpinion: false,
    evidenceRole: 'context',
  },
  {
    key: 'currentRole',
    label: 'Текущая роль сотрудника',
    type: 'text',
    required: true,
    maxLength: 120,
    isOpinion: false,
    evidenceRole: 'context',
  },
  {
    key: 'workFacts',
    label: 'Наблюдаемые рабочие факты',
    hint: 'Конкретные события и результаты: что и когда происходило. Без оценок личности.',
    type: 'textarea',
    required: false,
    maxLength: 4000,
    isOpinion: false,
    evidenceRole: 'fact',
  },
  {
    key: 'managerOpinion',
    label: 'Ваше мнение о ситуации',
    hint: 'Это поле отмечается в заключении как мнение руководителя, а не как проверенный факт.',
    type: 'textarea',
    required: false,
    maxLength: 2000,
    isOpinion: true,
    evidenceRole: 'opinion',
  },
  {
    key: 'constraints',
    label: 'Ограничения',
    hint: 'Бюджет, сроки, требования, которые нельзя изменить.',
    type: 'textarea',
    required: false,
    maxLength: 2000,
    isOpinion: false,
    evidenceRole: 'context',
  },
];

export const scenarioDevelopmentInvestment: SyntheticScenario = {
  code: 'development_investment',
  semanticVersion: '1.0.0',
  title: SCENARIO_TITLES.development_investment,
  purpose: SCENARIO_PURPOSES.development_investment,
  limits: SCENARIO_LIMITS.development_investment,
  reportingPolicyCode: 'policy_development_investment',
  methodCodes: ['synthetic_work_context', 'synthetic_task_preferences'],
  contextSchema: {
    fields: [
      ...commonFields,
      {
        key: 'trainingName',
        label: 'Какое обучение рассматривается',
        type: 'text',
        required: true,
        maxLength: 300,
        isOpinion: false,
        evidenceRole: 'context',
      },
      {
        key: 'targetTask',
        label: 'Для какой рабочей задачи нужен результат обучения',
        type: 'textarea',
        required: true,
        minLength: 10,
        maxLength: 2000,
        isOpinion: false,
        evidenceRole: 'context',
      },
      {
        key: 'skillGap',
        label: 'Какого навыка, по вашим наблюдениям, не хватает',
        type: 'textarea',
        required: false,
        maxLength: 2000,
        isOpinion: true,
        evidenceRole: 'opinion',
      },
      {
        key: 'applicationSupport',
        label: 'Как сотрудник сможет применить результат',
        hint: 'Кто поддержит, на каких задачах, в какой срок.',
        type: 'textarea',
        required: false,
        maxLength: 2000,
        isOpinion: false,
        evidenceRole: 'context',
      },
      {
        key: 'trainingCostMinor',
        label: 'Стоимость обучения, копейки',
        hint: 'Необязательно. Это ваш ввод: платформа не рассчитывает окупаемость.',
        type: 'money',
        required: false,
        isOpinion: false,
        evidenceRole: 'context',
      },
    ],
  },
};

export const scenarioRoleReadiness: SyntheticScenario = {
  code: 'role_readiness',
  semanticVersion: '1.0.0',
  title: SCENARIO_TITLES.role_readiness,
  purpose: SCENARIO_PURPOSES.role_readiness,
  limits: SCENARIO_LIMITS.role_readiness,
  reportingPolicyCode: 'policy_role_readiness',
  methodCodes: ['synthetic_work_context', 'synthetic_situational_choices'],
  contextSchema: {
    fields: [
      ...commonFields,
      {
        key: 'targetRole',
        label: 'Целевая роль',
        type: 'text',
        required: true,
        maxLength: 120,
        isOpinion: false,
        evidenceRole: 'context',
      },
      {
        key: 'newResponsibilities',
        label: 'Какие обязанности появятся',
        type: 'textarea',
        required: true,
        minLength: 10,
        maxLength: 2000,
        isOpinion: false,
        evidenceRole: 'context',
      },
      {
        key: 'successCriteria',
        label: 'По каким признакам вы поймёте, что человек справился',
        type: 'textarea',
        required: true,
        minLength: 10,
        maxLength: 2000,
        isOpinion: false,
        evidenceRole: 'context',
      },
      {
        key: 'availableAuthority',
        label: 'Какие полномочия будут у сотрудника',
        type: 'textarea',
        required: false,
        maxLength: 2000,
        isOpinion: false,
        evidenceRole: 'context',
      },
      {
        key: 'alternatives',
        label: 'Какие альтернативы вы рассматриваете',
        type: 'textarea',
        required: false,
        maxLength: 2000,
        isOpinion: false,
        evidenceRole: 'context',
      },
    ],
  },
};

export const scenarioRetentionConditions: SyntheticScenario = {
  code: 'retention_conditions',
  semanticVersion: '1.0.0',
  title: SCENARIO_TITLES.retention_conditions,
  purpose: SCENARIO_PURPOSES.retention_conditions,
  limits: SCENARIO_LIMITS.retention_conditions,
  reportingPolicyCode: 'policy_retention_conditions',
  methodCodes: [
    'synthetic_work_context',
    'synthetic_task_preferences',
    'synthetic_situational_choices',
  ],
  contextSchema: {
    fields: [
      ...commonFields,
      {
        key: 'situationType',
        label: 'Что именно вы хотите обсудить',
        type: 'select',
        required: true,
        isOpinion: false,
        evidenceRole: 'context',
        options: [
          { value: 'workload', label: 'Нагрузка и распределение задач' },
          { value: 'role_change', label: 'Изменение роли или обязанностей' },
          { value: 'conditions', label: 'Условия работы и график' },
          { value: 'growth', label: 'Перспективы развития' },
        ],
      },
      {
        key: 'plannedChanges',
        label: 'Какие изменения условий возможны',
        hint: 'Что вы реально можете изменить, а что нет.',
        type: 'textarea',
        required: true,
        minLength: 10,
        maxLength: 2000,
        isOpinion: false,
        evidenceRole: 'context',
      },
      {
        key: 'managerInfluence',
        label: 'На что вы можете повлиять',
        type: 'textarea',
        required: false,
        maxLength: 2000,
        isOpinion: false,
        evidenceRole: 'context',
      },
    ],
  },
};

export const SYNTHETIC_SCENARIOS: readonly SyntheticScenario[] = [
  scenarioDevelopmentInvestment,
  scenarioRoleReadiness,
  scenarioRetentionConditions,
];

/**
 * Политики отчёта: какие утверждения допустимы, какие обязательны и какие запрещены.
 * Проверяются после генерации: несоответствие блокирует публикацию (ТЗ 09.7).
 */
export interface SyntheticReportingPolicy {
  readonly code: string;
  readonly semanticVersion: string;
  readonly permittedClaims: readonly string[];
  readonly requiredLimitations: readonly string[];
  readonly forbiddenClaims: readonly string[];
}

const COMMON_FORBIDDEN = [
  'медицинский диагноз или состояние здоровья',
  'вероятность события в процентах без проверенной модели',
  'рекомендация уволить, понизить или наказать',
  'оценка защищённых характеристик: возраст, пол, национальность, убеждения',
  'утверждение о гарантированном будущем результате',
];

export const SYNTHETIC_REPORTING_POLICIES: readonly SyntheticReportingPolicy[] = [
  {
    code: 'policy_development_investment',
    semanticVersion: '1.0.0',
    permittedClaims: [
      'описание того, что сообщил сотрудник о своей работе',
      'сопоставление заявленных предпочтений с описанной задачей обучения',
      'указание на отсутствующие сведения',
      'предложение уточняющего действия для руководителя',
    ],
    requiredLimitations: [
      'Окупаемость обучения платформой не рассчитывается.',
      'Связь между результатами синтетических методик и эффектом обучения не проверена.',
    ],
    forbiddenClaims: [...COMMON_FORBIDDEN, 'расчёт возврата инвестиций в обучение'],
  },
  {
    code: 'policy_role_readiness',
    semanticVersion: '1.0.0',
    permittedClaims: [
      'сопоставление описанных требований роли с имеющимися сведениями',
      'перечисление подтверждённых сведений и пробелов',
      'предложение способа проверить недостающее',
    ],
    requiredLimitations: [
      'Заключение не гарантирует успех в новой роли.',
      'Профессиональные знания синтетическими методиками не проверялись.',
    ],
    forbiddenClaims: [...COMMON_FORBIDDEN, 'прогноз успешности в должности'],
  },
  {
    code: 'policy_retention_conditions',
    semanticVersion: '1.0.0',
    permittedClaims: [
      'описание условий работы со слов сотрудника',
      'указание тем, которые стоит обсудить',
      'указание на расхождение между мнением руководителя и ответом сотрудника',
    ],
    requiredLimitations: [
      'Вероятность ухода сотрудника платформой не оценивается.',
      'Ответы отражают ситуацию на дату прохождения и могут измениться.',
    ],
    forbiddenClaims: [...COMMON_FORBIDDEN, 'прогноз увольнения или вероятность ухода'],
  },
];
