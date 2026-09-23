'use client';

import { Building2, Image as ImageIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { AdminWorkspace, Envelope, UpdateAdminWorkspace } from '@context/contracts';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/field';
import { Stepper } from '@/components/ui/progress';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';

const STEPS = [
  { key: 'company', label: 'Компания' },
  { key: 'mail', label: 'Почта' },
  { key: 'mail_template', label: 'Письмо' },
  { key: 'departments', label: 'Подразделения' },
  { key: 'users', label: 'Пользователи' },
  { key: 'review', label: 'Проверка' },
] as const;

export default function AdminSetupPage() {
  const query = useApiQuery<Envelope<AdminWorkspace>>(['admin', 'workspace'], '/admin/workspace');
  const workspace = query.data?.data;
  const [step, setStep] = useState(0);
  const initialized = useRef(false);

  useEffect(() => {
    if (!workspace || initialized.current) return;
    const firstPending = workspace.steps.findIndex((item) => item.status === 'pending');
    setStep(firstPending < 0 ? STEPS.length - 1 : firstPending);
    initialized.current = true;
  }, [workspace]);

  if (query.error) {
    return (
      <>
        <PageHeader title="Настройка пространства" />
        <ErrorState
          title="Не удалось загрузить настройки"
          description="Проверьте подключение и повторите попытку."
          requestId={query.error.problem.requestId}
          onRetry={query.refetch}
        />
      </>
    );
  }
  if (!workspace) return <PageSkeleton variant="form" label="Загружаем настройки" />;

  return (
    <>
      <PageHeader
        title="Настройка пространства"
        description="Настройки сохраняются на сервере после каждого завершённого шага."
      />
      <div className="mb-6">
        <Stepper steps={STEPS} current={step} onStepClick={setStep} label="Шаги настройки" />
      </div>
      {step === 0 ? <CompanyStep workspace={workspace} /> : <PendingStep step={step} />}
    </>
  );
}

function CompanyStep({ workspace }: { workspace: AdminWorkspace }) {
  const [name, setName] = useState(workspace.name);
  const [logoUrl, setLogoUrl] = useState(workspace.logoUrl ?? '');
  const dirty = name !== workspace.name || logoUrl !== (workspace.logoUrl ?? '');

  useEffect(() => {
    if (!dirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [dirty]);

  const update = useApiMutation<UpdateAdminWorkspace, Envelope<AdminWorkspace>>(
    (body) => api.patch('/admin/workspace', body),
    {
      invalidate: [['admin', 'workspace']],
      onSuccess: (result) => {
        setName(result.data.name);
        setLogoUrl(result.data.logoUrl ?? '');
        notify.success('Данные компании сохранены');
      },
      onError: (error) =>
        error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
    },
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(260px,2fr)]">
      <Card>
        <CardHeader
          title="Название и логотип"
          description="Название появится в кабинетах руководителей и сотрудников."
          icon={<Building2 aria-hidden="true" />}
        />
        <CardBody>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate({
                name,
                logoUrl: logoUrl.trim() === '' ? null : logoUrl.trim(),
                expectedRevision: workspace.revision,
              });
            }}
          >
            {update.error && update.error.problem.fieldErrors.length === 0 ? (
              <ErrorState
                title={update.error.problem.title}
                description={
                  update.error.status === 409
                    ? 'Обновите страницу и повторите сохранение. Введённые значения останутся в форме.'
                    : undefined
                }
                requestId={update.error.problem.requestId}
              />
            ) : null}
            <Field label="Название компании" required error={update.error?.fieldError('name')}>
              {({ inputId, describedBy }) => (
                <TextInput
                  id={inputId}
                  aria-describedby={describedBy}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                  required
                />
              )}
            </Field>
            <Field
              label="Адрес логотипа"
              hint="На следующем этапе поле будет заменено безопасной загрузкой файла."
              error={update.error?.fieldError('logoUrl')}
            >
              {({ inputId, describedBy }) => (
                <TextInput
                  id={inputId}
                  aria-describedby={describedBy}
                  type="url"
                  value={logoUrl}
                  onChange={(event) => setLogoUrl(event.target.value)}
                  placeholder="https://example.invalid/logo.png"
                  maxLength={500}
                />
              )}
            </Field>
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                loading={update.isPending}
                disabled={!dirty || name.trim().length < 2}
              >
                Сохранить и продолжить
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card tone="inset">
        <CardHeader title="Предпросмотр" icon={<ImageIcon aria-hidden="true" />} />
        <CardBody className="flex min-h-48 items-center justify-center">
          {logoUrl.trim() ? (
            <img
              src={logoUrl}
              alt="Предпросмотр логотипа компании"
              className="max-h-28 max-w-full object-contain"
            />
          ) : (
            <div className="text-center">
              <p className="font-semibold">{name || 'Название компании'}</p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Логотип не добавлен</p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function PendingStep({ step }: { step: number }) {
  return (
    <EmptyState
      title={`${STEPS[step]?.label ?? 'Шаг'} будет подключён следующим`}
      description="Состояние шага уже приходит с сервера; форма появится вместе с защищённым API."
    />
  );
}
