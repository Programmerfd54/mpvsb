'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AuthCard } from '@/components/layout/auth-layout';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { ApiError, api, ensureCsrfCookie } from '@/lib/api';

/**
 * Открытие персональной ссылки.
 *
 * Токен приходит во fragment (`#token=…`): он не попадает ни в журнал
 * веб-сервера, ни в заголовок Referer. Сам по себе переход по ссылке ничего
 * не активирует — обмен происходит только по явному действию человека, поэтому
 * почтовый сканер или предпросмотр ссылки не расходуют приглашение (ТЗ E01).
 */
export default function ParticipatePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    void ensureCsrfCookie();
    const hash = window.location.hash.replace(/^#/, '');
    const value = new URLSearchParams(hash).get('token');
    setToken(value);
  }, []);

  async function open(): Promise<void> {
    if (!token || pending) {
      return;
    }
    setPending(true);
    setError(null);

    try {
      await api.post('/participant/exchange', { token });
      // Секрет убирается из адресной строки сразу после обмена.
      window.history.replaceState(null, '', '/participant/welcome');
      router.replace('/participant/welcome');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : null);
      setPending(false);
    }
  }

  return (
    <AuthCard title="Вы получили приглашение пройти оценку" presentation="invitation">
      {error ? (
        <div className="mt-5">
          <ErrorState
            title={error.problem.title}
            description="Если ссылка перестала работать, обратитесь к тому, кто её вам передал."
            requestId={error.problem.requestId}
          />
        </div>
      ) : null}

      {token === null && !error ? (
        <div className="mt-5">
          <ErrorState
            title="Ссылка неполная"
            description="Откройте ссылку целиком — вместе с частью после символа #."
          />
        </div>
      ) : null}

      <div className="mx-auto mt-8 w-full max-w-[380px]">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          className="h-16 px-8 text-[18px]"
          loading={pending}
          disabled={!token}
          disabledReason={token ? undefined : 'Кнопка станет доступной, когда ссылка будет полной.'}
          onClick={() => void open()}
        >
          Открыть приглашение
        </Button>
      </div>

      <p className="mx-auto mt-6 max-w-[62ch] text-center text-[17px] leading-[1.65] text-[var(--text-secondary)]">
        На следующем шаге вы увидите, кто проводит оценку, что предстоит сделать и как будут
        использованы ваши ответы.
      </p>
    </AuthCard>
  );
}
