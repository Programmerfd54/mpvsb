'use client';

import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import type { AuthProfile, Envelope } from '@context/contracts';

import { AuthCard } from '@/components/layout/auth-layout';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { Callout } from '@/components/ui/states';
import { ApiError, api, ensureCsrfCookie } from '@/lib/api';

export default function ActivatePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    setToken(value);
    void ensureCsrfCookie();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || pending || password !== confirmation) return;
    setPending(true);
    setError(null);
    try {
      const response = await api.post<Envelope<AuthProfile>>('/auth/activate', {
        token,
        password,
        acceptedDocumentVersionIds: [],
      });
      const profile = response.data;
      router.replace(
        profile.actorType === 'employee'
          ? '/employee'
          : profile.isPlatformAdmin
            ? '/admin'
            : '/app',
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : null);
      setPending(false);
    }
  }

  const mismatch = confirmation.length > 0 && password !== confirmation;
  return (
    <AuthCard
      icon={<KeyRound aria-hidden="true" />}
      title="Создайте пароль"
      description="Ссылка используется только после успешной установки пароля. До этого учётная запись не активируется."
    >
      {!token ? (
        <div className="mt-6 flex flex-col gap-4">
          <Callout tone="danger" title="Ссылка неполная">
            Откройте исходную ссылку из приглашения или запросите новую у администратора.
          </Callout>
          <ButtonLink href="/login">Перейти ко входу</ButtonLink>
        </div>
      ) : (
        <form className="mt-6 flex flex-col gap-5" onSubmit={submit} noValidate>
          {error ? (
            <Callout
              tone="danger"
              title={
                error.code === 'INVITATION_EXPIRED'
                  ? 'Ссылка истекла или уже использована'
                  : 'Не удалось активировать доступ'
              }
            >
              {error.code === 'INVITATION_EXPIRED'
                ? 'Попросите администратора выпустить новое приглашение.'
                : `${error.problem.title} Повторите попытку.`}
            </Callout>
          ) : null}
          <Field
            label="Новый пароль"
            hint="Не менее 12 символов."
            required
            error={error?.fieldError('password')}
          >
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            )}
          </Field>
          <Field
            label="Повторите пароль"
            required
            error={mismatch ? 'Пароли не совпадают' : undefined}
          >
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
                invalid={mismatch}
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={pending}
            disabled={password.length < 12 || mismatch || !confirmation}
          >
            Создать пароль и войти
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
