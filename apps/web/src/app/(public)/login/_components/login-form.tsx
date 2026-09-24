'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import type { AuthProfile, Envelope } from '@context/contracts';

import { Button, IconButton } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';
import { ApiError, api, ensureCsrfCookie } from '@/lib/api';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Cookie защиты формы выдаётся до первой отправки, иначе вход выглядел бы
  // как «нажал и ничего не произошло».
  useEffect(() => {
    void ensureCsrfCookie();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await api.post<Envelope<AuthProfile>>('/auth/login', { email, password });
      const profile = response.data;

      if (profile.isPlatformAdmin) {
        router.push('/admin');
        return;
      }
      if (profile.actorType === 'employee') {
        router.push('/employee');
        return;
      }
      // Одна организация — открываем сразу, несколько — просим выбрать.
      router.push(profile.defaultOrganizationId ? '/app' : '/app/organizations');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : null);
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-card)] sm:p-7"
    >
      <h2 className="text-xl font-semibold">Войти в рабочее пространство</h2>

      {error ? (
        <ErrorState
          title={error.problem.title}
          description={
            error.status === 429
              ? 'Слишком много попыток подряд. Подождите и попробуйте снова.'
              : undefined
          }
          requestId={error.problem.requestId}
        />
      ) : null}

      <Field label="Электронная почта" required error={error?.fieldError('email')}>
        {({ inputId, describedBy }) => (
          <TextInput
            id={inputId}
            aria-describedby={describedBy}
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            invalid={Boolean(error?.fieldError('email'))}
          />
        )}
      </Field>

      <Field label="Пароль" required error={error?.fieldError('password')}>
        {({ inputId, describedBy }) => (
          /*
            Кнопка показа пароля лежит внутри поля, как крестик в поиске:
            рядом с полем она делала «Пароль» уже, чем «Электронная почта»,
            и правые края полей не совпадали.
          */
          <div className="relative w-full min-w-0">
            <TextInput
              id={inputId}
              aria-describedby={describedBy}
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              invalid={Boolean(error?.fieldError('password'))}
              className="pr-12"
            />
            <IconButton
              label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              icon={
                showPassword ? (
                  <EyeOff aria-hidden="true" strokeWidth={1.75} />
                ) : (
                  <Eye aria-hidden="true" strokeWidth={1.75} />
                )
              }
              onClick={() => setShowPassword((value) => !value)}
              aria-pressed={showPassword}
              className="absolute right-0 top-0 [&_svg]:size-[18px]"
            />
          </div>
        )}
      </Field>

      <Button type="submit" variant="primary" size="lg" loading={pending} fullWidth>
        Войти
      </Button>

      <div className="flex flex-wrap gap-4 text-sm">
        <a href="/password-reset">Восстановить доступ</a>
        <a href="/terms">Условия обработки данных</a>
      </div>
    </form>
  );
}
