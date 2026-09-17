'use client';

import { Info, TriangleAlert, X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode, RefObject } from 'react';

import { Button, IconButton } from './button';
import { cx } from './tint';

const OVERLAY_CLASS =
  'ui-overlay fixed inset-0 z-40 bg-[var(--bg-overlay)] supports-[backdrop-filter]:backdrop-blur-[2px]';

/**
 * Модальное окно подтверждения.
 *
 * Radix обеспечивает ловушку фокуса, закрытие по Esc и возврат фокуса
 * на вызвавший элемент. Безопасное действие получает фокус по умолчанию:
 * случайный Enter не должен запускать необратимую операцию.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  confirmLabel,
  cancelLabel = 'Отмена',
  destructive = false,
  loading = false,
  onConfirm,
  children,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  consequences?: readonly string[];
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
  /**
   * Куда вернуть фокус после закрытия. Диалог открывается состоянием, без
   * `Dialog.Trigger`, поэтому Radix сам вернуть фокус не может.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY_CLASS} />
        <RadixDialog.Content
          className="ui-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-overlay)] focus:outline-none"
          onOpenAutoFocus={(event) => {
            // Фокус ставим на «Отмена»: подтверждение требует осознанного выбора,
            // а случайный Enter не должен запускать необратимое действие.
            event.preventDefault();
            const target = event.target;
            if (target instanceof HTMLElement) {
              target.querySelector<HTMLElement>('[data-safe-focus]')?.focus();
            }
          }}
          onCloseAutoFocus={
            returnFocusRef
              ? (event) => {
                  const trigger = returnFocusRef.current;
                  if (trigger && trigger.isConnected) {
                    event.preventDefault();
                    trigger.focus();
                  }
                }
              : undefined
          }
        >
          <span
            aria-hidden="true"
            className={cx(
              'mb-4 grid size-11 place-items-center rounded-full [&_svg]:size-5',
              destructive
                ? 'bg-[var(--danger-soft)] text-[var(--danger-text)]'
                : 'bg-[var(--accent-soft)] text-[var(--accent-ink)]',
            )}
          >
            {destructive ? <TriangleAlert strokeWidth={1.75} /> : <Info strokeWidth={1.75} />}
          </span>
          <RadixDialog.Title className="text-lg font-semibold leading-snug">
            {title}
          </RadixDialog.Title>
          <RadixDialog.Description className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            {description}
          </RadixDialog.Description>

          {consequences && consequences.length > 0 ? (
            <ul className="mt-4 flex list-none flex-col gap-2 rounded-[var(--radius-nested)] bg-[var(--bg-inset)] p-4 text-sm">
              {consequences.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--text-secondary)]"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {children ? <div className="mt-4">{children}</div> : null}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <RadixDialog.Close asChild>
              <Button variant="secondary" data-safe-focus>
                {cancelLabel}
              </Button>
            </RadixDialog.Close>
            <Button
              variant={destructive ? 'destructive' : 'primary'}
              onClick={onConfirm}
              loading={loading}
            >
              {confirmLabel}
            </Button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface SheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly side?: 'right' | 'left';
  /** Ширина на desktop, CSS-значение. По умолчанию 520px справа, 320px слева. */
  readonly width?: string;
  /** Заголовок читается диктором, но визуально скрыт. */
  readonly hideTitle?: boolean;
  readonly bodyClassName?: string;
  /**
   * Элемент, на который вернуть фокус при закрытии.
   *
   * Панель, открытая состоянием (без `Dialog.Trigger`), не знает, кто её
   * вызвал: Radix возвращает фокус в начало документа, и пользователь
   * клавиатуры теряет место. Передайте ref кнопки-триггера.
   */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Боковая панель (Radix Dialog): ловушка фокуса, Esc, возврат фокуса.
 * Справа на desktop и на весь экран на телефоне; слева — для навигации.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = 'right',
  width,
  hideTitle = false,
  bodyClassName,
  returnFocusRef,
}: SheetProps) {
  const resolvedWidth = width ?? (side === 'left' ? '320px' : '520px');

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY_CLASS} />
        <RadixDialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          onCloseAutoFocus={
            returnFocusRef
              ? (event) => {
                  const trigger = returnFocusRef.current;
                  if (trigger && trigger.isConnected) {
                    event.preventDefault();
                    trigger.focus();
                  }
                }
              : undefined
          }
          style={{ ['--sheet-width' as string]: resolvedWidth }}
          className={cx(
            'fixed inset-y-0 z-50 flex flex-col bg-[var(--bg-surface)] shadow-[var(--shadow-overlay)] focus:outline-none',
            side === 'right'
              ? 'ui-sheet-right right-0 w-full sm:w-[min(var(--sheet-width),calc(100vw-48px))] sm:rounded-l-[var(--radius-card)]'
              : 'ui-sheet-left left-0 w-[min(var(--sheet-width),calc(100vw-48px))] rounded-r-[var(--radius-card)]',
          )}
        >
          <div
            className={cx(
              hideTitle
                ? 'absolute right-3 z-10 flex'
                : 'flex items-start justify-between gap-4 px-5 pb-3 sm:px-6',
            )}
            style={
              hideTitle
                ? { top: 'max(12px, env(safe-area-inset-top))' }
                : { paddingTop: 'max(16px, env(safe-area-inset-top))' }
            }
          >
            <div className={cx('min-w-0 pt-2', hideTitle && 'sr-only')}>
              <RadixDialog.Title className="text-lg font-semibold leading-snug">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <IconButton
                label="Закрыть панель"
                icon={<X strokeWidth={1.75} aria-hidden="true" />}
                className={hideTitle ? '' : '-mr-2 ml-auto'}
              />
            </RadixDialog.Close>
          </div>

          {/*
            Без нижней панели безопасную зону телефона учитывает само тело:
            иначе последний элемент (например, карточка пользователя в
            навигации) уходит под индикатор «домой».
          */}
          <div
            className={cx(
              'flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6',
              bodyClassName,
            )}
            style={footer ? undefined : { paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          >
            {children}
          </div>

          {footer ? (
            <div
              className="border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] px-5 py-4 sm:px-6"
              style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
            >
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Боковая панель деталей. На узких экранах разворачивается на весь экран. */
export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Куда вернуть фокус после закрытия: ref кнопки, открывшей панель. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(description ? { description } : {})}
      {...(footer ? { footer } : {})}
      {...(returnFocusRef ? { returnFocusRef } : {})}
      side="right"
    >
      {children}
    </Sheet>
  );
}
