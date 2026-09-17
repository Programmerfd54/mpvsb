/**
 * Поиск полей, которые не должны покидать backend.
 *
 * Проверка структурная: обходит JSON и собирает пути ключей, совпавших с
 * запрещёнными именами. Значения в отчёт не попадают — только пути.
 */

/** Ключи подсчёта и служебные поля методик (ТЗ 07.4). */
export const SCORING_KEY_PATTERN =
  /^(scoring|scoringConfig|scoring_config|scoringJson|scoring_json|optionScores|option_scores|reverseItems|reverse_items|weights|keys|answerKey|answerKeys|correct|correctOptionId|isCorrect|score|scores|expectedRange|norms)$/i;

/** Структуры сырых ответов участника. */
export const RAW_ANSWER_KEY_PATTERN =
  /^(answers|answer|answersSnapshot|answers_snapshot_json|response|responses|optionId|optionIds|rawAnswers|submissionSnapshot)$/i;

export function findKeys(value: unknown, pattern: RegExp, path = '$'): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => found.push(...findKeys(item, pattern, `${path}[${index}]`)));
    return found;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = `${path}.${key}`;
      if (pattern.test(key)) {
        found.push(nestedPath);
      }
      found.push(...findKeys(nested, pattern, nestedPath));
    }
  }
  return found;
}

export function containsText(value: unknown, fragment: string): boolean {
  return JSON.stringify(value ?? null).includes(fragment);
}
