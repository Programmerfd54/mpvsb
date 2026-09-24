'use client';

import { Building2, CheckCircle2, Image as ImageIcon, Mail, Send, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type {
  AdminMailSettings,
  AdminMailTemplate,
  AdminMailTest,
  AdminWorkspace,
  Envelope,
  SaveAdminMailSettings,
  SaveAdminMailTemplate,
  UpdateAdminWorkspace,
} from '@context/contracts';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, TextArea, TextInput } from '@/components/ui/field';
import { Stepper } from '@/components/ui/progress';
import { ErrorState, PageSkeleton } from '@/components/ui/states';
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
      {step === 0 ? <CompanyStep workspace={workspace} /> : null}
      {step === 1 ? <MailStep /> : null}
      {step === 2 ? <MailTemplateStep /> : null}
      {step === 3 ? <DirectoryStep kind="departments" /> : null}
      {step === 4 ? <DirectoryStep kind="users" /> : null}
      {step === 5 ? <ReviewStep workspace={workspace} /> : null}
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

function MailStep() {
  const query = useApiQuery<Envelope<AdminMailSettings | null>>(['admin', 'mail'], '/admin/mail');
  const current = query.data?.data ?? null;
  const [host, setHost] = useState('');
  const [port, setPort] = useState('465');
  const [secure, setSecure] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');

  useEffect(() => {
    if (!query.data) return;
    setHost(current?.host ?? '');
    setPort(String(current?.port ?? 465));
    setSecure(current?.secure ?? true);
    setUsername(current?.username ?? '');
    setPassword('');
    setFromEmail(current?.fromEmail ?? '');
    setFromName(current?.fromName ?? '');
  }, [current, query.data]);

  const save = useApiMutation<SaveAdminMailSettings, Envelope<AdminMailSettings>>(
    (body) => api.patch('/admin/mail', body),
    {
      invalidate: [
        ['admin', 'mail'],
        ['admin', 'workspace'],
      ],
      onSuccess: () => {
        setPassword('');
        notify.success('SMTP-настройки сохранены');
      },
      onError: (error) =>
        error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
    },
  );
  const test = useApiMutation<void, Envelope<AdminMailTest>>(() => api.post('/admin/mail/test'), {
    invalidate: [
      ['admin', 'mail'],
      ['admin', 'workspace'],
    ],
    onSuccess: (result) => notify.success(result.data.message),
    onError: (error) =>
      error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
  });

  if (query.error)
    return (
      <ErrorState
        title="Не удалось загрузить SMTP-настройки"
        requestId={query.error.problem.requestId}
        onRetry={query.refetch}
      />
    );
  if (!query.data) return <PageSkeleton variant="form" label="Загружаем SMTP-настройки" />;

  return (
    <Card>
      <CardHeader
        title="Почта для приглашений"
        description="Секрет SMTP хранится зашифрованно; после сохранения пароль в интерфейс не возвращается."
        icon={<Mail aria-hidden="true" />}
      />
      <CardBody>
        <form
          className="grid gap-5 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({
              host,
              port: Number(port),
              secure,
              username: username.trim() || null,
              password: password || null,
              fromEmail,
              fromName,
              expectedRevision: current?.revision ?? null,
            });
          }}
        >
          {save.error && save.error.problem.fieldErrors.length === 0 ? (
            <div className="md:col-span-2">
              <ErrorState
                title={save.error.problem.title}
                description={
                  save.error.status === 409
                    ? 'Настройки изменились в другой вкладке. Обновите данные и повторите сохранение.'
                    : undefined
                }
                requestId={save.error.problem.requestId}
              />
            </div>
          ) : null}
          <Field label="SMTP host" required error={save.error?.fieldError('host')}>
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                value={host}
                onChange={(event) => setHost(event.target.value)}
                required
                maxLength={253}
              />
            )}
          </Field>
          <Field label="Порт" required error={save.error?.fieldError('port')}>
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                value={port}
                onChange={(event) => setPort(event.target.value)}
                inputMode="numeric"
                required
              />
            )}
          </Field>
          <Field label="Логин SMTP" error={save.error?.fieldError('username')}>
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                maxLength={320}
              />
            )}
          </Field>
          <Field
            label={current?.passwordConfigured ? 'Новый пароль SMTP' : 'Пароль SMTP'}
            hint={
              current?.passwordConfigured
                ? 'Оставьте пустым, чтобы сохранить текущий пароль.'
                : undefined
            }
            required={!current?.passwordConfigured}
            error={save.error?.fieldError('password')}
          >
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required={!current?.passwordConfigured}
              />
            )}
          </Field>
          <Field label="Email отправителя" required error={save.error?.fieldError('fromEmail')}>
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                type="email"
                value={fromEmail}
                onChange={(event) => setFromEmail(event.target.value)}
                required
                maxLength={320}
              />
            )}
          </Field>
          <Field label="Имя отправителя" required error={save.error?.fieldError('fromName')}>
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                value={fromName}
                onChange={(event) => setFromName(event.target.value)}
                required
                maxLength={200}
              />
            )}
          </Field>
          <div className="md:col-span-2">
            <Checkbox
              checked={secure}
              onChange={setSecure}
              label="Использовать защищённое соединение"
              description="Обычно включено для порта 465. Для STARTTLS чаще используют 587."
            />
          </div>
          <div className="flex flex-wrap justify-end gap-3 md:col-span-2">
            <Button
              type="button"
              icon={<Send aria-hidden="true" />}
              loading={test.isPending}
              disabled={!current || save.isPending}
              onClick={() => test.mutate()}
            >
              Проверить соединение
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={save.isPending}
              disabled={!host.trim() || !fromEmail.trim() || !fromName.trim() || Number(port) < 1}
            >
              Сохранить почту
            </Button>
          </div>
          {current?.verifiedAt ? (
            <p className="text-sm text-[var(--success-text)] md:col-span-2">
              Последняя успешная проверка: {new Date(current.verifiedAt).toLocaleString('ru-RU')}
            </p>
          ) : current?.lastTestErrorCode ? (
            <p className="text-sm text-[var(--danger-text)] md:col-span-2">
              Последняя проверка завершилась ошибкой: {current.lastTestErrorCode}
            </p>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}

function MailTemplateStep() {
  const query = useApiQuery<Envelope<AdminMailTemplate>>(
    ['admin', 'mail-template'],
    '/admin/mail-template',
  );
  const template = query.data?.data;
  const [subject, setSubject] = useState('');
  const [greeting, setGreeting] = useState('');
  const [body, setBody] = useState('');
  const [buttonLabel, setButtonLabel] = useState('');
  const [signature, setSignature] = useState('');
  const [supportContact, setSupportContact] = useState('');

  useEffect(() => {
    if (!template) return;
    setSubject(template.subject);
    setGreeting(template.greeting);
    setBody(template.body);
    setButtonLabel(template.buttonLabel);
    setSignature(template.signature);
    setSupportContact(template.supportContact ?? '');
  }, [template]);

  const save = useApiMutation<SaveAdminMailTemplate, Envelope<AdminMailTemplate>>(
    (payload) => api.patch('/admin/mail-template', payload),
    {
      invalidate: [
        ['admin', 'mail-template'],
        ['admin', 'workspace'],
      ],
      onSuccess: (result) =>
        notify.success(
          result.data.status === 'published' ? 'Шаблон опубликован' : 'Шаблон сохранён',
        ),
      onError: (error) =>
        error && notify.error(error.problem.title, { requestId: error.problem.requestId }),
    },
  );

  if (query.error)
    return (
      <ErrorState
        title="Не удалось загрузить шаблон письма"
        requestId={query.error.problem.requestId}
        onRetry={query.refetch}
      />
    );
  if (!template) return <PageSkeleton variant="form" label="Загружаем шаблон письма" />;

  const submit = (publish: boolean) => {
    save.mutate({
      subject,
      greeting,
      body,
      buttonLabel,
      signature,
      supportContact: supportContact.trim() || null,
      expectedRevision: template.revision,
      publish,
    });
  };

  return (
    <Card>
      <CardHeader
        title="Письмо активации"
        description="Используйте переменные {{name}}, {{organization}} и ссылку активации, которую подставляет сервер."
        icon={<Send aria-hidden="true" />}
        action={
          <Badge tone={template.status === 'published' ? 'success' : 'warning'}>
            {template.status === 'published' ? 'Опубликован' : 'Черновик'}
          </Badge>
        }
      />
      <CardBody>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit(false);
          }}
        >
          {save.error && save.error.problem.fieldErrors.length === 0 ? (
            <ErrorState title={save.error.problem.title} requestId={save.error.problem.requestId} />
          ) : null}
          <Field label="Тема" required error={save.error?.fieldError('subject')}>
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={200}
                required
              />
            )}
          </Field>
          <Field label="Приветствие" required error={save.error?.fieldError('greeting')}>
            {({ inputId, describedBy }) => (
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                value={greeting}
                onChange={(event) => setGreeting(event.target.value)}
                maxLength={500}
                required
              />
            )}
          </Field>
          <Field label="Текст письма" required error={save.error?.fieldError('body')}>
            {({ inputId, describedBy }) => (
              <TextArea
                id={inputId}
                aria-describedby={describedBy}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={3000}
                rows={6}
                required
              />
            )}
          </Field>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Текст кнопки" required error={save.error?.fieldError('buttonLabel')}>
              {({ inputId, describedBy }) => (
                <TextInput
                  id={inputId}
                  aria-describedby={describedBy}
                  value={buttonLabel}
                  onChange={(event) => setButtonLabel(event.target.value)}
                  maxLength={80}
                  required
                />
              )}
            </Field>
            <Field label="Контакт поддержки" error={save.error?.fieldError('supportContact')}>
              {({ inputId, describedBy }) => (
                <TextInput
                  id={inputId}
                  aria-describedby={describedBy}
                  value={supportContact}
                  onChange={(event) => setSupportContact(event.target.value)}
                  maxLength={320}
                />
              )}
            </Field>
          </div>
          <Field label="Подпись" required error={save.error?.fieldError('signature')}>
            {({ inputId, describedBy }) => (
              <TextArea
                id={inputId}
                aria-describedby={describedBy}
                value={signature}
                onChange={(event) => setSignature(event.target.value)}
                maxLength={500}
                rows={3}
                required
              />
            )}
          </Field>
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="submit" loading={save.isPending}>
              Сохранить черновик
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={save.isPending}
              onClick={() => submit(true)}
              disabled={
                !subject.trim() ||
                !greeting.trim() ||
                !body.trim() ||
                !buttonLabel.trim() ||
                !signature.trim()
              }
            >
              Опубликовать
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function DirectoryStep({ kind }: { kind: 'departments' | 'users' }) {
  const isDepartments = kind === 'departments';
  return (
    <Card>
      <CardHeader
        title={isDepartments ? 'Подразделения' : 'Пользователи'}
        description={
          isDepartments
            ? 'Создайте структуру, чтобы затем ограничивать доступ руководителей своей областью.'
            : 'Пригласите руководителей, рецензентов и сотрудников. Активационная ссылка показывается один раз.'
        }
        icon={<Users aria-hidden="true" />}
      />
      <CardBody className="flex flex-col gap-4">
        <p className="max-w-3xl text-[15px] leading-relaxed text-[var(--text-secondary)]">
          {isDepartments
            ? 'Список и карточки подразделений открываются в отдельном разделе, где можно назначать руководителей, переводить сотрудников и архивировать пустые подразделения.'
            : 'Создание пользователя выполняется на странице пользователей. После ответа сервера можно скопировать ссылку активации и передать её адресату.'}
        </p>
        <div>
          <ButtonLink
            href={isDepartments ? '/admin/departments' : '/admin/users'}
            variant="primary"
          >
            {isDepartments ? 'Открыть подразделения' : 'Открыть пользователей'}
          </ButtonLink>
        </div>
      </CardBody>
    </Card>
  );
}

function ReviewStep({ workspace }: { workspace: AdminWorkspace }) {
  const completed = workspace.steps.filter((item) => item.status === 'complete').length;
  return (
    <Card>
      <CardHeader
        title="Проверка перед запуском"
        description="Зелёный статус показывает только то, что подтверждено серверным состоянием."
        icon={<CheckCircle2 aria-hidden="true" />}
        action={
          <Badge tone={completed === workspace.steps.length ? 'success' : 'warning'}>
            {completed} из {workspace.steps.length}
          </Badge>
        }
      />
      <CardBody>
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
          {workspace.steps.map((item) => {
            const label = STEPS.find((step) => step.key === item.key)?.label ?? item.key;
            return (
              <li
                key={item.key}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-inset)] px-4 py-3"
              >
                <span className="font-medium">{label}</span>
                <Badge tone={item.status === 'complete' ? 'success' : 'warning'}>
                  {item.status === 'complete' ? 'Готово' : 'Нужно заполнить'}
                </Badge>
              </li>
            );
          })}
        </ul>
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-[var(--text-secondary)]">
          Завершение мастера пока не переводит пространство в реальный режим. Readiness-gate, TOTP и
          privacy/deletion остаются отдельными P0-задачами перед включением production-сценария.
        </p>
      </CardBody>
    </Card>
  );
}
