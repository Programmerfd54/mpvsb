'use client';

import {
  Calculator,
  ClipboardCheck,
  FileJson,
  FlaskConical,
  IdCard,
  ListChecks,
  PlusCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type {
  AdminMethodVersion,
  Envelope,
  MethodCheckResult,
  MethodDraftContent,
  MethodImportPreview,
} from '@context/contracts';
import { validateMethodStructure } from '@context/contracts';
import { APPLICABILITY_MODE_LABELS, type ContentVersionState } from '@context/domain';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, DetailDrawer } from '@/components/ui/dialog';
import { Field, TextArea, TextInput } from '@/components/ui/field';
import { Tabs, TabPanel, type TabItem } from '@/components/ui/tabs';
import { Callout, ErrorState, ForbiddenState, PageSkeleton } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { formatDateTime } from '@/lib/format';

import { STATUS_LABELS } from '../../_lib/labels';
import { FixturesEditor } from './_components/fixtures-editor';
import { ItemsEditor } from './_components/items-editor';
import { PassportEditor } from './_components/passport-editor';
import { ScoringEditor } from './_components/scoring-editor';

type Tab = 'passport' | 'items' | 'scoring' | 'fixtures' | 'import';

const METHODS_LIST_KEY = ['admin-methods'] as const;

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  review: 'warning',
  published: 'success',
  suspended_for_new_assignments: 'warning',
  retired: 'danger',
};

function versionKey(versionId: string) {
  return ['admin-method-version', versionId] as const;
}

/**
 * Переход версии в новое состояние.
 *
 * Отдельный хук на каждую кнопку перехода (а не один параметризованный) —
 * чтобы у «Отправить на проверку», «Опубликовать» и «Вернуть в черновик»
 * были независимые индикаторы загрузки (ТЗ «Что сделать»): без этого клик по
 * одной кнопке показывал бы `loading` и на соседних.
 */
function useMethodVersionTransition(
  versionId: string,
  status: ContentVersionState,
  successMessage: string,
  onApplied: (version: AdminMethodVersion) => void,
) {
  return useApiMutation<void, Envelope<AdminMethodVersion>>(
    () =>
      api.post<Envelope<AdminMethodVersion>>(`/admin/method-versions/${versionId}/transition`, {
        status,
      }),
    {
      invalidate: [METHODS_LIST_KEY, versionKey(versionId)],
      onSuccess: (result) => {
        onApplied(result.data);
        notify.success(successMessage);
      },
      onError: (cause) => {
        if (cause) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        }
      },
    },
  );
}

/** Редактируемая часть версии из ответа сервера. */
function toDraftContent(version: AdminMethodVersion): MethodDraftContent {
  return {
    applicabilityMode: version.applicabilityMode,
    passport: version.passport,
    items: version.items,
    scoring: version.scoring,
    fixtures: version.fixtures,
  };
}

/**
 * Редактор версии методики.
 *
 * Правится только черновик. Опубликованная версия открывается в режиме чтения:
 * чтобы что-то изменить, создаётся новая версия, а старые назначения продолжают
 * считаться по прежней (ТЗ 01.5).
 *
 * Локальный `draft` — редактируемая копия сервера. Он берётся из ответа один
 * раз при заходе на версию (и заново — из ответа каждой мутации): фоновое
 * обновление кэша запросов не должно стирать несохранённые правки прямо во
 * время редактирования.
 */
export default function MethodVersionPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const router = useRouter();

  const query = useApiQuery<Envelope<AdminMethodVersion>>(
    versionKey(versionId),
    `/admin/method-versions/${versionId}`,
  );

  const [version, setVersion] = useState<AdminMethodVersion | null>(null);
  const [draft, setDraft] = useState<MethodDraftContent | null>(null);
  const [loadedVersionId, setLoadedVersionId] = useState<string | null>(null);
  const [resyncPending, setResyncPending] = useState(false);

  useEffect(() => {
    if (query.data && (loadedVersionId !== versionId || resyncPending)) {
      setVersion(query.data.data);
      setDraft(toDraftContent(query.data.data));
      setLoadedVersionId(versionId);
      setResyncPending(false);
    }
  }, [query.data, versionId, loadedVersionId, resyncPending]);

  const [tab, setTab] = useState<Tab>('passport');
  const [check, setCheck] = useState<MethodCheckResult | null>(null);
  const [importText, setImportText] = useState('');

  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const publishTriggerRef = useRef<HTMLButtonElement>(null);
  const [newVersionOpen, setNewVersionOpen] = useState(false);
  const newVersionTriggerRef = useRef<HTMLButtonElement>(null);

  function applyServerVersion(next: AdminMethodVersion): void {
    setVersion(next);
    setDraft(toDraftContent(next));
    setCheck(null);
  }

  const save = useApiMutation<void, Envelope<AdminMethodVersion>>(
    () => {
      if (!draft || !version) {
        return Promise.reject(new Error('Черновик ещё не загружен'));
      }
      return api.patch<Envelope<AdminMethodVersion>>(`/admin/method-versions/${versionId}`, {
        ...draft,
        expectedContentHash: version.contentHash,
      });
    },
    {
      invalidate: [METHODS_LIST_KEY, versionKey(versionId)],
      onSuccess: (result) => {
        applyServerVersion(result.data);
        notify.success('Черновик сохранён');
      },
      onError: (cause) => {
        if (!cause) {
          return;
        }
        notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        if (cause.code === 'REVISION_CONFLICT') {
          setResyncPending(true);
          query.refetch();
        }
      },
    },
  );

  const runCheck = useApiMutation<void, Envelope<MethodCheckResult>>(
    () => api.post<Envelope<MethodCheckResult>>(`/admin/method-versions/${versionId}/check`),
    {
      onSuccess: (result) => {
        setCheck(result.data);
        notify[result.data.ok ? 'success' : 'error'](
          result.data.ok ? 'Контрольные примеры сошлись' : 'Есть расхождения',
        );
      },
      onError: (cause) => {
        if (cause) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        }
      },
    },
  );

  const submitForReview = useMethodVersionTransition(
    versionId,
    'review',
    'Версия отправлена на проверку',
    applyServerVersion,
  );
  const returnToDraft = useMethodVersionTransition(
    versionId,
    'draft',
    'Версия возвращена в черновик',
    applyServerVersion,
  );
  // Публикация дополнительно закрывает диалог подтверждения по успеху.
  const publish = useMethodVersionTransition(
    versionId,
    'published',
    'Версия опубликована',
    (next) => {
      applyServerVersion(next);
      setPublishConfirmOpen(false);
    },
  );

  const importPreview = useApiMutation<unknown, Envelope<MethodImportPreview>>(
    (payload) =>
      api.post<Envelope<MethodImportPreview>>('/admin/method-versions/import-preview', payload),
    {
      onError: (cause) => {
        if (cause) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        }
      },
    },
  );

  function runImportPreview(): void {
    let payload: unknown;
    try {
      payload = JSON.parse(importText);
    } catch {
      notify.error('Это не похоже на корректный JSON. Проверьте текст.');
      return;
    }
    importPreview.mutate(payload);
  }

  // Замечания пересчитываются на лету: проблему видно до сохранения.
  const issues = useMemo(
    () => (draft ? validateMethodStructure(draft.items, draft.scoring) : []),
    [draft],
  );
  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  const dirty = useMemo(() => {
    if (!version || !draft) {
      return false;
    }
    return JSON.stringify(toDraftContent(version)) !== JSON.stringify(draft);
  }, [version, draft]);

  if (query.error) {
    if (query.error.status === 403) {
      return <ForbiddenState />;
    }
    return (
      <ErrorState
        title="Не удалось загрузить версию методики"
        description="Проверьте подключение и попробуйте ещё раз."
        requestId={query.error.problem.requestId}
        onRetry={query.refetch}
      />
    );
  }

  if (!version || !draft) {
    return <PageSkeleton variant="detail" label="Загружаем версию методики" />;
  }

  const readOnly = !version.editable;

  const tabItems: TabItem[] = [
    { value: 'passport', label: 'Паспорт', icon: <IdCard aria-hidden="true" strokeWidth={1.75} /> },
    {
      value: 'items',
      label: 'Вопросы',
      count: draft.items.length,
      icon: <ListChecks aria-hidden="true" strokeWidth={1.75} />,
    },
    {
      value: 'scoring',
      label: 'Подсчёт',
      icon: <Calculator aria-hidden="true" strokeWidth={1.75} />,
    },
    {
      value: 'fixtures',
      label: 'Контрольные примеры',
      count: draft.fixtures.length,
      icon: <FlaskConical aria-hidden="true" strokeWidth={1.75} />,
    },
    { value: 'import', label: 'Импорт', icon: <FileJson aria-hidden="true" strokeWidth={1.75} /> },
  ];

  return (
    <>
      <PageHeader
        title={draft.passport.title || version.code}
        description={`${version.code} · версия ${version.semanticVersion}`}
        breadcrumbs={[
          { label: 'Методики', href: '/admin/methods' },
          { label: version.semanticVersion },
        ]}
        meta={
          <>
            <Badge tone={STATUS_TONE[version.status] ?? 'neutral'}>
              {STATUS_LABELS[version.status] ?? version.status}
            </Badge>
            <Badge tone={version.applicabilityMode === 'demo' ? 'info' : 'accent'}>
              {APPLICABILITY_MODE_LABELS[version.applicabilityMode]}
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
      />

      {/*
        Sticky-панель действий: держится под шапкой оболочки при прокрутке
        длинного списка вопросов, чтобы «Сохранить» не приходилось искать
        каждый раз (ТЗ «Что сделать» — toolbar sticky).
      */}
      <div className="sticky top-[var(--topbar-height)] z-20 -mx-4 mb-6 flex flex-wrap items-center gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-app)]/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg-app)]/85 sm:-mx-8 sm:px-8">
        {readOnly ? (
          <Button
            ref={newVersionTriggerRef}
            variant="primary"
            icon={<PlusCircle aria-hidden="true" strokeWidth={1.75} />}
            onClick={() => setNewVersionOpen(true)}
          >
            Создать новую версию
          </Button>
        ) : (
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!dirty || blockers.length > 0}
            disabledReason={
              blockers.length > 0
                ? 'Сначала исправьте противоречия'
                : !dirty
                  ? 'Изменений нет'
                  : undefined
            }
            onClick={() => save.mutate()}
          >
            Сохранить черновик
          </Button>
        )}

        <Button variant="secondary" loading={runCheck.isPending} onClick={() => runCheck.mutate()}>
          Проверить конфигурацию
        </Button>

        {check && version.status === 'draft' ? (
          <Button
            variant="secondary"
            loading={submitForReview.isPending}
            disabled={!check.ok || dirty}
            disabledReason={
              dirty ? 'Сначала сохраните изменения' : !check.ok ? 'Есть блокировки' : undefined
            }
            onClick={() => submitForReview.mutate()}
          >
            Отправить на проверку
          </Button>
        ) : null}

        {check && version.status === 'review' ? (
          <>
            <Button
              ref={publishTriggerRef}
              variant="primary"
              loading={publish.isPending}
              disabled={!check.ok}
              disabledReason={!check.ok ? 'Есть блокировки' : undefined}
              onClick={() => setPublishConfirmOpen(true)}
            >
              Опубликовать
            </Button>
            <Button
              variant="secondary"
              loading={returnToDraft.isPending}
              onClick={() => returnToDraft.mutate()}
            >
              Вернуть в черновик
            </Button>
          </>
        ) : null}
      </div>

      {readOnly ? (
        <Callout tone="info" title="Эта версия неизменяема" className="mb-5">
          Чтобы внести правки, создайте новую версию — назначения, созданные по текущей, продолжат
          считаться по ней.
        </Callout>
      ) : null}

      {blockers.length > 0 ? (
        <Callout
          tone="danger"
          title="Противоречия, мешающие сохранению"
          role="alert"
          className="mb-5"
        >
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {blockers.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {warnings.length > 0 ? (
        <Callout tone="warning" title="Стоит проверить" className="mb-5">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {warnings.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {check ? (
        <Callout
          tone={check.ok ? 'success' : 'danger'}
          title={check.ok ? 'Готово к публикации' : 'Публикация невозможна'}
          role={check.ok ? 'status' : 'alert'}
          className="mb-5"
        >
          <p className="m-0">
            Проверяется, что заявленные ключи дают заявленные значения. Значимость методики этим не
            подтверждается.
          </p>
          {check.blockers.length > 0 ? (
            <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
              {check.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
        </Callout>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        items={tabItems}
        label="Разделы методики"
      >
        <TabPanel value="passport">
          <PassportEditor
            value={draft.passport}
            disabled={readOnly}
            onChange={(passport) => setDraft({ ...draft, passport })}
          />
        </TabPanel>

        <TabPanel value="items">
          <ItemsEditor
            items={draft.items}
            disabled={readOnly}
            onChange={(items) => setDraft({ ...draft, items })}
          />
        </TabPanel>

        <TabPanel value="scoring">
          <ScoringEditor
            scoring={draft.scoring}
            items={draft.items}
            disabled={readOnly}
            onChange={(scoring) => setDraft({ ...draft, scoring })}
          />
        </TabPanel>

        <TabPanel value="fixtures">
          <FixturesEditor
            fixtures={draft.fixtures}
            scaleIds={draft.scoring.scales.map((scale) => scale.id)}
            result={check}
            disabled={readOnly}
            onChange={(fixtures) => setDraft({ ...draft, fixtures })}
          />
        </TabPanel>

        <TabPanel value="import">
          <Card>
            <CardHeader
              icon={<ClipboardCheck aria-hidden="true" strokeWidth={1.75} />}
              title="Импорт содержимого"
              description="Разбор выполняется без записи: сначала вы видите, что будет импортировано и какие есть проблемы."
            />
            <CardBody className="flex flex-col gap-4">
              <Field label="JSON содержимого методики">
                {({ inputId }) => (
                  <TextArea
                    id={inputId}
                    rows={10}
                    className="font-mono text-xs"
                    placeholder='{ "applicabilityMode": "demo", "passport": { … }, "items": [ … ], "scoring": { … }, "fixtures": [ … ] }'
                    value={importText}
                    onChange={(event) => setImportText(event.target.value)}
                  />
                )}
              </Field>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  loading={importPreview.isPending}
                  disabled={importText.trim().length === 0}
                  onClick={runImportPreview}
                >
                  Разобрать
                </Button>

                {importPreview.data?.data.accepted && !readOnly ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      try {
                        setDraft(JSON.parse(importText) as MethodDraftContent);
                        setTab('passport');
                        notify.info('Содержимое подставлено. Проверьте и сохраните.');
                      } catch {
                        notify.error('Не удалось разобрать JSON.');
                      }
                    }}
                  >
                    Подставить в черновик
                  </Button>
                ) : null}
              </div>

              {importPreview.data ? <PreviewSummary preview={importPreview.data.data} /> : null}
            </CardBody>
          </Card>
        </TabPanel>
      </Tabs>

      <ConfirmDialog
        open={publishConfirmOpen}
        onOpenChange={setPublishConfirmOpen}
        title="Опубликовать версию?"
        description={`Версия ${version.semanticVersion} станет доступна для назначения и её содержимое больше нельзя будет изменить.`}
        consequences={[
          'Содержимое версии станет неизменяемым.',
          'Чтобы что-то поправить позже, придётся создать новую версию.',
        ]}
        confirmLabel="Опубликовать"
        loading={publish.isPending}
        onConfirm={() => publish.mutate()}
        returnFocusRef={publishTriggerRef}
      />

      <NewVersionDialog
        open={newVersionOpen}
        onOpenChange={setNewVersionOpen}
        version={version}
        returnFocusRef={newVersionTriggerRef}
        onCreated={(nextVersionId) => {
          setNewVersionOpen(false);
          router.push(`/admin/methods/${nextVersionId}`);
        }}
      />
    </>
  );
}

/** Сводка результата разбора JSON при импорте: принято/отклонено и причины. */
function PreviewSummary({ preview }: { preview: MethodImportPreview }) {
  return (
    <Callout
      tone={preview.accepted ? 'success' : 'danger'}
      title={preview.accepted ? 'Можно импортировать' : 'Импорт невозможен'}
    >
      {preview.summary ? (
        <p className="m-0">
          «{preview.summary.title}» · вопросов {preview.summary.itemCount} · шкал{' '}
          {preview.summary.scaleCount} · примеров {preview.summary.fixtureCount}
        </p>
      ) : null}

      {preview.schemaErrors.length > 0 ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
          {preview.schemaErrors.map((issue, index) => (
            <li key={index}>
              <code className="text-xs">{issue.path}</code>: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {preview.issues.length > 0 ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
          {preview.issues.map((issue, index) => (
            <li
              key={index}
              className={issue.severity === 'blocker' ? 'text-[var(--danger-text)]' : undefined}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </Callout>
  );
}

/**
 * Создание новой версии из текущей (доступно на опубликованной/только для
 * чтения версии). Источник копирования зафиксирован — это именно продолжение
 * текущей версии, а не общий мастер создания версии со страницы списка.
 */
function NewVersionDialog({
  open,
  onOpenChange,
  version,
  onCreated,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: AdminMethodVersion;
  onCreated: (versionId: string) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [semanticVersion, setSemanticVersion] = useState('');

  const create = useApiMutation<{ semanticVersion: string }, Envelope<{ versionId: string }>>(
    (input) =>
      api.post<Envelope<{ versionId: string }>>(`/admin/methods/${version.methodId}/versions`, {
        semanticVersion: input.semanticVersion,
        copyFromVersionId: version.versionId,
      }),
    { invalidate: [METHODS_LIST_KEY] },
  );

  async function submit(): Promise<void> {
    try {
      const response = await create.mutateAsync({ semanticVersion });
      notify.success('Версия создана');
      onCreated(response.data.versionId);
    } catch {
      // Ошибка уже доступна как create.error и показана рядом с полем.
    }
  }

  return (
    <DetailDrawer
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSemanticVersion('');
          create.reset();
        }
        onOpenChange(next);
      }}
      title="Новая версия"
      description={`Копия версии ${version.semanticVersion} со всем содержимым. Назначения, созданные по текущей версии, продолжат считаться по ней.`}
      returnFocusRef={returnFocusRef}
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
          label="Номер версии"
          hint="Формат 1.0.0. Должен отличаться от существующих."
          required
          error={create.error?.fieldError('semanticVersion')}
        >
          {({ inputId, describedBy }) => (
            <TextInput
              id={inputId}
              aria-describedby={describedBy}
              value={semanticVersion}
              onChange={(event) => setSemanticVersion(event.target.value)}
              placeholder="1.1.0"
              required
            />
          )}
        </Field>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary" loading={create.isPending}>
            Создать версию
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
