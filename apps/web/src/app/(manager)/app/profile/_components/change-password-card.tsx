'use client';

import { useState } from 'react';

import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  type ChangePasswordRequest,
  type Envelope,
  type GenericAcknowledgement,
} from '@context/contracts';

import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/field';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/query';

/**
 * Смена пароля отзывает остальные сессии пользователя (кроме текущей) —
 * сервер сообщает об этом в тексте успеха, а не тихо.
 */
export function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const change = useApiMutation<ChangePasswordRequest, Envelope<GenericAcknowledgement>>(
    (body) => api.post<Envelope<GenericAcknowledgement>>('/auth/password/change', body),
    {
      // Смена пароля отзывает остальные сессии на сервере: список сессий
      // должен обновиться сразу, а не ждать следующего фонового опроса.
      invalidate: [['auth-sessions']],
      onSuccess: (response) => {
        notify.success(response.data.message);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setMismatch(false);
      },
    },
  );

  function submit(): void {
    if (newPassword !== confirmPassword) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    change.mutate({ currentPassword, newPassword });
  }

  return (
    <Card>
      <CardHeader
        title="Смена пароля"
        description={`Не короче ${PASSWORD_MIN} символов. После смены остальные сессии завершатся.`}
      />
      <CardBody>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4"
        >
          {change.error && change.error.problem.fieldErrors.length === 0 ? (
            <p role="alert" className="text-sm text-[var(--danger-text)]">
              {change.error.problem.title}
            </p>
          ) : null}

          <Field
            label="Текущий пароль"
            required
            error={change.error?.fieldError('currentPassword')}
          >
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                invalid={Boolean(change.error?.fieldError('currentPassword'))}
              />
            )}
          </Field>

          <Field label="Новый пароль" required error={change.error?.fieldError('newPassword')}>
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN}
                maxLength={PASSWORD_MAX}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                invalid={Boolean(change.error?.fieldError('newPassword'))}
              />
            )}
          </Field>

          <Field
            label="Повторите новый пароль"
            required
            error={mismatch ? 'Пароли не совпадают' : undefined}
          >
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setMismatch(false);
                }}
                required
                invalid={mismatch}
              />
            )}
          </Field>

          <div>
            <Button type="submit" variant="primary" loading={change.isPending}>
              Сменить пароль
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
