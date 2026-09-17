/** Ошибка конфигурации методики: содержимое версии нельзя подсчитать. */
export class ScoringConfigError extends Error {
  readonly code = 'SCORING_CONFIG_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'ScoringConfigError';
  }
}

/** Ошибка данных попытки: ответы не соответствуют закреплённой версии. */
export class ScoringInputError extends Error {
  readonly code = 'SCORING_INPUT_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'ScoringInputError';
  }
}
