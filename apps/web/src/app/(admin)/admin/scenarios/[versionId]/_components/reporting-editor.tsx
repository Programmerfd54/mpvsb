'use client';

import { useState } from 'react';

import type { Envelope, ReportingPolicy } from '@context/contracts';

import { FileCheck2, UserCog } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DetailDrawer } from '@/components/ui/dialog';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { Callout } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/query';

type Visibility = 'completion_receipt' | 'participant_summary';

const VISIBILITY_LABELS: Record<Visibility, string> = {
  completion_receipt: 'Подтверждение участия',
  participant_summary: 'Краткая обратная связь участнику',
};

/**
 * Правила заключения и видимость результата для участника.
 *
 * Политика — часть версии сценария: она задаёт, что заключению разрешено
 * утверждать, какие ограничения обязательны и что запрещено. Проверка
 * заключения опирается на неё, поэтому без политики версия не публикуется
 * (ТЗ 09.4, 10.2).
 */
export function ReportingEditor({
  policies,
  policyId,
  visibility,
  disabled,
  onPolicyChange,
  onVisibilityChange,
  onPoliciesReload,
}: {
  policies: readonly ReportingPolicy[];
  policyId: string | null;
  visibility: Visibility;
  disabled: boolean;
  onPolicyChange: (next: string | null) => void;
  onVisibilityChange: (next: Visibility) => void;
  onPoliciesReload: () => Promise<void>;
}) {
  const [creatorOpen, setCreatorOpen] = useState(false);
  const selected = policies.find((policy) => policy.id === policyId) ?? null;

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader
          icon={<FileCheck2 strokeWidth={1.75} />}
          title="Политика заключения"
          description="Набор правил версионный и общий для сценариев: изменение оформляется новой политикой, а не правкой существующей."
          action={
            disabled ? null : (
              <Button variant="secondary" size="sm" onClick={() => setCreatorOpen(true)}>
                Новая политика
              </Button>
            )
          }
        />
        <CardBody className="flex flex-col gap-4">
          <Field label="Выбранная политика">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={policyId ?? ''}
                disabled={disabled}
                onChange={(event) => onPolicyChange(event.target.value || null)}
              >
                <option value="">Не выбрана</option>
                {policies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.code} · v{policy.semanticVersion}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {selected ? (
            <div className="flex flex-col gap-4 text-sm">
              <PolicyList
                title="Допустимые утверждения"
                items={selected.permittedClaims}
                empty="Не заданы."
              />
              {selected.requiredLimitations.length === 0 ? (
                <Callout tone="danger" role="status" title="Нет обязательных ограничений">
                  С такой политикой заключение опубликовать нельзя.
                </Callout>
              ) : (
                <PolicyList
                  title="Обязательные ограничения"
                  items={selected.requiredLimitations}
                  empty=""
                />
              )}
              <PolicyList
                title="Запрещённые утверждения"
                items={selected.forbiddenClaims}
                empty="Не заданы."
                tone="danger"
              />
            </div>
          ) : (
            <Callout tone="warning" role="status">
              Политика не выбрана. Без неё нечем проверить обязательные ограничения заключения, и
              публикация версии будет отклонена.
            </Callout>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<UserCog strokeWidth={1.75} />}
          title="Что видит участник"
          description="Участник не получает выводов о себе, если это не предусмотрено сценарием явно."
        />
        <CardBody className="flex flex-col gap-4">
          <Field
            label="Результат для участника"
            hint="Подтверждение участия — участник видит только факт прохождения. Краткая обратная связь показывает ему сводку без кадровых выводов."
          >
            {({ inputId, describedBy }) => (
              <Select
                id={inputId}
                aria-describedby={describedBy}
                value={visibility}
                disabled={disabled}
                onChange={(event) => onVisibilityChange(event.target.value as Visibility)}
              >
                {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((value) => (
                  <option key={value} value={value}>
                    {VISIBILITY_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <p className="text-sm text-[var(--text-secondary)]">
            Заключение для руководителя проверяется человеком до публикации независимо от этой
            настройки.
          </p>
        </CardBody>
      </Card>

      <PolicyCreator
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        onCreated={async (policy) => {
          await onPoliciesReload();
          onPolicyChange(policy.id);
          setCreatorOpen(false);
        }}
      />
    </div>
  );
}

function PolicyList({
  title,
  items,
  empty,
  tone,
}: {
  title: string;
  items: readonly string[];
  empty: string;
  tone?: 'danger';
}) {
  return (
    <div>
      <p className="text-[var(--text-secondary)]">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-[var(--text-secondary)]">{empty}</p>
      ) : (
        <ul
          className={`mt-1 flex list-none flex-col gap-1 p-0 ${
            tone === 'danger' ? 'text-[var(--danger-text)]' : ''
          }`}
        >
          {items.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Новая политика: правила вводятся построчно, без обязательных ограничений её не создать. */
function PolicyCreator({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (policy: ReportingPolicy) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [semanticVersion, setSemanticVersion] = useState('1.0.0');
  const [permitted, setPermitted] = useState('');
  const [limitations, setLimitations] = useState('');
  const [forbidden, setForbidden] = useState('');

  const create = useApiMutation(
    (input: {
      code: string;
      semanticVersion: string;
      permittedClaims: string[];
      requiredLimitations: string[];
      forbiddenClaims: string[];
    }) => api.post<Envelope<ReportingPolicy>>('/admin/reporting-policies', input),
    {
      invalidate: [['admin-reporting-policies']],
      onError: (cause) => {
        if (cause && cause.problem.fieldErrors.length === 0) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        }
      },
    },
  );

  const lines = (value: string): string[] =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

  async function submit(): Promise<void> {
    try {
      const response = await create.mutateAsync({
        code,
        semanticVersion,
        permittedClaims: lines(permitted),
        requiredLimitations: lines(limitations),
        forbiddenClaims: lines(forbidden),
      });
      notify.success('Политика создана и выбрана для этой версии');
      await onCreated(response.data);
    } catch {
      // Ошибка уже доступна как create.error и показана рядом с полем.
    }
  }

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Новая политика заключения"
      description="Правила вводятся по одному в строке. Обязательные ограничения — то, что заключение обязано сказать о пределах своей применимости."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
        className="flex flex-col gap-5"
      >
        <Field
          label="Код политики"
          hint="Латиница в нижнем регистре, цифры и подчёркивание."
          required
          error={create.error?.fieldError('code')}
        >
          {({ inputId, describedBy }) => (
            <TextInput
              id={inputId}
              aria-describedby={describedBy}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={63}
              required
            />
          )}
        </Field>

        <Field label="Версия" required error={create.error?.fieldError('semanticVersion')}>
          {({ inputId }) => (
            <TextInput
              id={inputId}
              value={semanticVersion}
              onChange={(event) => setSemanticVersion(event.target.value)}
              placeholder="1.0.0"
              required
            />
          )}
        </Field>

        <Field
          label="Допустимые утверждения"
          hint="Что заключению разрешено утверждать. По одному в строке."
          error={create.error?.fieldError('permittedClaims')}
        >
          {({ inputId, describedBy }) => (
            <TextArea
              id={inputId}
              aria-describedby={describedBy}
              rows={4}
              value={permitted}
              onChange={(event) => setPermitted(event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Обязательные ограничения"
          hint="Минимум одно. Без ограничений заключение публиковаться не должно."
          required
          error={create.error?.fieldError('requiredLimitations')}
        >
          {({ inputId, describedBy }) => (
            <TextArea
              id={inputId}
              aria-describedby={describedBy}
              rows={4}
              value={limitations}
              onChange={(event) => setLimitations(event.target.value)}
              required
            />
          )}
        </Field>

        <Field
          label="Запрещённые утверждения"
          hint="Формулировки, которые проверка заключения обязана отклонять."
          error={create.error?.fieldError('forbiddenClaims')}
        >
          {({ inputId, describedBy }) => (
            <TextArea
              id={inputId}
              aria-describedby={describedBy}
              rows={4}
              value={forbidden}
              onChange={(event) => setForbidden(event.target.value)}
            />
          )}
        </Field>

        {lines(limitations).length === 0 ? (
          <Badge tone="warning">Укажите хотя бы одно обязательное ограничение</Badge>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={lines(limitations).length === 0}
            disabledReason={
              lines(limitations).length === 0 ? 'Нужно хотя бы одно ограничение' : undefined
            }
          >
            Создать политику
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
