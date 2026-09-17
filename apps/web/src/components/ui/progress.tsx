'use client';

import { Check, X } from 'lucide-react';

import { cx } from './tint';

/**
 * Индикатор выполнения.
 *
 * Показывает реальные `completed` из `total`. Если время неизвестно, состояние
 * описывается словами, а не выдуманным процентом (ТЗ 02.6).
 */
export function StepProgress({
  completed,
  total,
  label,
}: {
  completed: number;
  total: number;
  label: string;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm tabular-nums text-[var(--text-secondary)]">
          {completed} из {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={`${label}: ${completed} из ${total}`}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--bg-muted)]"
      >
        <div
          className="h-full rounded-[var(--radius-pill)] bg-[linear-gradient(90deg,#3f6b58,#35594a)] transition-[width] duration-[400ms] ease-[var(--easing-out)]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** Прежнее имя в брифе. */
export const Progress = StepProgress;

/**
 * Шаги мастера: горизонтально на desktop, компактно «Шаг 2 из 4» на mobile.
 * `current` — индекс с нуля. Клик по шагу доступен только для пройденных шагов.
 */
export function Stepper({
  steps,
  current,
  onStepClick,
  label = 'Шаги',
}: {
  steps: ReadonlyArray<{ label: string; description?: string }>;
  current: number;
  onStepClick?: (index: number) => void;
  label?: string;
}) {
  const active = steps[current];

  return (
    <nav aria-label={label}>
      {/* Mobile */}
      <div className="flex flex-col gap-2 md:hidden">
        <p className="text-sm text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">
            Шаг {Math.min(current + 1, steps.length)} из {steps.length}
          </span>
          {active ? ` · ${active.label}` : null}
        </p>
        <div aria-hidden="true" className="flex gap-1.5">
          {steps.map((step, index) => (
            <span
              key={step.label}
              className={cx(
                'h-1.5 flex-1 rounded-full transition-colors duration-[var(--motion-medium)]',
                index <= current ? 'bg-[var(--accent)]' : 'bg-[var(--bg-muted)]',
              )}
            />
          ))}
        </div>
      </div>

      {/* Desktop */}
      <ol className="m-0 hidden list-none items-start gap-2 p-0 md:flex">
        {steps.map((step, index) => {
          const done = index < current;
          const isCurrent = index === current;
          const clickable = Boolean(onStepClick) && done;
          const inner = (
            <>
              <span
                aria-hidden="true"
                className={cx(
                  'grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums transition-colors duration-[var(--motion-medium)]',
                  done && 'bg-[var(--accent)] text-white',
                  isCurrent &&
                    'bg-[var(--bg-surface)] text-[var(--accent)] shadow-[inset_0_0_0_2px_var(--accent)]',
                  !done &&
                    !isCurrent &&
                    'bg-[var(--bg-surface)] text-[var(--text-secondary)] shadow-[inset_0_0_0_1.5px_var(--border-subtle)]',
                )}
              >
                {done ? <Check className="size-4" strokeWidth={2.5} /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-col text-left">
                <span
                  className={cx(
                    'text-sm leading-tight',
                    isCurrent ? 'font-semibold text-[var(--text-primary)]' : 'font-medium',
                    !isCurrent && 'text-[var(--text-secondary)]',
                  )}
                >
                  {step.label}
                  <span className="sr-only">
                    {done ? ' — пройден' : isCurrent ? ' — текущий шаг' : ''}
                  </span>
                </span>
                {step.description ? (
                  <span className="mt-0.5 text-xs leading-snug text-[var(--text-secondary)]">
                    {step.description}
                  </span>
                ) : null}
              </span>
            </>
          );

          return (
            <li
              key={step.label}
              aria-current={isCurrent ? 'step' : undefined}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick?.(index)}
                  className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] py-1 pr-2 transition-colors hover:bg-[rgba(36,40,33,0.04)]"
                >
                  {inner}
                </button>
              ) : (
                <span className="flex min-h-11 min-w-0 items-center gap-2.5 py-1 pr-2">
                  {inner}
                </span>
              )}
              {index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cx(
                    'h-0.5 min-w-4 flex-1 rounded-full',
                    done ? 'bg-[var(--accent)]' : 'bg-[var(--border-subtle)]',
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export type ProcessStageState = 'done' | 'current' | 'upcoming' | 'failed';

/**
 * Путь процесса по реальным статусам сервера:
 * «Ответы получены → Обрабатываем → Проверяем → Готово». «Мышление AI» не изображается.
 */
export function ProcessTrack({
  stages,
  label = 'Стадия подготовки заключения',
}: {
  stages: ReadonlyArray<{ label: string; state: ProcessStageState }>;
  label?: string;
}) {
  return (
    <ol
      aria-label={label}
      className="m-0 flex list-none flex-col gap-0 p-0 sm:flex-row sm:items-center sm:gap-2"
    >
      {stages.map((stage, index) => {
        const stateText =
          stage.state === 'done'
            ? 'завершено'
            : stage.state === 'current'
              ? 'сейчас'
              : stage.state === 'failed'
                ? 'ошибка'
                : 'впереди';
        return (
          <li
            key={stage.label}
            aria-current={stage.state === 'current' ? 'step' : undefined}
            className="flex items-center gap-2 sm:min-w-0 sm:flex-1"
          >
            <span className="flex min-h-9 items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cx(
                  'relative grid size-6 shrink-0 place-items-center rounded-full',
                  stage.state === 'done' && 'bg-[var(--accent)] text-white',
                  stage.state === 'current' &&
                    'bg-[var(--accent-soft)] text-[var(--accent)] shadow-[inset_0_0_0_1.5px_var(--accent)]',
                  stage.state === 'upcoming' &&
                    'bg-[var(--bg-surface)] shadow-[inset_0_0_0_1.5px_var(--border-subtle)]',
                  stage.state === 'failed' && 'bg-[var(--danger-soft)] text-[var(--danger-text)]',
                )}
              >
                {stage.state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : null}
                {stage.state === 'failed' ? <X className="size-3.5" strokeWidth={3} /> : null}
                {stage.state === 'current' ? (
                  <span className="size-2 rounded-full bg-[var(--accent)]" />
                ) : null}
              </span>
              <span
                className={cx(
                  'whitespace-nowrap text-sm',
                  stage.state === 'current' && 'font-semibold text-[var(--text-primary)]',
                  stage.state === 'done' && 'font-medium text-[var(--text-primary)]',
                  stage.state === 'upcoming' && 'text-[var(--text-secondary)]',
                  stage.state === 'failed' && 'font-semibold text-[var(--danger-text)]',
                )}
              >
                {stage.label}
                <span className="sr-only"> — {stateText}</span>
              </span>
            </span>
            {index < stages.length - 1 ? (
              <span
                aria-hidden="true"
                className={cx(
                  'hidden h-0.5 min-w-3 flex-1 rounded-full sm:block',
                  stage.state === 'done' ? 'bg-[var(--accent)]' : 'bg-[var(--border-subtle)]',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Стадии фоновой подготовки. Показываются только по реальным статусам сервера:
 * «мышление AI» не изображается.
 */
export function StageIndicator({
  stage,
}: {
  stage: 'received' | 'processing' | 'review' | 'ready';
}) {
  const stages = [
    { key: 'received', label: 'Ответы получены' },
    { key: 'processing', label: 'Обрабатываем' },
    { key: 'review', label: 'Проверяем' },
    { key: 'ready', label: 'Готово' },
  ] as const;

  const activeIndex = stages.findIndex((item) => item.key === stage);

  return (
    <ProcessTrack
      stages={stages.map((item, index) => ({
        label: item.label,
        state:
          index < activeIndex || (stage === 'ready' && index === activeIndex)
            ? 'done'
            : index === activeIndex
              ? 'current'
              : 'upcoming',
      }))}
    />
  );
}
