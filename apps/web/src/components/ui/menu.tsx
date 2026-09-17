'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { DropdownMenu } from 'radix-ui';
import { Fragment, type ReactNode } from 'react';

import { IconButton } from './button';
import { cx } from './tint';

export interface ActionMenuItem {
  /** Устойчивый ключ, если в меню есть пункты с одинаковой подписью. */
  readonly id?: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly onSelect?: () => void;
  readonly href?: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
}

const ITEM_CLASS = cx(
  'flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium no-underline outline-none',
  'transition-colors duration-[var(--motion-fast)]',
  'data-[highlighted]:bg-[var(--bg-inset)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  '[&_svg]:size-4 [&_svg]:shrink-0',
);

/**
 * Меню действий (Radix DropdownMenu): стрелки, Home/End, поиск по первой букве,
 * Esc и возврат фокуса на кнопку. Триггер по умолчанию — «⋯».
 */
export function ActionMenu({
  label,
  items,
  align = 'end',
  side = 'bottom',
  trigger,
  contentClassName,
}: {
  /** Доступное имя кнопки меню, например «Действия с сотрудником». */
  label: string;
  items: readonly ActionMenuItem[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Свой триггер: элемент, принимающий ref (Button, IconButton, button). */
  trigger?: ReactNode;
  contentClassName?: string;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        {trigger ?? (
          <IconButton
            label={label}
            size="sm"
            icon={<Ellipsis aria-hidden="true" strokeWidth={1.75} />}
          />
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
          className={cx(
            'ui-popover z-50 min-w-[220px] max-w-[calc(100vw-24px)] rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1.5 shadow-[var(--shadow-overlay)] outline-none',
            contentClassName,
          )}
        >
          {items.map((item, index) => {
            const tone = item.destructive
              ? 'text-[var(--danger-text)] data-[highlighted]:bg-[var(--danger-soft)] data-[highlighted]:text-[var(--danger-text)]'
              : 'text-[var(--text-primary)] data-[highlighted]:text-[var(--text-primary)] [&_svg]:text-[var(--text-secondary)]';

            return (
              /* Ключ включает позицию: подписи вроде «Открыть» повторяются. */
              <Fragment key={item.id ?? `${index}-${item.label}`}>
                {item.separatorBefore ? (
                  <DropdownMenu.Separator className="mx-1.5 my-1.5 h-px bg-[var(--border-hairline)]" />
                ) : null}
                {item.href ? (
                  <DropdownMenu.Item asChild disabled={item.disabled} onSelect={item.onSelect}>
                    <Link href={item.href} className={cx(ITEM_CLASS, tone)}>
                      {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
                      {item.label}
                    </Link>
                  </DropdownMenu.Item>
                ) : (
                  <DropdownMenu.Item
                    disabled={item.disabled}
                    onSelect={item.onSelect}
                    className={cx(ITEM_CLASS, tone)}
                  >
                    {item.icon ? (
                      <span aria-hidden="true" className="inline-flex">
                        {item.icon}
                      </span>
                    ) : null}
                    {item.label}
                  </DropdownMenu.Item>
                )}
              </Fragment>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
