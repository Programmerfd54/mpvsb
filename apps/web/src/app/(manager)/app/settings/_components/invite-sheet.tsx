'use client';

import { useRef, useState, type RefObject } from 'react';

import type { Envelope, InviteManagerRequest, IssuedLink } from '@context/contracts';
import {
  DEFAULT_MANAGER_PERMISSIONS,
  ORG_PERMISSIONS,
  ORG_PERMISSION_LABELS,
} from '@context/domain';
import type { OrgPermission } from '@context/domain';

import { Button } from '@/components/ui/button';
import { Checkbox, Field, TextInput } from '@/components/ui/field';
import { Sheet } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/query';

import { IssuedLinkPanel } from './issued-link-panel';

interface InviteResult {
  readonly membershipId: string;
  readonly activation: IssuedLink;
}

/**
 * Приглашение руководителя: форма → выпуск ссылки активации.
 * Ссылка отдаётся сервером один раз и здесь же показывается — дальше её
 * можно получить только повторным выпуском (см. «Выпустить ссылку заново»).
 */
export function InviteSheet({
  open,
  onOpenChange,
  organizationId,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [permissions, setPermissions] = useState<readonly OrgPermission[]>(
    DEFAULT_MANAGER_PERMISSIONS,
  );
  const [result, setResult] = useState<InviteResult | null>(null);
  const formId = useRef(`invite-form-${Math.random().toString(36).slice(2)}`).current;

  const invite = useApiMutation<InviteManagerRequest, Envelope<InviteResult>>(
    (body) => api.post<Envelope<InviteResult>>(`/orgs/${organizationId}/members`, body),
    {
      invalidate: [['org-members', organizationId]],
      onSuccess: (response) => setResult(response.data),
    },
  );

  function reset(): void {
    setEmail('');
    setDisplayName('');
    setPermissions(DEFAULT_MANAGER_PERMISSIONS);
    setResult(null);
    invite.reset();
  }

  function togglePermission(permission: OrgPermission, checked: boolean): void {
    setPermissions((prev) =>
      checked ? [...prev, permission] : prev.filter((item) => item !== permission),
    );
  }

  const fieldError = (field: string): string | undefined => invite.error?.fieldError(field);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
        }
        onOpenChange(next);
      }}
      title="Пригласить руководителя"
      description={
        result
          ? undefined
          : 'Он получит доступ к разделам, которые вы отметите. Роль владельца выдаётся отдельно правом «Управление организацией и доступами».'
      }
      returnFocusRef={returnFocusRef}
      footer={
        result ? (
          <Button variant="primary" fullWidth onClick={() => onOpenChange(false)}>
            Готово
          </Button>
        ) : (
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="primary"
              loading={invite.isPending}
              disabled={permissions.length === 0}
              disabledReason={permissions.length === 0 ? 'Отметьте хотя бы одно право' : undefined}
            >
              Отправить приглашение
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <IssuedLinkPanel link={result.activation} />
      ) : (
        <form
          id={formId}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            invite.mutate({ email, displayName, permissions: [...permissions] });
          }}
          className="flex flex-col gap-5"
        >
          {invite.error && invite.error.problem.fieldErrors.length === 0 ? (
            <ErrorState
              title={invite.error.problem.title}
              requestId={invite.error.problem.requestId}
            />
          ) : null}

          <Field label="Имя" required error={fieldError('displayName')}>
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                maxLength={200}
                required
                invalid={Boolean(fieldError('displayName'))}
              />
            )}
          </Field>

          <Field label="Email" required error={fieldError('email')}>
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                invalid={Boolean(fieldError('email'))}
              />
            )}
          </Field>

          <fieldset className="flex min-w-0 flex-col gap-1 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
              Права доступа
            </legend>
            <div className="flex flex-col divide-y divide-[var(--border-hairline)]">
              {ORG_PERMISSIONS.map((permission) => (
                <Checkbox
                  key={permission}
                  checked={permissions.includes(permission)}
                  onChange={(checked) => togglePermission(permission, checked)}
                  label={ORG_PERMISSION_LABELS[permission]}
                />
              ))}
            </div>
            {fieldError('permissions') ? (
              <p role="alert" className="mt-1 text-sm text-[var(--danger-text)]">
                {fieldError('permissions')}
              </p>
            ) : null}
          </fieldset>
        </form>
      )}
    </Sheet>
  );
}
