import type { MethodItem, MethodPassport, ScoringConfig } from '@context/contracts';

/**
 * СИНТЕТИЧЕСКИЕ методики для демонстрации и тестов.
 *
 * Это НЕ психодиагностические инструменты. Вопросы придуманы для проверки
 * технического конвейера: назначение → прохождение → подсчёт → заключение.
 * У них нет норм, нет проверенной связи с рабочими результатами и нет права
 * называться измерением чего-либо о человеке.
 *
 * Реальные методики появятся только после получения материалов, ключей и прав
 * (см. docs/knowledge/OPEN_QUESTIONS.md, Q-01…Q-04).
 */

export interface SyntheticMethod {
  readonly code: string;
  readonly semanticVersion: string;
  readonly passport: MethodPassport;
  readonly items: readonly MethodItem[];
  readonly scoring: ScoringConfig;
  readonly fixtures: readonly SyntheticFixture[];
}

/** Контрольный пример: синтетические ответы и ожидаемые значения шкал. */
export interface SyntheticFixture {
  readonly name: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly expected: Readonly<Record<string, number | null>>;
}

const SYNTHETIC_DISCLAIMER =
  'Демонстрационный материал. Методика синтетическая: у неё нет норм, проверенной связи с рабочими результатами и права называться измерением.';

const AGREEMENT_LABELS = [
  { value: 1, label: 'Совсем не согласен' },
  { value: 2, label: 'Скорее не согласен' },
  { value: 3, label: 'Затрудняюсь ответить' },
  { value: 4, label: 'Скорее согласен' },
  { value: 5, label: 'Полностью согласен' },
];

function likert(id: string, prompt: string): MethodItem {
  return { id, type: 'likert', prompt, required: true, min: 1, max: 5, labels: AGREEMENT_LABELS };
}

// ——— Методика 1: рабочий контекст ———

export const syntheticWorkContext: SyntheticMethod = {
  code: 'synthetic_work_context',
  semanticVersion: '1.0.0',
  passport: {
    title: 'Синтетическая анкета рабочего контекста',
    purpose:
      'Собрать самоотчёт о том, как сотрудник описывает самостоятельность, ясность задач и доступную поддержку. Используется только для демонстрации работы платформы.',
    targetPopulation: 'Синтетические участники демонстрационных организаций.',
    language: 'ru',
    limitations: [
      SYNTHETIC_DISCLAIMER,
      'Результат отражает то, что сообщил участник, а не проверенный факт о его работе.',
      'Значения шкал нельзя сравнивать между людьми и использовать для кадрового решения.',
    ],
    sourceStatement: 'Вопросы написаны командой разработки специально для демонстрации.',
    rightsStatement: 'Синтетическое содержимое проекта. Сторонние материалы не использованы.',
    estimatedMinutes: null,
    participantIntro:
      'Несколько утверждений о вашей текущей работе. Правильных ответов нет: отвечайте так, как описали бы свою ситуацию сами. Ответы увидит руководитель в составе общего заключения.',
  },
  items: [
    likert('item_wc_1', 'Я сам решаю, в каком порядке выполнять свои задачи.'),
    likert('item_wc_2', 'У меня есть возможность выбирать способ решения рабочей задачи.'),
    likert('item_wc_3', 'Большинство моих шагов заранее определены инструкцией.'),
    likert('item_wc_4', 'Мне понятно, какой результат от меня ожидают в этом месяце.'),
    likert('item_wc_5', 'Я понимаю, по каким признакам оценивают мою работу.'),
    likert('item_wc_6', 'Я знаю, к кому обратиться, если задача выходит за рамки моей зоны.'),
    {
      id: 'item_wc_7',
      type: 'single_choice',
      prompt: 'Как часто вы обсуждаете рабочие приоритеты с руководителем?',
      required: true,
      options: [
        { id: 'opt_wc7_never', label: 'Практически не обсуждаем' },
        { id: 'opt_wc7_rare', label: 'Несколько раз в год' },
        { id: 'opt_wc7_monthly', label: 'Примерно раз в месяц' },
        { id: 'opt_wc7_weekly', label: 'Раз в неделю или чаще' },
      ],
    },
    {
      id: 'item_wc_8',
      type: 'short_text',
      prompt: 'Опишите одну задачу последнего месяца, которой вы занимались дольше всего.',
      hint: 'Достаточно двух-трёх предложений. Не указывайте персональные данные других людей.',
      required: false,
      maxLength: 1000,
    },
  ],
  scoring: {
    missingPolicy: 'mark_unknown',
    optionScores: {
      item_wc_7: {
        opt_wc7_never: 1,
        opt_wc7_rare: 2,
        opt_wc7_monthly: 3,
        opt_wc7_weekly: 4,
      },
    },
    scales: [
      {
        id: 'scale_autonomy',
        title: 'Самостоятельность в описании участника',
        description:
          'Насколько высоко участник сам оценивает свободу в выборе порядка и способа работы. Это самоотчёт, а не наблюдение.',
        items: ['item_wc_1', 'item_wc_2', 'item_wc_3'],
        reverseItems: ['item_wc_3'],
        aggregate: 'mean',
        expectedRange: { min: 1, max: 5 },
      },
      {
        id: 'scale_clarity',
        title: 'Ясность ожиданий в описании участника',
        description:
          'Насколько участник считает понятными ожидаемый результат, критерии оценки и зоны ответственности.',
        items: ['item_wc_4', 'item_wc_5', 'item_wc_6'],
        reverseItems: [],
        aggregate: 'mean',
        expectedRange: { min: 1, max: 5 },
      },
      {
        id: 'scale_dialogue',
        title: 'Заявленная частота обсуждения приоритетов',
        description: 'Как часто, по словам участника, обсуждаются рабочие приоритеты.',
        items: ['item_wc_7'],
        reverseItems: [],
        aggregate: 'sum',
        expectedRange: { min: 1, max: 4 },
      },
    ],
  },
  fixtures: [
    {
      name: 'Минимальные значения шкал',
      answers: {
        item_wc_1: { type: 'likert', value: 1 },
        item_wc_2: { type: 'likert', value: 1 },
        item_wc_3: { type: 'likert', value: 5 },
        item_wc_4: { type: 'likert', value: 1 },
        item_wc_5: { type: 'likert', value: 1 },
        item_wc_6: { type: 'likert', value: 1 },
        item_wc_7: { type: 'single_choice', optionId: 'opt_wc7_never' },
      },
      expected: { scale_autonomy: 1, scale_clarity: 1, scale_dialogue: 1 },
    },
    {
      name: 'Максимальные значения шкал',
      answers: {
        item_wc_1: { type: 'likert', value: 5 },
        item_wc_2: { type: 'likert', value: 5 },
        item_wc_3: { type: 'likert', value: 1 },
        item_wc_4: { type: 'likert', value: 5 },
        item_wc_5: { type: 'likert', value: 5 },
        item_wc_6: { type: 'likert', value: 5 },
        item_wc_7: { type: 'single_choice', optionId: 'opt_wc7_weekly' },
      },
      expected: { scale_autonomy: 5, scale_clarity: 5, scale_dialogue: 4 },
    },
    {
      name: 'Пропущенный ответ оставляет шкалу неопределённой',
      answers: {
        item_wc_1: { type: 'likert', value: 4 },
        item_wc_2: { type: 'likert', value: 4 },
        item_wc_4: { type: 'likert', value: 3 },
        item_wc_5: { type: 'likert', value: 3 },
        item_wc_6: { type: 'likert', value: 3 },
        item_wc_7: { type: 'single_choice', optionId: 'opt_wc7_monthly' },
      },
      expected: { scale_autonomy: null, scale_clarity: 3, scale_dialogue: 3 },
    },
  ],
};

// ——— Методика 2: предпочтения в задачах ———

export const syntheticTaskPreferences: SyntheticMethod = {
  code: 'synthetic_task_preferences',
  semanticVersion: '1.0.0',
  passport: {
    title: 'Синтетическая анкета предпочтений в задачах',
    purpose:
      'Собрать самоотчёт о предпочитаемой структурированности задач и отношении к новым для участника направлениям. Демонстрационное содержимое.',
    targetPopulation: 'Синтетические участники демонстрационных организаций.',
    language: 'ru',
    limitations: [
      SYNTHETIC_DISCLAIMER,
      'Предпочтение не является способностью: высокий балл не означает, что участник справится с задачей.',
      'Результат не предсказывает успех обучения и не обосновывает вложение в конкретный курс.',
    ],
    sourceStatement: 'Вопросы написаны командой разработки специально для демонстрации.',
    rightsStatement: 'Синтетическое содержимое проекта. Сторонние материалы не использованы.',
    estimatedMinutes: null,
    participantIntro:
      'Вопросы о том, какие задачи вам обычно ближе. Здесь нет удачных и неудачных ответов — описание предпочтений помогает точнее обсудить условия работы.',
  },
  items: [
    likert('item_tp_1', 'Мне комфортнее, когда у задачи есть подробное описание результата.'),
    likert('item_tp_2', 'Я предпочитаю заранее согласованный план работ.'),
    likert('item_tp_3', 'Мне интересно браться за задачу, когда способ решения ещё не определён.'),
    likert('item_tp_4', 'Я охотно осваиваю инструменты, которых раньше не использовал.'),
    likert('item_tp_5', 'Смена направления работы для меня скорее возможность, чем риск.'),
    {
      id: 'item_tp_6',
      type: 'multiple_choice',
      prompt: 'Какие форматы обучения вам подходят? Можно выбрать несколько.',
      required: true,
      minSelected: 1,
      maxSelected: 4,
      options: [
        { id: 'opt_tp6_mentor', label: 'Разбор задач с более опытным коллегой' },
        { id: 'opt_tp6_course', label: 'Структурированный курс с расписанием' },
        { id: 'opt_tp6_practice', label: 'Самостоятельная практика на реальной задаче' },
        { id: 'opt_tp6_reading', label: 'Чтение документации и материалов' },
      ],
    },
  ],
  scoring: {
    missingPolicy: 'mark_unknown',
    optionScores: {
      item_tp_6: {
        opt_tp6_mentor: 1,
        opt_tp6_course: 1,
        opt_tp6_practice: 1,
        opt_tp6_reading: 1,
      },
    },
    scales: [
      {
        id: 'scale_structure_preference',
        title: 'Предпочтение заранее определённых задач',
        description:
          'Насколько участник предпочитает подробно описанные задачи и согласованный план. Это предпочтение, а не оценка качества работы.',
        items: ['item_tp_1', 'item_tp_2', 'item_tp_3'],
        reverseItems: ['item_tp_3'],
        aggregate: 'mean',
        expectedRange: { min: 1, max: 5 },
      },
      {
        id: 'scale_novelty_openness',
        title: 'Заявленная готовность к новому',
        description:
          'Как участник описывает своё отношение к незнакомым инструментам и смене направления.',
        items: ['item_tp_4', 'item_tp_5'],
        reverseItems: [],
        aggregate: 'mean',
        expectedRange: { min: 1, max: 5 },
      },
      {
        id: 'scale_learning_channels',
        title: 'Число подходящих форматов обучения',
        description:
          'Сколько форматов обучения участник отметил как подходящие. Это перечисление, а не оценка обучаемости.',
        items: ['item_tp_6'],
        reverseItems: [],
        aggregate: 'sum',
        expectedRange: { min: 0, max: 4 },
      },
    ],
  },
  fixtures: [
    {
      name: 'Предпочтение структуры при одном формате обучения',
      answers: {
        item_tp_1: { type: 'likert', value: 5 },
        item_tp_2: { type: 'likert', value: 5 },
        item_tp_3: { type: 'likert', value: 1 },
        item_tp_4: { type: 'likert', value: 2 },
        item_tp_5: { type: 'likert', value: 2 },
        item_tp_6: { type: 'multiple_choice', optionIds: ['opt_tp6_course'] },
      },
      expected: {
        scale_structure_preference: 5,
        scale_novelty_openness: 2,
        scale_learning_channels: 1,
      },
    },
    {
      name: 'Несколько форматов обучения суммируются',
      answers: {
        item_tp_1: { type: 'likert', value: 2 },
        item_tp_2: { type: 'likert', value: 2 },
        item_tp_3: { type: 'likert', value: 4 },
        item_tp_4: { type: 'likert', value: 5 },
        item_tp_5: { type: 'likert', value: 4 },
        item_tp_6: {
          type: 'multiple_choice',
          optionIds: ['opt_tp6_mentor', 'opt_tp6_practice', 'opt_tp6_reading'],
        },
      },
      expected: {
        scale_structure_preference: 2,
        scale_novelty_openness: 4.5,
        scale_learning_channels: 3,
      },
    },
  ],
};

// ——— Методика 3: ситуационные выборы ———

export const syntheticSituationalChoices: SyntheticMethod = {
  code: 'synthetic_situational_choices',
  semanticVersion: '1.0.0',
  passport: {
    title: 'Синтетические ситуационные выборы',
    purpose:
      'Показать, какой порядок действий участник выбирает в описанных рабочих ситуациях. Демонстрационное содержимое без рубрики эксперта.',
    targetPopulation: 'Синтетические участники демонстрационных организаций.',
    language: 'ru',
    limitations: [
      SYNTHETIC_DISCLAIMER,
      'Выбор в описанной ситуации не равен поведению в реальной работе.',
      'Баллы вариантов условны: «правильного» ответа здесь не установлено методологом.',
    ],
    sourceStatement: 'Ситуации написаны командой разработки специально для демонстрации.',
    rightsStatement: 'Синтетическое содержимое проекта. Сторонние материалы не использованы.',
    estimatedMinutes: null,
    participantIntro:
      'Несколько коротких рабочих ситуаций. Выберите тот порядок действий, который ближе к вашему обычному, а не тот, который кажется «правильным».',
  },
  items: [
    {
      id: 'item_sc_1',
      type: 'situational',
      prompt: 'Что вы сделаете в первую очередь?',
      required: true,
      situation:
        'Вы ведёте задачу со сроком в пятницу. В среду выясняется, что нужных данных от соседнего отдела не будет раньше четверга вечером.',
      response: {
        kind: 'single_choice',
        options: [
          { id: 'opt_sc1_wait', label: 'Дождусь данных и начну в четверг вечером' },
          { id: 'opt_sc1_partial', label: 'Сделаю всё, что не зависит от этих данных' },
          { id: 'opt_sc1_notify', label: 'Сразу сообщу о риске срока и предложу варианты' },
          { id: 'opt_sc1_escalate', label: 'Попрошу руководителя ускорить соседний отдел' },
        ],
      },
    },
    {
      id: 'item_sc_2',
      type: 'situational',
      prompt: 'Какой вариант ближе к вашим действиям?',
      required: true,
      situation: 'Коллега просит помочь с его задачей в день, когда у вас самого плотный график.',
      response: {
        kind: 'single_choice',
        options: [
          { id: 'opt_sc2_refuse', label: 'Откажу: мои задачи в приоритете' },
          { id: 'opt_sc2_later', label: 'Предложу конкретное время позже' },
          { id: 'opt_sc2_switch', label: 'Отложу своё и помогу сейчас' },
          { id: 'opt_sc2_clarify', label: 'Уточню срочность и сверю приоритеты с руководителем' },
        ],
      },
    },
    {
      id: 'item_sc_3',
      type: 'situational',
      prompt: 'Что вы выберете?',
      required: true,
      situation:
        'Вы заметили, что принятый в команде способ работы приводит к повторяющейся ошибке.',
      response: {
        kind: 'single_choice',
        options: [
          { id: 'opt_sc3_silent', label: 'Исправлю у себя и не буду поднимать тему' },
          { id: 'opt_sc3_ask', label: 'Спрошу у коллег, сталкивались ли они с тем же' },
          { id: 'opt_sc3_propose', label: 'Опишу проблему и предложу изменение' },
          { id: 'opt_sc3_wait', label: 'Подожду: возможно, это разовый случай' },
        ],
      },
    },
    {
      id: 'item_sc_4',
      type: 'situational',
      prompt: 'Опишите своими словами, чего вам не хватило для решения.',
      required: false,
      situation: 'Вспомните последнюю рабочую ситуацию, где решение далось вам тяжелее обычного.',
      response: { kind: 'short_text', maxLength: 1000 },
    },
  ],
  scoring: {
    missingPolicy: 'mark_unknown',
    optionScores: {
      item_sc_1: { opt_sc1_wait: 0, opt_sc1_partial: 2, opt_sc1_notify: 3, opt_sc1_escalate: 1 },
      item_sc_2: { opt_sc2_refuse: 0, opt_sc2_later: 2, opt_sc2_switch: 1, opt_sc2_clarify: 3 },
      item_sc_3: { opt_sc3_silent: 0, opt_sc3_ask: 2, opt_sc3_propose: 3, opt_sc3_wait: 1 },
    },
    scales: [
      {
        id: 'scale_coordination_choice',
        title: 'Выбор в пользу согласования',
        description:
          'Насколько часто участник выбирал варианты, связанные с предупреждением и согласованием. Баллы условны и заданы для демонстрации.',
        items: ['item_sc_1', 'item_sc_2', 'item_sc_3'],
        reverseItems: [],
        aggregate: 'sum',
        expectedRange: { min: 0, max: 9 },
      },
    ],
  },
  fixtures: [
    {
      name: 'Все варианты с минимальным баллом',
      answers: {
        item_sc_1: { type: 'situational', optionId: 'opt_sc1_wait' },
        item_sc_2: { type: 'situational', optionId: 'opt_sc2_refuse' },
        item_sc_3: { type: 'situational', optionId: 'opt_sc3_silent' },
      },
      expected: { scale_coordination_choice: 0 },
    },
    {
      name: 'Все варианты с максимальным баллом',
      answers: {
        item_sc_1: { type: 'situational', optionId: 'opt_sc1_notify' },
        item_sc_2: { type: 'situational', optionId: 'opt_sc2_clarify' },
        item_sc_3: { type: 'situational', optionId: 'opt_sc3_propose' },
      },
      expected: { scale_coordination_choice: 9 },
    },
  ],
};

export const SYNTHETIC_METHODS: readonly SyntheticMethod[] = [
  syntheticWorkContext,
  syntheticTaskPreferences,
  syntheticSituationalChoices,
];
