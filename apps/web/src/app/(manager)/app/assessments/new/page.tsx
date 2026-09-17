'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';

import type {
  ContextValues,
  CreateAssignmentsResult,
  EmployeeSummary,
  Envelope,
  PublicScenario,
} from '@context/contracts';
import { validateContextValues } from '@context/contracts';
import { INVITATION_DEFAULT_DAYS, INVITATION_MAX_DAYS, INVITATION_MIN_DAYS } from '@context/domain';

import { EmployeePicker } from '@/components/employees/employee-picker';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CharacterCount, Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { KeyValueList } from '@/components/ui/data-list';
import { DateField } from '@/components/ui/date-field';
import { Stepper } from '@/components/ui/progress';
import { Callout, ErrorState, ForbiddenState, PageSkeleton } from '@/components/ui/states';
import { cx } from '@/components/ui/tint';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/manager-shell';
import { ApiError, api } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';

const STEPS = [
  { label: 'Вопрос' },
  { label: 'Контекст' },
  { label: 'Сотрудники и срок' },
  { label: 'Проверка' },
] as const;

export default function NewAssessmentPage() {
  const session = useSession();
  const organizationId = session.organization?.organizationId;
  const canManage = session.has('assessments.manage');

  const [step, setStep] = useState(1);
  const [scenarios, setScenarios] = useState<PublicScenario[] | null>(null);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [context, setContext] = useState<ContextValues>({});
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [dueDays, setDueDays] = useState(INVITATION_DEFAULT_DAYS);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CreateAssignmentsResult | null>(null);

  useEffect(() => {
    if (!organizationId || !canManage) {
      return;
    }
    const controller = new AbortController();
    void api
      .get<Envelope<PublicScenario[]>>(`/orgs/${organizationId}/scenarios`, controller.signal)
      .then((scenarioResponse) => {
        if (!controller.signal.aborted) setScenarios(scenarioResponse.data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof ApiError ? cause : null);
        }
      });
    return () => controller.abort();
  }, [organizationId, canManage]);

  const scenario = useMemo(
    () => scenarios?.find((item) => item.scenarioVersionId === scenarioId) ?? null,
    [scenarios, scenarioId],
  );

  // Незавершённая работа предупреждает при закрытии/обновлении вкладки:
  // черновик пока не сохраняется на сервере (см. отчёт о редизайне).
  const dirty =
    !result &&
    (Boolean(scenarioId) ||
      selected.length > 0 ||
      Object.values(context).some((value) => String(value ?? '').trim() !== ''));

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function validateContextStep(): boolean {
    if (!scenario) {
      return false;
    }
    const errors = validateContextValues(scenario.contextSchema, context);
    const mapped: Record<string, string> = {};
    for (const item of errors) {
      mapped[item.field.replace('context.', '')] = item.message;
    }
    setFieldErrors(mapped);
    return errors.length === 0;
  }

  async function submit(): Promise<void> {
    if (!organizationId || !scenario) {
      return;
    }
    setPending(true);
    setError(null);

    try {
      const response = await api.post<Envelope<CreateAssignmentsResult>>(
        `/orgs/${organizationId}/assignments/batch`,
        {
          scenarioVersionId: scenario.scenarioVersionId,
          employeeIds: selected,
          context,
          dueDays,
          duplicatePolicy: 'reject',
        },
      );
      setResult(response.data);
      notify.success(
        `Создано ${formatCount(response.data.created.length, 'назначение', 'назначения', 'назначений')}`,
      );
    } catch (cause) {
      const apiError = cause instanceof ApiError ? cause : null;
      setError(apiError);
      if (apiError) {
        notify.error(apiError.problem.title, { requestId: apiError.problem.requestId });
      }
    } finally {
      setPending(false);
    }
  }

  if (session.status === 'authenticated' && !canManage) {
    return (
      <>
        <PageHeader
          title="Назначить оценку"
          breadcrumbs={[{ label: 'Оценки', href: '/app/assessments' }, { label: 'Новая оценка' }]}
        />
        <ForbiddenState description="Создание оценок доступно по разрешению «Создание и отзыв оценок». Обратитесь к владельцу организации." />
      </>
    );
  }

  if (error && !scenarios) {
    return (
      <ErrorState
        title="Не удалось загрузить данные"
        requestId={error.problem.requestId}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!scenarios) {
    return <PageSkeleton variant="form" label="Загружаем сценарии" />;
  }

  if (result) {
    return <IssuedLinks organizationId={organizationId!} result={result} />;
  }

  return (
    <>
      <PageHeader
        title="Назначить оценку"
        description="Четыре шага: вопрос, контекст решения, сотрудники и проверка."
        breadcrumbs={[{ label: 'Оценки', href: '/app/assessments' }, { label: 'Новая оценка' }]}
      />

      <div className="mb-6">
        <Stepper
          steps={STEPS.map((item) => ({ label: item.label }))}
          current={step - 1}
          onStepClick={(index) => setStep(index + 1)}
          label="Шаги создания оценки"
        />
      </div>

      {step === 1 ? (
        <StepScenario
          scenarios={scenarios}
          selectedId={scenarioId}
          onSelect={(id) => {
            setScenarioId(id);
            setContext({});
            setFieldErrors({});
          }}
        />
      ) : null}

      {step === 2 && scenario ? (
        <StepContext
          scenario={scenario}
          values={context}
          errors={fieldErrors}
          onChange={(key, value) => {
            setContext((prev) => ({ ...prev, [key]: value }));
            setFieldErrors((prev) => {
              if (!(key in prev)) {
                return prev;
              }
              const next = { ...prev };
              delete next[key];
              return next;
            });
          }}
        />
      ) : null}

      {step === 3 && scenario ? (
        <StepEmployees
          organizationId={organizationId}
          employees={employees}
          selected={selected}
          onToggle={(employee) => {
            setEmployees((prev) =>
              prev.some((item) => item.id === employee.id) ? prev : [...prev, employee],
            );
            setSelected((prev) =>
              prev.includes(employee.id)
                ? prev.filter((id) => id !== employee.id)
                : prev.length < 50
                  ? [...prev, employee.id]
                  : prev,
            );
          }}
          dueDays={dueDays}
          onDueDaysChange={setDueDays}
        />
      ) : null}

      {step === 4 && scenario ? (
        <StepReview
          scenario={scenario}
          context={context}
          employees={employees.filter((item) => selected.includes(item.id))}
          dueDays={dueDays}
          error={error}
        />
      ) : null}

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-app)] py-4">
        <Button
          variant="ghost"
          onClick={() => setStep((value) => Math.max(1, value - 1))}
          disabled={step === 1}
        >
          Назад
        </Button>

        <div className="flex flex-wrap gap-3">
          {step < 4 ? (
            <Button
              variant="primary"
              disabled={
                (step === 1 && (!scenario || !scenario.availability.canAssign)) ||
                (step === 3 &&
                  (selected.length === 0 ||
                    selected.length > 50 ||
                    !Number.isInteger(dueDays) ||
                    dueDays < INVITATION_MIN_DAYS ||
                    dueDays > INVITATION_MAX_DAYS))
              }
              disabledReason={
                step === 1 && scenario && !scenario.availability.canAssign
                  ? scenario.availability.blockedReasons[0]
                  : step === 3 && selected.length === 0
                    ? 'Выберите хотя бы одного сотрудника'
                    : step === 3 && selected.length > 50
                      ? 'Выбрано больше 50 сотрудников — разбейте на несколько назначений'
                      : step === 3 &&
                          (!Number.isInteger(dueDays) ||
                            dueDays < INVITATION_MIN_DAYS ||
                            dueDays > INVITATION_MAX_DAYS)
                        ? `Укажите срок от ${INVITATION_MIN_DAYS} до ${INVITATION_MAX_DAYS} дней`
                        : undefined
              }
              onClick={() => {
                if (step === 2 && !validateContextStep()) {
                  return;
                }
                setStep((value) => value + 1);
              }}
            >
              Дальше
            </Button>
          ) : (
            <Button variant="primary" loading={pending} onClick={() => void submit()}>
              Создать назначения
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function StepScenario({
  scenarios,
  selectedId,
  onSelect,
}: {
  scenarios: readonly PublicScenario[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-3 text-base font-semibold">Какой вопрос вы решаете?</legend>
      <div className="grid gap-4 lg:grid-cols-3">
        {scenarios.map((scenario) => {
          const checked = scenario.scenarioVersionId === selectedId;
          const expanded = expandedId === scenario.scenarioVersionId;
          const totalItems = scenario.methods.reduce((sum, method) => sum + method.itemCount, 0);

          return (
            <div
              key={scenario.scenarioVersionId}
              className={cx(
                'flex flex-col gap-3 rounded-[var(--radius-card)] border bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)] transition-shadow duration-[var(--motion-fast)]',
                checked
                  ? 'border-[var(--accent)] shadow-[var(--shadow-raised)]'
                  : 'border-[var(--border-subtle)]',
              )}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="scenario"
                  value={scenario.scenarioVersionId}
                  checked={checked}
                  onChange={() => onSelect(scenario.scenarioVersionId)}
                  className="mt-1 h-5 w-5 accent-[var(--accent)]"
                />
                <span className="flex flex-col gap-1">
                  <span className="text-base font-semibold">{scenario.title}</span>
                  <span className="text-sm text-[var(--text-secondary)]">{scenario.purpose}</span>
                </span>
              </label>

              <p className="text-xs text-[var(--text-secondary)]">
                Методик: {scenario.methods.length} · вопросов: {totalItems}
              </p>

              {scenario.availability.canAssign ? null : (
                <Callout tone="danger" title="Недоступно для назначения">
                  <ul className="m-0 list-disc pl-4">
                    {scenario.availability.blockedReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </Callout>
              )}

              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : scenario.scenarioVersionId)}
                className="self-start text-sm font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline"
              >
                {expanded ? 'Скрыть подробности' : 'Подробнее'}
              </button>

              {expanded ? (
                <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-3">
                  <Callout tone="warning">{scenario.limits}</Callout>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {scenario.methods.map((method) => (
                      <li
                        key={method.methodVersionId}
                        className="text-xs text-[var(--text-secondary)]"
                      >
                        <span className="font-medium text-[var(--text-primary)]">
                          {method.title}
                        </span>
                        {' · '}
                        {method.itemCount} вопросов
                        {method.limitations.length > 0 ? ` · ${method.limitations.join('; ')}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function StepContext({
  scenario,
  values,
  errors,
  onChange,
}: {
  scenario: PublicScenario;
  values: ContextValues;
  errors: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Контекст решения"
        description="Чем конкретнее описание, тем точнее заключение сможет опереться на факты."
      />
      <CardBody className="flex flex-col gap-5">
        {scenario.contextSchema.fields.map((field) => {
          const value = String(values[field.key] ?? '');
          const isLong = field.type === 'textarea';

          return (
            <Field
              key={field.key}
              label={field.label}
              hint={field.hint}
              required={field.required}
              error={errors[field.key]}
            >
              {({ inputId, describedBy }) => (
                <div className="flex flex-col gap-1">
                  {field.type === 'select' ? (
                    <Select
                      id={inputId}
                      aria-describedby={describedBy}
                      value={value}
                      onChange={(event) => onChange(field.key, event.target.value)}
                      invalid={Boolean(errors[field.key])}
                    >
                      <option value="">Не выбрано</option>
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : isLong ? (
                    <TextArea
                      id={inputId}
                      aria-describedby={describedBy}
                      value={value}
                      maxLength={field.maxLength}
                      onChange={(event) => onChange(field.key, event.target.value)}
                      invalid={Boolean(errors[field.key])}
                    />
                  ) : field.type === 'date' ? (
                    <DateField
                      id={inputId}
                      aria-describedby={describedBy}
                      value={value}
                      onChange={(next) => onChange(field.key, next)}
                      invalid={Boolean(errors[field.key])}
                    />
                  ) : (
                    <TextInput
                      id={inputId}
                      aria-describedby={describedBy}
                      type={field.type === 'money' || field.type === 'number' ? 'number' : 'text'}
                      value={value}
                      maxLength={field.maxLength}
                      onChange={(event) => onChange(field.key, event.target.value)}
                      invalid={Boolean(errors[field.key])}
                    />
                  )}

                  {isLong && field.maxLength ? (
                    <CharacterCount value={value} max={field.maxLength} />
                  ) : null}

                  {field.isOpinion ? (
                    <p className="text-xs text-[var(--text-secondary)]">
                      В заключении это будет помечено как ваше мнение, а не как проверенный факт.
                    </p>
                  ) : null}
                </div>
              )}
            </Field>
          );
        })}
      </CardBody>
    </Card>
  );
}

function StepEmployees({
  organizationId,
  employees,
  selected,
  onToggle,
  dueDays,
  onDueDaysChange,
}: {
  employees: readonly EmployeeSummary[];
  selected: readonly string[];
  organizationId: string | undefined;
  onToggle: (employee: EmployeeSummary) => void;
  dueDays: number;
  onDueDaysChange: (value: number) => void;
}) {
  const expiresAt = new Date(Date.now() + dueDays * 86_400_000);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const duplicates = employees.filter(
    (employee) => selected.includes(employee.id) && employee.activeAssignments > 0,
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader
          title="Кому назначаем"
          description={`Выбрано: ${selected.length} из 50 возможных. Каждому создаётся отдельное назначение со своей ссылкой.`}
        />
        <CardBody className="flex flex-col gap-3">
          <EmployeePicker
            organizationId={organizationId}
            selected={selected}
            onToggle={onToggle}
            multiple
          />
          {selected.length ? (
            <details className="rounded-xl bg-[var(--accent-soft)] px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium">
                Выбранные сотрудники · {selected.length}
              </summary>
              <ul className="mt-2 flex list-none flex-col gap-1 p-0">
                {employees
                  .filter((item) => selected.includes(item.id))
                  .map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>{item.displayName ?? item.externalCode}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Убрать ${item.displayName ?? item.externalCode}`}
                        onClick={() => onToggle(item)}
                      >
                        Убрать
                      </Button>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}

          {duplicates.length > 0 ? (
            <Callout tone="warning" title="У выбранных сотрудников есть активные оценки">
              У{' '}
              {formatCount(
                duplicates.length,
                'выбранного сотрудника',
                'выбранных сотрудников',
                'выбранных сотрудников',
              )}{' '}
              уже есть активные оценки. При создании система проверит совпадение сценария и
              пропустит дублирующиеся назначения; остальные будут созданы.
            </Callout>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Срок участия" />
        <CardBody className="flex flex-col gap-4">
          <Field
            label="Сколько дней действует ссылка"
            hint={`От ${INVITATION_MIN_DAYS} до ${INVITATION_MAX_DAYS} дней.`}
          >
            {({ inputId }) => (
              <TextInput
                id={inputId}
                type="number"
                min={INVITATION_MIN_DAYS}
                max={INVITATION_MAX_DAYS}
                value={dueDays}
                onChange={(event) => onDueDaysChange(Number(event.target.value))}
              />
            )}
          </Field>
          <p className="text-sm text-[var(--text-secondary)]">
            Ссылка перестанет работать{' '}
            {expiresAt.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })} (
            {timezone}).
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            Ссылку вы передаёте сотруднику сами: платформа не отправляет сообщения от вашего имени.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function StepReview({
  scenario,
  context,
  employees,
  dueDays,
  error,
}: {
  scenario: PublicScenario;
  context: ContextValues;
  employees: readonly EmployeeSummary[];
  dueDays: number;
  error: ApiError | null;
}) {
  const contextItems = scenario.contextSchema.fields
    .filter((field) => String(context[field.key] ?? '').trim() !== '')
    .map((field) => ({
      label: field.isOpinion ? `${field.label} · мнение руководителя` : field.label,
      value:
        field.type === 'date' ? formatDate(String(context[field.key])) : String(context[field.key]),
    }));

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <ErrorState
          title={error.problem.title}
          description={
            error.problem.fieldErrors.map((item) => item.message).join('; ') || undefined
          }
          requestId={error.problem.requestId}
        />
      ) : null}

      <Card>
        <CardHeader title="Проверьте перед созданием" />
        <CardBody className="flex flex-col gap-4">
          <KeyValueList
            columns={1}
            items={[
              { label: 'Вопрос', value: `${scenario.title} · версия ${scenario.semanticVersion}` },
              {
                label: 'Методики',
                value: scenario.methods.map((method) => method.title).join(', '),
              },
              {
                label: 'Сотрудники',
                value: employees.map((item) => item.displayName ?? item.externalCode).join(', '),
              },
              { label: 'Срок ссылки', value: `${dueDays} дн.` },
            ]}
          />

          {contextItems.length > 0 ? (
            <div>
              <p className="text-sm font-medium">Контекст решения</p>
              <div className="mt-2">
                <KeyValueList columns={1} items={contextItems} />
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Callout tone="info" title="Что увидит сотрудник">
        <p className="m-0">Название организации, нейтральное название оценки и список тестов.</p>
        <p className="m-0 mt-1">
          Условия участия с объяснением, кто увидит результат и какие у него есть возможности.
        </p>
        <p className="m-0 mt-1">
          {scenario.participantVisibility === 'participant_summary'
            ? 'После проверки — согласованная краткая обратная связь.'
            : 'Подтверждение участия. Развёрнутое заключение предназначено руководителю.'}
        </p>
      </Callout>
    </div>
  );
}

/** Ссылки выдаются один раз: повторно получить их нельзя, только выпустить новые. */
function IssuedLinks({
  organizationId,
  result,
}: {
  organizationId: string;
  result: CreateAssignmentsResult;
}) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [issuing, setIssuing] = useState<string | null>(null);

  async function issue(assignmentId: string): Promise<void> {
    setIssuing(assignmentId);
    try {
      const response = await api.post<Envelope<{ url: string }>>(
        `/orgs/${organizationId}/assignments/${assignmentId}/invitations`,
      );
      setLinks((prev) => ({ ...prev, [assignmentId]: response.data.url }));
      notify.success('Ссылка выпущена');
    } catch (cause) {
      if (cause instanceof ApiError) {
        notify.error(cause.problem.title, { requestId: cause.problem.requestId });
      }
    } finally {
      setIssuing(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Назначения созданы"
        description="Выпустите персональную ссылку и передайте её сотруднику любым принятым у вас способом."
      />

      {result.rejected.length > 0 ? (
        <Callout tone="warning" title="Часть сотрудников пропущена" className="mb-5">
          <ul className="m-0 list-disc pl-4">
            {result.rejected.map((item) => (
              <li key={item.employeeId}>
                {item.employeeLabel} — {item.reason}
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <Card>
        <CardHeader
          title="Персональные ссылки"
          description="Открытое значение ссылки показывается один раз. После закрытия страницы восстановить его нельзя — можно только выпустить новую ссылку, отозвав прежнюю."
        />
        <CardBody>
          <ul className="flex list-none flex-col gap-4 p-0">
            {result.created.map((item) => (
              <li
                key={item.assignmentId}
                className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-medium">{item.employeeLabel}</span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={issuing === item.assignmentId}
                      onClick={() => void issue(item.assignmentId)}
                    >
                      {links[item.assignmentId] ? 'Выпустить новую' : 'Выпустить ссылку'}
                    </Button>
                    <ButtonLink
                      size="sm"
                      variant="secondary"
                      href={`/app/assessments/${item.assignmentId}`}
                    >
                      Открыть оценку
                    </ButtonLink>
                  </div>
                </div>

                {links[item.assignmentId] ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-control)] bg-[var(--bg-inset)] p-2 text-xs">
                      {links[item.assignmentId]}
                    </code>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Copy aria-hidden="true" />}
                      onClick={() => {
                        void navigator.clipboard.writeText(links[item.assignmentId]!);
                        notify.success('Ссылка скопирована');
                      }}
                    >
                      Скопировать
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
