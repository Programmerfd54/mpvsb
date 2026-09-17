/**
 * Общий помощник для конечных автоматов предметной области.
 * Переходы объявляются таблицей; неизвестный переход всегда запрещён (deny by default).
 */

export type TransitionTable<TState extends string> = Readonly<Record<TState, readonly TState[]>>;

export class StateMachine<TState extends string> {
  constructor(
    readonly name: string,
    private readonly table: TransitionTable<TState>,
  ) {}

  /** Список состояний, в которые допустим переход из `from`. */
  next(from: TState): readonly TState[] {
    return this.table[from] ?? [];
  }

  can(from: TState, to: TState): boolean {
    return this.next(from).includes(to);
  }

  /** Терминальное состояние — то, из которого не определён ни один переход. */
  isTerminal(state: TState): boolean {
    return this.next(state).length === 0;
  }

  /**
   * Бросает ошибку с машиночитаемым кодом, если переход не разрешён.
   * Вызывается на сервере до записи в БД.
   */
  assert(from: TState, to: TState): void {
    if (!this.can(from, to)) {
      throw new IllegalTransitionError(this.name, from, to, this.next(from));
    }
  }
}

export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_STATE_TRANSITION';

  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
    readonly allowed: readonly string[],
  ) {
    super(
      `Переход ${machine}: ${from} → ${to} не разрешён. Допустимо: ${allowed.join(', ') || '—'}`,
    );
    this.name = 'IllegalTransitionError';
  }
}
