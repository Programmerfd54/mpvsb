'use client';

import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { Tabs as RadixTabs } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import { cx } from './tint';

export interface TabItem {
  readonly value: string;
  readonly label: string;
  readonly count?: number;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
}

/**
 * Вкладки (Radix Tabs): roving focus, стрелки, Home/End.
 * Вид — сегментированная «пилюля» со скользящим белым индикатором.
 * Панели передаются детьми через TabPanel.
 */
export function Tabs({
  value,
  onValueChange,
  items,
  label,
  children,
  className,
  listClassName,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: readonly TabItem[];
  /** Доступное имя списка вкладок. */
  label: string;
  children?: ReactNode;
  className?: string;
  listClassName?: string;
}) {
  const groupId = useId();
  const reduce = useReducedMotion();

  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <RadixTabs.List
          aria-label={label}
          className={cx(
            'inline-flex min-w-max items-center gap-1 rounded-[14px] bg-[rgba(36,40,33,0.055)] p-1',
            listClassName,
          )}
        >
          <LayoutGroup id={groupId}>
            {items.map((item) => {
              const active = item.value === value;
              return (
                <RadixTabs.Trigger
                  key={item.value}
                  value={item.value}
                  disabled={item.disabled}
                  className={cx(
                    'relative inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 text-sm font-semibold',
                    'transition-colors duration-[var(--motion-fast)] ease-[var(--easing)] disabled:pointer-events-none disabled:opacity-50',
                    'focus-visible:outline-offset-0 [&_svg]:size-4',
                    active
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="tab-indicator"
                      aria-hidden="true"
                      className="absolute inset-0 rounded-[10px] bg-[var(--bg-surface)] shadow-[0_1px_2px_rgba(48,55,42,0.08),0_2px_8px_rgba(48,55,42,0.06)]"
                      transition={
                        reduce ? { duration: 0 } : { type: 'spring', bounce: 0.12, duration: 0.32 }
                      }
                    />
                  ) : null}
                  <span className="relative inline-flex items-center gap-2">
                    {item.icon ? (
                      <span aria-hidden="true" className="inline-flex">
                        {item.icon}
                      </span>
                    ) : null}
                    {item.label}
                    {item.count !== undefined ? (
                      <span
                        className={cx(
                          'min-w-5 rounded-full px-1.5 py-px text-center text-xs font-semibold tabular-nums',
                          active
                            ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)]'
                            : 'bg-[rgba(36,40,33,0.07)] text-[var(--text-secondary)]',
                        )}
                      >
                        {item.count}
                      </span>
                    ) : null}
                  </span>
                </RadixTabs.Trigger>
              );
            })}
          </LayoutGroup>
        </RadixTabs.List>
      </div>
      {children}
    </RadixTabs.Root>
  );
}

/** Панель вкладки. Должна находиться внутри Tabs. */
export function TabPanel({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixTabs.Content
      value={value}
      className={cx('mt-5 focus-visible:outline-offset-4', className)}
    >
      {children}
    </RadixTabs.Content>
  );
}
