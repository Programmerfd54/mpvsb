'use client';

import { Route } from 'lucide-react';
import { use, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AdminScenarioVersion,
  AvailableMethodVersion,
  ContextField,
  Envelope,
  ReportingPolicy,
  ScenarioMethodBinding,
} from '@context/contracts';
import { validateScenarioStructure } from '@context/contracts';
import { CONTENT_VERSION_STATE_LABELS, type ContentVersionState } from '@context/domain';

import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import { Callout, ErrorState, ForbiddenState, PageSkeleton } from '@/components/ui/states';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery, useQueryClient } from '@/lib/query';
import { formatDateTime } from '@/lib/format';

import { STATUS_LABELS } from '../../_lib/labels';
import { ContextSchemaEditor } from './_components/context-schema-editor';
import { MethodsPicker, type SelectedMethod } from './_components/methods-picker';
import { ReportingEditor } from './_components/reporting-editor';

type Tab = 'context' | 'methods' | 'reporting';

const MODES = ['demo', 'research', 'validated_use'] as const;

const MODE_LABELS: Record<(typeof MODES)[number], string> = {
  demo: 'Демонстрация',
  research: 'Исследование',
  validated_use: 'Подтверждённое применение',
};

interface Draft {
  applicabilityMode: (typeof MODES)[number];
  fields: ContextField[];
  methods: SelectedMethod[];
  reportingPolicyId: string | null;
  participantVisibility: 'completion_receipt' | 'participant_summary';
}

/**
 * Редактор версии сценария.
 *
 * Версия закрепляет набор версий методик и схему контекста: назначение,
 * созданное по ней, всегда проходит те же тесты в том же порядке и считается по
 * тем же ключам. Правится только черновик; опубликованная версия открывается в
 * режиме чтения (ТЗ 01.4, 01.5).
 */
export default function AdminScenarioVersionPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = use(params);
  const queryClient = useQueryClient();

  const versionKey = useMemo(() => ['admin-scenario-version', versionId] as const, [versionId]);
  const policiesKey = ['admin-reporting-policies'] as const;
  const availableKey = ['admin-available-method-versions'] as const;

  const versionQuery = useApiQuery<Envelope<AdminScenarioVersion>>(
    versionKey,
    `/admin/scenario-versions/${versionId}`,
  );
  const version = versionQuery.data?.data ?? null;

  const policiesQuery = useApiQuery<Envelope<ReportingPolicy[]>>(
    policiesKey,
    '/admin/reporting-policies',
  );
  const policies = policiesQuery.data?.data ?? [];

  const availableQuery = useApiQuery<Envelope<AvailableMethodVersion[]>>(
    availableKey,
    '/admin/available-method-versions',
  );
  const available = availableQuery.data?.data ?? [];

  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<Tab>('context');
  const [publishOpen, setPublishOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const publishButtonRef = useRef<HTMLButtonElement>(null);
  const retireButtonRef = useRef<HTMLButtonElement>(null);

  // Черновик синхронизируется с сервером заново только когда содержимое или
  // статус версии действительно изменились — фоновое обновление кэша не
  // должно затирать несохранённые правки в форме.
  const syncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!version) {
      return;
    }
    const marker = `${version.versionId}:${version.contentHash ?? ''}:${version.status}`;
    if (syncedRef.current !== marker) {
      setDraft(toDraft(version));
      syncedRef.current = marker;
    }
  }, [version]);

  const saveMutation = useApiMutation<
    {
      applicabilityMode: Draft['applicabilityMode'];
      contextSchema: { fields: ContextField[] };
      methods: Array<{ methodVersionId: string; orderIndex: number; required: boolean }>;
      reportingPolicyId: string | null;
      participantVisibility: Draft['participantVisibility'];
      expectedContentHash: string | null;
    },
    Envelope<AdminScenarioVersion>
  >(
    (body) =>
      api.patch<Envelope<AdminScenarioVersion>>(`/admin/scenario-versions/${versionId}`, body),
    {
      onSuccess: (response) => {
        queryClient.setQueryData(versionKey, response);
        notify.success('Черновик сохранён');
      },
      onError: (cause) => {
        if (cause) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
          if (cause.code === 'REVISION_CONFLICT') {
            versionQuery.refetch();
          }
        }
      },
    },
  );

  const transitionMutation = useApiMutation<ContentVersionState, Envelope<AdminScenarioVersion>>(
    (status) =>
      api.post<Envelope<AdminScenarioVersion>>(`/admin/scenario-versions/${versionId}/transition`, {
        status,
      }),
    {
      onSuccess: (response, status) => {
        queryClient.setQueryData(versionKey, response);
        notify.success(`Версия переведена в состояние «${CONTENT_VERSION_STATE_LABELS[status]}»`);
        if (status === 'published') {
          setPublishOpen(false);
        }
        if (status === 'retired') {
          setRetireOpen(false);
        }
      },
      onError: (cause) => {
        if (cause) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        }
      },
    },
  );

  /**
   * Сведения о выбранной версии методики. Берутся из списка доступных, а при
   * его отсутствии — из уже сохранённого состава: версия могла быть снята
   * с публикации после сохранения черновика.
   */
  function describe(methodVersionId: string) {
    const known = available.find((item) => item.methodVersionId === methodVersionId);
    if (known) {
      return known;
    }
    const saved = version?.methods.find((item) => item.methodVersionId === methodVersionId);
    return saved ?? null;
  }

  // Замечания пересчитываются на лету: проблему видно до сохранения.
  const issues = useMemo(() => {
    if (!draft) {
      return [];
    }

    const bindings: ScenarioMethodBinding[] = draft.methods.map((item, index) => {
      const info = describe(item.methodVersionId);
      const saved = version?.methods.find(
        (method) => method.methodVersionId === item.methodVersionId,
      );
      return {
        // Идентификатор методики нужен, чтобы заметить две её версии в сценарии.
        methodId:
          (info && 'methodId' in info ? info.methodId : undefined) ??
          saved?.methodId ??
          item.methodVersionId,
        methodVersionId: item.methodVersionId,
        title: info?.title ?? 'Недоступная версия',
        semanticVersion: info?.semanticVersion ?? '—',
        status: info?.status ?? 'unknown',
        applicabilityMode:
          info && 'applicabilityMode' in info ? info.applicabilityMode : draft.applicabilityMode,
        orderIndex: index,
        required: item.required,
      };
    });

    const policy = policies.find((item) => item.id === draft.reportingPolicyId) ?? null;

    return validateScenarioStructure({
      contextSchema: { fields: draft.fields },
      methods: bindings,
      applicabilityMode: draft.applicabilityMode,
      hasReportingPolicy: draft.reportingPolicyId !== null,
      // Если политика ещё не загрузилась, о её содержимом не судим.
      requiredLimitationCount: policy
        ? policy.requiredLimitations.length
        : draft.reportingPolicyId === version?.reportingPolicyId
          ? (version?.reportingPolicy?.requiredLimitations.length ?? 1)
          : 1,
    });
  }, [draft, available, policies, version]);

  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  const dirty = useMemo(() => {
    if (!version || !draft) {
      return false;
    }
    return JSON.stringify(toDraft(version)) !== JSON.stringify(draft);
  }, [version, draft]);

  async function reloadPolicies(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: policiesKey });
  }

  if (versionQuery.error) {
    if (versionQuery.error.status === 403) {
      return <ForbiddenState />;
    }
    return (
      <ErrorState
        title={
          versionQuery.error.status === 404
            ? 'Версия сценария не найдена'
            : versionQuery.error.problem.title
        }
        description={
          versionQuery.error.status === 404
            ? 'Возможно, версия была удалена или ссылка устарела. Вернитесь к списку сценариев.'
            : undefined
        }
        requestId={versionQuery.error.problem.requestId}
        onRetry={versionQuery.error.status === 404 ? undefined : versionQuery.refetch}
        action={
          versionQuery.error.status === 404 ? (
            <ButtonLink href="/admin/scenarios" variant="secondary" size="sm">
              К списку сценариев
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }

  if (!version || !draft) {
    return <PageSkeleton variant="detail" label="Загружаем сценарий" />;
  }

  const readOnly = !version.editable;

  return (
    <>
      <PageHeader
        title={version.title}
        description={`${version.code} · версия ${version.semanticVersion}`}
        breadcrumbs={[
          { label: 'Сценарии', href: '/admin/scenarios' },
          { label: version.semanticVersion },
        ]}
        meta={
          <>
            <Badge tone={version.status === 'published' ? 'success' : 'neutral'}>
              {STATUS_LABELS[version.status] ?? version.status}
            </Badge>
            <Badge tone={draft.applicabilityMode === 'demo' ? 'info' : 'accent'}>
              {MODE_LABELS[draft.applicabilityMode]}
            </Badge>
            {readOnly ? <Badge tone="neutral">Только чтение</Badge> : null}
            {dirty ? <Badge tone="warning">Есть несохранённые изменения</Badge> : null}
            {version.publishedAt ? (
              <span className="text-xs text-[var(--text-secondary)]">
                Опубликована {formatDateTime(version.publishedAt)}
              </span>
            ) : null}
          </>
        }
        action={
          readOnly ? null : (
            <Button
              variant="primary"
              loading={saveMutation.isPending}
              disabled={!dirty || blockers.length > 0}
              disabledReason={
                blockers.length > 0
                  ? 'Сначала исправьте противоречия'
                  : !dirty
                    ? 'Изменений нет'
                    : undefined
              }
              onClick={() =>
                saveMutation.mutate({
                  applicabilityMode: draft.applicabilityMode,
                  contextSchema: { fields: draft.fields },
                  methods: draft.methods.map((item, index) => ({
                    methodVersionId: item.methodVersionId,
                    orderIndex: index,
                    required: item.required,
                  })),
                  reportingPolicyId: draft.reportingPolicyId,
                  participantVisibility: draft.participantVisibility,
                  expectedContentHash: version.contentHash,
                })
              }
            >
              Сохранить
            </Button>
          )
        }
      />

      {readOnly ? (
        <Callout tone="neutral" className="mb-5" role="note">
          Эта версия неизменяема. Чтобы внести правки, создайте новую версию на странице сценария —
          назначения, созданные по текущей, продолжат считаться по ней.
        </Callout>
      ) : null}

      {blockers.length > 0 ? (
        <Callout
          tone="danger"
          role="alert"
          title="Противоречия, мешающие сохранению"
          className="mb-5"
        >
          <ul className="flex list-none flex-col gap-1 p-0">
            {blockers.map((issue, index) => (
              <li key={index}>• {issue.message}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {warnings.length > 0 ? (
        <Callout tone="warning" role="status" title="Стоит проверить" className="mb-5">
          <ul className="flex list-none flex-col gap-1 p-0">
            {warnings.map((issue, index) => (
              <li key={index}>• {issue.message}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <Card className="mb-5">
        <CardHeader
          icon={<Route strokeWidth={1.75} />}
          title="Готовность версии"
          description="«Опубликована» означает доступность для назначения, а не доказанную пригодность методик."
        />
        <CardBody className="flex flex-col gap-4">
          {readOnly ? null : (
            <div className="max-w-sm">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-semibold text-[var(--text-primary)]">
                  Уровень применимости
                </span>
                <Select
                  value={draft.applicabilityMode}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      applicabilityMode: event.target.value as (typeof MODES)[number],
                    })
                  }
                >
                  {MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {MODE_LABELS[mode]}
                    </option>
                  ))}
                </Select>
              </label>
              <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                Уровень сценария не может быть выше уровня входящих в него методик.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {version.status === 'draft' ? (
              <Button
                variant="secondary"
                loading={transitionMutation.isPending}
                disabled={blockers.length > 0 || dirty}
                disabledReason={
                  dirty
                    ? 'Сначала сохраните изменения'
                    : blockers.length > 0
                      ? 'Есть противоречия'
                      : undefined
                }
                onClick={() => transitionMutation.mutate('review')}
              >
                Отправить на проверку
              </Button>
            ) : null}

            {version.status === 'review' ? (
              <>
                <Button
                  ref={publishButtonRef}
                  variant="primary"
                  disabled={blockers.length > 0}
                  disabledReason={blockers.length > 0 ? 'Есть противоречия' : undefined}
                  onClick={() => setPublishOpen(true)}
                >
                  Опубликовать
                </Button>
                <Button
                  variant="secondary"
                  loading={transitionMutation.isPending}
                  onClick={() => transitionMutation.mutate('draft')}
                >
                  Вернуть в черновик
                </Button>
              </>
            ) : null}

            {version.status === 'published' ? (
              <Button
                variant="secondary"
                loading={transitionMutation.isPending}
                onClick={() => transitionMutation.mutate('suspended_for_new_assignments')}
              >
                Остановить новые назначения
              </Button>
            ) : null}

            {version.status === 'suspended_for_new_assignments' ? (
              <Button
                ref={retireButtonRef}
                variant="destructive"
                onClick={() => setRetireOpen(true)}
              >
                Вывести из обращения
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as Tab)}
        label="Разделы сценария"
        items={[
          { value: 'context', label: 'Контекст решения', count: draft.fields.length },
          { value: 'methods', label: 'Методики', count: draft.methods.length },
          { value: 'reporting', label: 'Заключение' },
        ]}
      >
        <TabPanel value="context">
          <ContextSchemaEditor
            fields={draft.fields}
            disabled={readOnly}
            onChange={(fields) => setDraft({ ...draft, fields })}
          />
        </TabPanel>

        <TabPanel value="methods">
          {availableQuery.error ? (
            <Callout
              tone="danger"
              role="alert"
              title="Не удалось загрузить список методик"
              className="mb-4"
              action={
                <Button size="sm" variant="secondary" onClick={availableQuery.refetch}>
                  Повторить
                </Button>
              }
            >
              {availableQuery.error.problem.title}
            </Callout>
          ) : null}
          <MethodsPicker
            selected={draft.methods}
            available={available}
            describe={describe}
            disabled={readOnly}
            onChange={(methods) => setDraft({ ...draft, methods })}
          />
        </TabPanel>

        <TabPanel value="reporting">
          {policiesQuery.error ? (
            <Callout
              tone="danger"
              role="alert"
              title="Не удалось загрузить политики заключения"
              className="mb-4"
              action={
                <Button size="sm" variant="secondary" onClick={policiesQuery.refetch}>
                  Повторить
                </Button>
              }
            >
              {policiesQuery.error.problem.title}
            </Callout>
          ) : null}
          <ReportingEditor
            policies={policies}
            policyId={draft.reportingPolicyId}
            visibility={draft.participantVisibility}
            disabled={readOnly}
            onPolicyChange={(reportingPolicyId) => setDraft({ ...draft, reportingPolicyId })}
            onVisibilityChange={(participantVisibility) =>
              setDraft({ ...draft, participantVisibility })
            }
            onPoliciesReload={reloadPolicies}
          />
        </TabPanel>
      </Tabs>

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={`Опубликовать версию ${version.semanticVersion}?`}
        description="Опубликованная версия становится доступной для назначения. Изменить её содержимое будет нельзя — правки потребуют новой версии."
        consequences={[
          'Схема контекста, состав методик и правила заключения станут неизменяемыми.',
          'Версию можно будет назначать сотрудникам.',
          'Публикация проверяет, что все вложенные методики опубликованы и их уровень применимости не ниже уровня сценария.',
        ]}
        confirmLabel="Опубликовать"
        loading={transitionMutation.isPending}
        onConfirm={() => transitionMutation.mutate('published')}
        returnFocusRef={publishButtonRef}
      />

      <ConfirmDialog
        open={retireOpen}
        onOpenChange={setRetireOpen}
        title={`Вывести версию ${version.semanticVersion} из обращения?`}
        description="Снятая версия не может быть возвращена в обращение."
        consequences={[
          'Версия перестанет быть доступной для новых назначений.',
          'Уже выданные назначения, созданные по ней, не прерываются.',
        ]}
        confirmLabel="Вывести из обращения"
        destructive
        loading={transitionMutation.isPending}
        onConfirm={() => transitionMutation.mutate('retired')}
        returnFocusRef={retireButtonRef}
      />
    </>
  );
}

/** Состояние формы из сохранённой версии. Порядок методик задаёт сам список. */
function toDraft(version: AdminScenarioVersion): Draft {
  return {
    applicabilityMode: version.applicabilityMode,
    fields: version.contextSchema.fields.map((field) => ({ ...field })),
    methods: [...version.methods]
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((method) => ({ methodVersionId: method.methodVersionId, required: method.required })),
    reportingPolicyId: version.reportingPolicyId,
    participantVisibility: version.participantVisibility,
  };
}
