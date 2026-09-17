import type { MethodItem, ScoringConfig } from './methods';

/**
 * Структурная проверка содержимого методики.
 *
 * Функция чистая и не выполняет подсчёт: её используют и сервер перед записью,
 * и редактор, чтобы показать проблему до сохранения. Прогон контрольных
 * примеров — отдельный шаг, он живёт на сервере вместе с движком подсчёта.
 */

export interface MethodIssue {
  readonly code:
    | 'duplicate_item_id'
    | 'duplicate_option_id'
    | 'empty_prompt'
    | 'empty_option_label'
    | 'empty_situation'
    | 'empty_options'
    | 'scale_unknown_item'
    | 'scale_not_scorable_item'
    | 'reverse_item_not_in_scale'
    | 'missing_option_scores'
    | 'unknown_option_score'
    | 'invalid_range'
    | 'weight_without_operator'
    | 'orphan_item';
  readonly severity: 'blocker' | 'warning';
  readonly message: string;
  /** Что именно исправлять: идентификатор вопроса или шкалы. */
  readonly target: string;
}

/** Типы вопросов, которые в принципе могут давать число для шкалы. */
const SCORABLE_TYPES = new Set(['likert', 'numeric', 'single_choice', 'multiple_choice']);

/** Типы, для которых баллы вариантов обязательны. */
const NEEDS_OPTION_SCORES = new Set(['single_choice', 'multiple_choice', 'situational']);

export function validateMethodStructure(
  items: readonly MethodItem[],
  scoring: ScoringConfig,
): MethodIssue[] {
  const issues: MethodIssue[] = [];

  // ——— Идентификаторы ———
  const seenItems = new Set<string>();
  for (const item of items) {
    if (seenItems.has(item.id)) {
      issues.push({
        code: 'duplicate_item_id',
        severity: 'blocker',
        message: `Идентификатор вопроса ${item.id} повторяется. Сохранённые ответы нельзя было бы сопоставить с вопросом.`,
        target: item.id,
      });
    }
    seenItems.add(item.id);

    // Вопрос без текста сохранить нельзя: серверная схема его отвергнет,
    // и лучше сказать об этом здесь, а не после нажатия «Сохранить».
    if (item.prompt.trim().length === 0) {
      issues.push({
        code: 'empty_prompt',
        severity: 'blocker',
        message: `У вопроса ${item.id} не заполнена формулировка.`,
        target: item.id,
      });
    }

    if (item.type === 'situational' && item.situation.trim().length === 0) {
      issues.push({
        code: 'empty_situation',
        severity: 'blocker',
        message: `У вопроса ${item.id} не заполнено описание ситуации.`,
        target: item.id,
      });
    }

    const options =
      item.type === 'single_choice' || item.type === 'multiple_choice'
        ? item.options
        : item.type === 'situational' && item.response.kind === 'single_choice'
          ? item.response.options
          : null;

    if (options) {
      if (options.length === 0) {
        issues.push({
          code: 'empty_options',
          severity: 'blocker',
          message: `У вопроса ${item.id} нет вариантов ответа.`,
          target: item.id,
        });
      }
      const seenOptions = new Set<string>();
      for (const option of options) {
        if (option.label.trim().length === 0) {
          issues.push({
            code: 'empty_option_label',
            severity: 'blocker',
            message: `В вопросе ${item.id} есть вариант без текста (${option.id}).`,
            target: item.id,
          });
        }
        if (seenOptions.has(option.id)) {
          issues.push({
            code: 'duplicate_option_id',
            severity: 'blocker',
            message: `В вопросе ${item.id} повторяется идентификатор варианта ${option.id}.`,
            target: item.id,
          });
        }
        seenOptions.add(option.id);
      }
    }
  }

  const itemsById = new Map(items.map((item) => [item.id, item]));
  const usedInScales = new Set<string>();

  // ——— Шкалы ———
  for (const scale of scoring.scales) {
    if (scale.expectedRange.min >= scale.expectedRange.max) {
      issues.push({
        code: 'invalid_range',
        severity: 'blocker',
        message: `Шкала ${scale.id}: нижняя граница диапазона должна быть меньше верхней.`,
        target: scale.id,
      });
    }

    for (const itemId of scale.items) {
      usedInScales.add(itemId);
      const item = itemsById.get(itemId);

      if (!item) {
        issues.push({
          code: 'scale_unknown_item',
          severity: 'blocker',
          message: `Шкала ${scale.id} ссылается на несуществующий вопрос ${itemId}.`,
          target: scale.id,
        });
        continue;
      }

      const scorable =
        SCORABLE_TYPES.has(item.type) ||
        (item.type === 'situational' && item.response.kind === 'single_choice');

      if (!scorable) {
        issues.push({
          code: 'scale_not_scorable_item',
          severity: 'blocker',
          message: `Вопрос ${itemId} со свободным ответом не может входить в шкалу ${scale.id}: без утверждённой рубрики балл ему не назначается.`,
          target: scale.id,
        });
        continue;
      }

      if (NEEDS_OPTION_SCORES.has(item.type)) {
        const scores = scoring.optionScores?.[itemId];
        if (!scores || Object.keys(scores).length === 0) {
          issues.push({
            code: 'missing_option_scores',
            severity: 'blocker',
            message: `Для вопроса ${itemId} не заданы баллы вариантов, а он входит в шкалу ${scale.id}.`,
            target: itemId,
          });
        } else {
          const optionIds = new Set(
            item.type === 'situational' && item.response.kind === 'single_choice'
              ? item.response.options.map((option) => option.id)
              : item.type === 'single_choice' || item.type === 'multiple_choice'
                ? item.options.map((option) => option.id)
                : [],
          );

          for (const optionId of Object.keys(scores)) {
            if (!optionIds.has(optionId)) {
              issues.push({
                code: 'unknown_option_score',
                severity: 'blocker',
                message: `Для вопроса ${itemId} задан балл варианта ${optionId}, которого нет среди вариантов.`,
                target: itemId,
              });
            }
          }

          for (const optionId of optionIds) {
            if (scores[optionId] === undefined) {
              issues.push({
                code: 'missing_option_scores',
                severity: 'blocker',
                message: `Для вопроса ${itemId} не задан балл варианта ${optionId}.`,
                target: itemId,
              });
            }
          }
        }
      }
    }

    for (const itemId of scale.reverseItems) {
      if (!scale.items.includes(itemId)) {
        issues.push({
          code: 'reverse_item_not_in_scale',
          severity: 'blocker',
          message: `Вопрос ${itemId} отмечен обратным, но не входит в шкалу ${scale.id}.`,
          target: scale.id,
        });
      }
    }

    if (scale.weights && scale.aggregate !== 'weighted_sum') {
      issues.push({
        code: 'weight_without_operator',
        severity: 'warning',
        message: `У шкалы ${scale.id} заданы веса, но выбран оператор «${scale.aggregate}»: веса не применятся.`,
        target: scale.id,
      });
    }
  }

  // ——— Вопросы вне шкал ———
  // Это не ошибка: свободный текст и ситуации попадают в заключение как
  // свидетельства. Но о таких вопросах стоит сказать явно.
  for (const item of items) {
    if (!usedInScales.has(item.id)) {
      issues.push({
        code: 'orphan_item',
        severity: 'warning',
        message: `Вопрос ${item.id} не входит ни в одну шкалу. Его ответ попадёт в заключение как свидетельство, но не будет подсчитан.`,
        target: item.id,
      });
    }
  }

  return issues;
}

export function hasBlockers(issues: readonly MethodIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'blocker');
}

/**
 * Следующий свободный идентификатор вопроса вида `item_<префикс>_<n>`.
 * Идентификаторы не переиспользуются после удаления: это защищает от ситуации,
 * когда старый ответ сопоставляется с новым вопросом.
 */
export function nextItemId(existing: readonly string[], prefix = 'q'): string {
  const used = new Set(existing);
  let index = existing.length + 1;
  let candidate = `item_${prefix}_${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `item_${prefix}_${index}`;
  }
  return candidate;
}

export function nextOptionId(existing: readonly string[], itemId: string): string {
  const base = itemId.replace(/^item_/, '');
  const used = new Set(existing);
  let index = existing.length + 1;
  let candidate = `opt_${base}_${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `opt_${base}_${index}`;
  }
  return candidate;
}
