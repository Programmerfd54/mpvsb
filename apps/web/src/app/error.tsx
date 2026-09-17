'use client';

import { Button } from '@/components/ui/button';
import { ShellMessage } from '@/components/layout/app-shell';
import { ErrorState } from '@/components/ui/states';

/**
 * Ошибка внутри страницы.
 *
 * Тот же каркас служебных страниц: логомарк, тёплый фон, сообщение по центру.
 * Действие — повтор: введённые данные не отправлялись.
 */
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ShellMessage>
      <ErrorState
        title="Страница не открылась"
        description="Произошла техническая ошибка. Попробуйте повторить: введённые данные не отправлялись."
        requestId={error.digest}
        action={
          <Button variant="primary" onClick={reset}>
            Повторить
          </Button>
        }
      />
    </ShellMessage>
  );
}
