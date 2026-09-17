import type { ContextSchema } from './scenarios';

/**
 * Структурная проверка версии сценария.
 *
 * Чистая функция: её используют и сервер перед записью, и редактор, чтобы
 * показать проблему до сохранения.
 */

export interface ScenarioIssue {
  readonly code:
    | 'duplicate_field_key'
    | 'invalid_field_key'
    | 'empty_field_label'
    | 'select_without_options'
    | 'duplicate_option_value'
    | 'no_decision_question'
    | 'no_fact_field'
    | 'no_methods'
    | 'duplicate_method'
    | 'unpublished_method'
    | 'method_mode_below_scenario'
    | 'no_required_method'
    | 'no_reporting_policy'
    | 'policy_without_limitations';
  readonly severity: 'blocker' | 'warning';
  readonly message: string;
  readonly target: string;
}

/** Методика, привязанная к версии сценария. */
export interface ScenarioMethodBinding {
  readonly methodId: string;
  readonly methodVersionId: string;
  readonly title: string;
  readonly semanticVersion: string;
  readonly status: string;
  readonly applicabilityMode: 'demo' | 'research' | 'validated_use';
  readonly orderIndex: number;
  readonly required: boolean;
}

const FIELD_KEY_RE = /^[a-z][a-zA-Z0-9]{1,48}$/;

const MODE_RANK: Readonly<Record<string, number>> = {
  demo: 0,
  research: 1,
  validated_use: 2,
};

export function validateScenarioStructure(input: {
  readonly contextSchema: ContextSchema;
  readonly methods: readonly ScenarioMethodBinding[];
  readonly applicabilityMode: 'demo' | 'research' | 'validated_use';
  readonly hasReportingPolicy: boolean;
  readonly requiredLimitationCount: number;
}): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];

  // ——— Схема контекста ———
  const seenKeys = new Set<string>();

  for (const field of input.contextSchema.fields) {
    if (seenKeys.has(field.key)) {
      issues.push({
        code: 'duplicate_field_key',
        severity: 'blocker',
        message: `Ключ поля ${field.key} повторяется: значения перезаписали бы друг друга.`,
        target: field.key,
      });
    }
    seenKeys.add(field.key);

    if (!FIELD_KEY_RE.test(field.key)) {
      issues.push({
        code: 'invalid_field_key',
        severity: 'blocker',
        message: `Ключ ${field.key} недопустим: латиница, начинается с буквы, без пробелов.`,
        target: field.key,
      });
    }

    if (field.label.trim().length === 0) {
      issues.push({
        code: 'empty_field_label',
        severity: 'blocker',
        message: `У поля ${field.key} не заполнено название — руководитель не поймёт, что вводить.`,
        target: field.key,
      });
    }

    if (field.type === 'select') {
      const options = field.options ?? [];
      if (options.length === 0) {
        issues.push({
          code: 'select_without_options',
          severity: 'blocker',
          message: `У поля выбора ${field.key} нет вариантов.`,
          target: field.key,
        });
      }

      const seenValues = new Set<string>();
      for (const option of options) {
        if (seenValues.has(option.value)) {
          issues.push({
            code: 'duplicate_option_value',
            severity: 'blocker',
            message: `В поле ${field.key} повторяется значение варианта ${option.value}.`,
            target: field.key,
          });
        }
        seenValues.add(option.value);
      }
    }
  }

  // Без формулировки вопроса заключение не к чему привязать.
  if (!seenKeys.has('decisionQuestion')) {
    issues.push({
      code: 'no_decision_question',
      severity: 'blocker',
      message:
        'Нет поля decisionQuestion: без формулировки вопроса руководителя заключению не к чему относиться.',
      target: 'contextSchema',
    });
  }

  // Без поля наблюдаемых фактов заключение сможет опираться только на самоотчёт.
  if (!input.contextSchema.fields.some((field) => field.evidenceRole === 'fact')) {
    issues.push({
      code: 'no_fact_field',
      severity: 'warning',
      message:
        'Ни одно поле не отмечено как наблюдаемый рабочий факт. Заключение будет опираться только на ответы сотрудника и мнение руководителя.',
      target: 'contextSchema',
    });
  }

  // ——— Методики ———
  if (input.methods.length === 0) {
    issues.push({
      code: 'no_methods',
      severity: 'blocker',
      message: 'В сценарии нет ни одной методики.',
      target: 'methods',
    });
  }

  // Две версии одной методики в одном сценарии несовместимы: участник прошёл бы
  // один и тот же инструмент дважды, а результаты нельзя было бы сопоставить.
  const byMethod = new Map<string, ScenarioMethodBinding[]>();
  for (const method of input.methods) {
    const list = byMethod.get(method.methodId) ?? [];
    list.push(method);
    byMethod.set(method.methodId, list);
  }

  for (const [, list] of byMethod) {
    if (list.length > 1) {
      issues.push({
        code: 'duplicate_method',
        severity: 'blocker',
        message: `Методика «${list[0]!.title}» добавлена дважды (версии ${list
          .map((item) => item.semanticVersion)
          .join(', ')}). В одном сценарии допустима одна версия.`,
        target: list[0]!.methodVersionId,
      });
    }
  }

  for (const method of input.methods) {
    if (method.status !== 'published') {
      issues.push({
        code: 'unpublished_method',
        severity: 'blocker',
        message: `Методика «${method.title}» версии ${method.semanticVersion} не опубликована.`,
        target: method.methodVersionId,
      });
    }

    if ((MODE_RANK[method.applicabilityMode] ?? 0) < (MODE_RANK[input.applicabilityMode] ?? 0)) {
      issues.push({
        code: 'method_mode_below_scenario',
        severity: 'blocker',
        message: `Методика «${method.title}» уровня «${method.applicabilityMode}» ниже уровня сценария «${input.applicabilityMode}».`,
        target: method.methodVersionId,
      });
    }
  }

  if (input.methods.length > 0 && !input.methods.some((method) => method.required)) {
    issues.push({
      code: 'no_required_method',
      severity: 'warning',
      message:
        'Ни одна методика не отмечена обязательной: назначение будет считаться завершённым без единого пройденного теста.',
      target: 'methods',
    });
  }

  // ——— Правила заключения ———
  if (!input.hasReportingPolicy) {
    issues.push({
      code: 'no_reporting_policy',
      severity: 'blocker',
      message:
        'Не выбрана политика заключения: без неё нечем проверить обязательные ограничения и запрещённые утверждения.',
      target: 'reportingPolicy',
    });
  } else if (input.requiredLimitationCount === 0) {
    issues.push({
      code: 'policy_without_limitations',
      severity: 'blocker',
      message:
        'В политике заключения нет обязательных ограничений. Заключение без них публиковаться не должно.',
      target: 'reportingPolicy',
    });
  }

  return issues;
}

export function hasScenarioBlockers(issues: readonly ScenarioIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'blocker');
}
