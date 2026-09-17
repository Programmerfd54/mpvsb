'use client';

import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Toaster, toast } from 'sonner';

const MOBILE_QUERY = '(max-width: 767px)';

function subscribe(callback: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

/**
 * Уведомления о результате операции.
 *
 * Успех показывается только после подтверждения сервером. Оптимистичный отклик
 * допустим лишь для обратимых мелочей вроде отметки «прочитано» (ТЗ 02.5).
 * Desktop — снизу справа, телефон — сверху по центру, чтобы не закрывать
 * нижние действия.
 */
export function ToastHost() {
  const mobile = useIsMobile();

  return (
    <Toaster
      // Регион уведомлений читает диктор — подпись на языке интерфейса.
      containerAriaLabel="Уведомления"
      position={mobile ? 'top-center' : 'bottom-right'}
      duration={5000}
      visibleToasts={3}
      closeButton
      gap={10}
      offset={mobile ? 12 : 24}
      icons={{
        success: (
          <CircleCheck
            aria-hidden="true"
            className="size-5 text-[var(--success-text)]"
            strokeWidth={1.75}
          />
        ),
        error: (
          <CircleAlert
            aria-hidden="true"
            className="size-5 text-[var(--danger-text)]"
            strokeWidth={1.75}
          />
        ),
        info: (
          <Info aria-hidden="true" className="size-5 text-[var(--info-text)]" strokeWidth={1.75} />
        ),
        warning: (
          <TriangleAlert
            aria-hidden="true"
            className="size-5 text-[var(--warning-text)]"
            strokeWidth={1.75}
          />
        ),
      }}
      toastOptions={{
        closeButtonAriaLabel: 'Закрыть уведомление',
        style: {
          background: 'var(--bg-surface)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-nested)',
          boxShadow: 'var(--shadow-overlay)',
          fontFamily: 'var(--font-ui), ui-sans-serif, system-ui, sans-serif',
          fontSize: '14px',
          padding: '14px 16px',
          gap: '10px',
        },
      }}
    />
  );
}

export const notify = {
  success(message: string): void {
    toast.success(message);
  },
  /** Ошибка живёт дольше и всегда сообщает, что делать дальше. */
  error(message: string, options?: { requestId?: string; retry?: () => void }): void {
    toast.error(message, {
      duration: 9000,
      description: options?.requestId ? `Код запроса: ${options.requestId}` : undefined,
      action: options?.retry ? { label: 'Повторить', onClick: options.retry } : undefined,
    });
  },
  info(message: string): void {
    toast(message);
  },
};
