'use client';

import { Archive, BookOpenCheck, Copy, Ellipsis, Plus, Send, SquarePen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type RefObject } from 'react';

import type { AdminMethod, AdminMethodVersion, Envelope } from '@context/contracts';
import { APPLICABILITY_MODE_LABELS, type ApplicabilityMode } from '@context/domain';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { ConfirmDialog, DetailDrawer } from '@/components/ui/dialog';
import { Field, Select, SearchInput, TextInput } from '@/components/ui/field';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/menu';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { EmptyState, ErrorState, ForbiddenState, PageSkeleton } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { formatDateTime } from '@/lib/format';

import { STATUS_LABELS, VALIDATION_LABELS } from '../_lib/labels';

const METHODS_KEY = ['admin-methods'] as const;
const PAGE_SIZE = 20;

const STATUS_FILTERS = [
  'all',
  'draft',
  'review',
  'published',
  'suspended_for_new_assignments',
  'retired',
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const MODE_FILTERS = ['all', 'demo', 'research', 'validated_use'] as const;
type ModeFilter = (typeof MODE_FILTERS)[number];

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  review: 'warning',
  published: 'success',
  suspended_for_new_assignments: 'warning',
  retired: 'danger',
};

/** Одна строка таблицы — версия методики вместе со сведениями о самой методике. */
interface MethodVersionRow {
  readonly id: string;
  readonly method: AdminMethod;
  readonly version: AdminMethod['versions'][number];
}

/**
 * Список методик.
 *
 * Строка таблицы — версия, а не методика: «код» принадлежит методике, а
 * «версия», «статус» и «применимость» — конкретной версии, и в одной методике
 * их может быть несколько. Список загружается целиком (бэкенд не постраничный);
 * поиск, фильтры и пагинация — на клиенте.
 */
export default function AdminMethodsPage() {
  const router = useRouter();
  const query = useApiQuery<Envelope<AdminMethod[]>>(METHODS_KEY, '/admin/methods');
  const methods = query.data?.data ?? [];

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [page, setPage] = useState(1);

  const [creatorOpen, setCreatorOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);

  const [versionCreatorMethod, setVersionCreatorMethod] = useState<AdminMethod | null>(null);
  const [versionCreatorCopyFrom, setVersionCreatorCopyFrom] = useState('');

  const [retireTarget, setRetireTarget] = useState<MethodVersionRow | null>(null);
  const [reviewPendingId, setReviewPendingId] = useState<string | null>(null);
  /**
   * Один общий триггер для всех диалогов, открываемых из меню действий строки:
   * в любой момент открыт максимум один такой диалог, а кнопка «⋯», его
   * вызвавшая, — последняя нажатая (ТЗ 02.4, возврат фокуса).
   */
  const rowMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const sendToReview = useApiMutation(
    (versionId: string) =>
      api.post<Envelope<AdminMethodVersion>>(`/admin/method-versions/${versionId}/transition`, {
        status: 'review',
      }),
    {
      invalidate: [METHODS_KEY],
      onSuccess: () => {
        notify.success('Версия отправлена на проверку');
        setReviewPendingId(null);
      },
      onError: (cause) => {
        setReviewPendingId(null);
        if (cause) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        }
      },
    },
  );

  const retire = useApiMutation(
    (versionId: string) =>
      api.post<Envelope<AdminMethodVersion>>(`/admin/method-versions/${versionId}/transition`, {
        status: 'retired',
      }),
    {
      invalidate: [METHODS_KEY],
      onSuccess: () => {
        notify.success('Версия снята с использования');
        setRetireTarget(null);
      },
      onError: (cause) => {
        if (cause) {
          notify.error(cause.problem.title, { requestId: cause.problem.requestId });
        }
      },
    },
  );

  const allRows: MethodVersionRow[] = useMemo(
    () =>
      methods.flatMap((method) =>
        method.versions.map((version) => ({ id: version.versionId, method, version })),
      ),
    [methods],
  );

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter(({ method, version }) => {
      if (statusFilter !== 'all' && version.status !== statusFilter) {
        return false;
      }
      if (modeFilter !== 'all' && version.applicabilityMode !== modeFilter) {
        return false;
      }
      if (term.length === 0) {
        return true;
      }
      return method.title.toLowerCase().includes(term) || method.code.toLowerCase().includes(term);
    });
  }, [allRows, search, statusFilter, modeFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const filtersActive = search.trim().length > 0 || statusFilter !== 'all' || modeFilter !== 'all';

  function rowActions(row: MethodVersionRow): ActionMenuItem[] {
    const reviewPending = reviewPendingId === row.id;
    const items: ActionMenuItem[] = [
      {
        id: 'open',
        label: 'Открыть',
        icon: <SquarePen aria-hidden="true" strokeWidth={1.75} />,
        href: `/admin/methods/${row.id}`,
      },
      {
        id: 'duplicate',
        label: 'Дублировать',
        icon: <Copy aria-hidden="true" strokeWidth={1.75} />,
        onSelect: () => {
          setVersionCreatorMethod(row.method);
          setVersionCreatorCopyFrom(row.id);
        },
      },
    ];

    if (row.version.status === 'draft') {
      items.push({
        id: 'review',
        label: reviewPending ? 'Отправляем…' : 'Отправить на проверку',
        icon: <Send aria-hidden="true" strokeWidth={1.75} />,
        disabled: reviewPending,
        separatorBefore: true,
        onSelect: () => {
          setReviewPendingId(row.id);
          sendToReview.mutate(row.id);
        },
      });
    }

    if (row.version.status !== 'retired') {
      items.push({
        id: 'retire',
        label: 'Снять с использования',
        icon: <Archive aria-hidden="true" strokeWidth={1.75} />,
        destructive: true,
        separatorBefore: row.version.status !== 'draft',
        onSelect: () => setRetireTarget(row),
      });
    }

    return items;
  }

  function resetFilters(): void {
    setSearch('');
    setStatusFilter('all');
    setModeFilter('all');
    setPage(1);
  }

  if (query.error) {
    if (query.error.status === 403) {
      return <ForbiddenState />;
    }
    return (
      <ErrorState
        title="Не удалось загрузить методики"
        description="Проверьте подключение и попробуйте ещё раз."
        requestId={query.error.problem.requestId}
        onRetry={query.refetch}
      />
    );
  }

  if (query.isLoading) {
    return <PageSkeleton variant="list" label="Загружаем методики" />;
  }

  const columns: ReadonlyArray<Column<MethodVersionRow>> = [
    {
      key: 'method',
      header: 'Методика',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-[var(--text-primary)]">
            {row.method.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
            <code>{row.method.code}</code> · версия {row.version.semanticVersion}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      render: (row) => (
        <Badge tone={STATUS_TONE[row.version.status] ?? 'neutral'}>
          {STATUS_LABELS[row.version.status] ?? row.version.status}
        </Badge>
      ),
    },
    {
      key: 'validation',
      header: 'Проверено для применения',
      hideOnMobile: true,
      render: (row) => (
        <Badge tone={row.version.validationStatus === 'validated' ? 'success' : 'warning'}>
          {VALIDATION_LABELS[row.version.validationStatus] ?? row.version.validationStatus}
        </Badge>
      ),
    },
    {
      key: 'mode',
      header: 'Тип применения',
      hideOnMobile: true,
      render: (row) => (
        <Badge tone={row.version.applicabilityMode === 'demo' ? 'info' : 'accent'}>
          {APPLICABILITY_MODE_LABELS[row.version.applicabilityMode]}
        </Badge>
      ),
    },
    {
      key: 'items',
      header: 'Вопросов',
      align: 'right',
      hideOnMobile: true,
      render: (row) => <span className="tabular-nums">{row.version.itemCount}</span>,
    },
    {
      key: 'date',
      header: 'Обновлено',
      hideOnMobile: true,
      nowrap: true,
      render: (row) =>
        row.version.publishedAt ? (
          <span>{formatDateTime(row.version.publishedAt)}</span>
        ) : (
          <span className="text-[var(--text-secondary)]">
            {formatDateTime(row.version.createdAt)} (черновик)
          </span>
        ),
    },
    {
      key: 'actions',
      header: 'Действия',
      align: 'right',
      render: (row) => {
        const label = `Действия с версией ${row.version.semanticVersion} методики «${row.method.title}»`;
        return (
          <ActionMenu
            label={label}
            items={rowActions(row)}
            trigger={
              <IconButton
                label={label}
                size="sm"
                icon={<Ellipsis aria-hidden="true" strokeWidth={1.75} />}
                onClick={(event) => {
                  rowMenuTriggerRef.current = event.currentTarget;
                }}
              />
            }
          />
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Методики"
        description="Опубликованная версия неизменяема: исправление оформляется новой версией. «Опубликована» и «применимость подтверждена» — разные признаки."
        action={
          <Button
            ref={createTriggerRef}
            variant="primary"
            icon={<Plus aria-hidden="true" strokeWidth={1.75} />}
            onClick={() => setCreatorOpen(true)}
          >
            Создать методику
          </Button>
        }
      />

      {allRows.length === 0 ? (
        <EmptyState
          icon={<BookOpenCheck strokeWidth={1.75} />}
          title="Методик пока нет"
          description="Создайте первую — начнётся пустой черновик версии 1.0.0. Паспорт, вопросы и ключи подсчёта заполняются в редакторе версии."
          action={
            <Button variant="primary" onClick={() => setCreatorOpen(true)}>
              Создать методику
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <SearchInput
              className="sm:max-w-xs sm:flex-1"
              label="Поиск по названию или коду методики"
              placeholder="Поиск по названию или коду…"
              value={search}
              onValueChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
            />
            <Field label="Статус">
              {({ inputId }) => (
                <Select
                  id={inputId}
                  wrapperClassName="sm:w-56"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as StatusFilter);
                    setPage(1);
                  }}
                >
                  <option value="all">Все статусы</option>
                  {STATUS_FILTERS.filter(
                    (status): status is Exclude<StatusFilter, 'all'> => status !== 'all',
                  ).map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status] ?? status}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Тип применения">
              {({ inputId }) => (
                <Select
                  id={inputId}
                  wrapperClassName="sm:w-56"
                  value={modeFilter}
                  onChange={(event) => {
                    setModeFilter(event.target.value as ModeFilter);
                    setPage(1);
                  }}
                >
                  <option value="all">Все типы</option>
                  {MODE_FILTERS.filter((mode): mode is ApplicabilityMode => mode !== 'all').map(
                    (mode) => (
                      <option key={mode} value={mode}>
                        {APPLICABILITY_MODE_LABELS[mode]}
                      </option>
                    ),
                  )}
                </Select>
              )}
            </Field>
            {filtersActive ? (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            ) : null}
          </div>

          {filteredRows.length === 0 ? (
            <EmptyState
              compact
              title="Ничего не найдено"
              description="Попробуйте изменить поиск или сбросить фильтры."
              action={
                <Button variant="secondary" size="sm" onClick={resetFilters}>
                  Сбросить фильтры
                </Button>
              }
            />
          ) : (
            <>
              <DataTable
                rows={pageRows}
                columns={columns}
                caption="Методики и их версии"
                rowHref={(row) => `/admin/methods/${row.id}`}
              />
              <Pagination
                page={safePage}
                pageSize={PAGE_SIZE}
                total={filteredRows.length}
                onChange={setPage}
              />
            </>
          )}
        </>
      )}

      <MethodCreator
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        returnFocusRef={createTriggerRef}
        onCreated={(versionId) => {
          setCreatorOpen(false);
          router.push(`/admin/methods/${versionId}`);
        }}
      />

      <VersionCreator
        key={`${versionCreatorMethod?.methodId ?? 'none'}:${versionCreatorCopyFrom}`}
        method={versionCreatorMethod}
        initialCopyFrom={versionCreatorCopyFrom}
        returnFocusRef={rowMenuTriggerRef}
        onClose={() => setVersionCreatorMethod(null)}
        onCreated={(versionId) => {
          setVersionCreatorMethod(null);
          router.push(`/admin/methods/${versionId}`);
        }}
      />

      <ConfirmDialog
        open={retireTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRetireTarget(null);
          }
        }}
        title="Снять версию с использования?"
        description={
          retireTarget
            ? `Версия ${retireTarget.version.semanticVersion} методики «${retireTarget.method.title}» перейдёт в состояние «снята».`
            : ''
        }
        consequences={[
          'Отменить это действие нельзя.',
          'Новые назначения по этой версии станут невозможны.',
          'Уже идущие оценки, назначенные по ней, не прерываются.',
        ]}
        confirmLabel="Снять с использования"
        destructive
        loading={retire.isPending}
        onConfirm={() => {
          if (retireTarget) {
            retire.mutate(retireTarget.id);
          }
        }}
        returnFocusRef={rowMenuTriggerRef}
      />
    </>
  );
}

/** Новая методика: код неизменяем, содержимое заполняется в редакторе. */
function MethodCreator({
  open,
  onOpenChange,
  onCreated,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (versionId: string) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');

  const create = useApiMutation(
    (input: { code: string; title: string }) =>
      api.post<Envelope<{ versionId: string }>>('/admin/methods', {
        ...input,
        semanticVersion: '1.0.0',
      }),
    { invalidate: [METHODS_KEY] },
  );

  async function submit(): Promise<void> {
    try {
      const response = await create.mutateAsync({ code, title });
      notify.success('Методика создана. Заполните паспорт и вопросы.');
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
          setCode('');
          setTitle('');
          create.reset();
        }
        onOpenChange(next);
      }}
      title="Новая методика"
      description="Создаётся пустой черновик версии 1.0.0 на уровне «демонстрация». Заявление о применимости требует отдельного основания."
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
          label="Код методики"
          hint="Латиница в нижнем регистре, цифры и подчёркивание. Изменить его потом нельзя."
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

        <Field label="Название" required error={create.error?.fieldError('title')}>
          {({ inputId }) => (
            <TextInput
              id={inputId}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              required
            />
          )}
        </Field>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary" loading={create.isPending}>
            Создать черновик
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

/**
 * Новая версия существующей методики, при желании копией другой версии.
 *
 * `initialCopyFrom` предзаполняет источник для действия «Дублировать» из
 * таблицы; поле остаётся редактируемым — можно выбрать другую версию или
 * начать с пустого черновика.
 */
function VersionCreator({
  method,
  initialCopyFrom,
  onClose,
  onCreated,
  returnFocusRef,
}: {
  method: AdminMethod | null;
  initialCopyFrom: string;
  onClose: () => void;
  onCreated: (versionId: string) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [semanticVersion, setSemanticVersion] = useState('');
  const [copyFrom, setCopyFrom] = useState(initialCopyFrom);

  const create = useApiMutation(
    (input: { methodId: string; semanticVersion: string; copyFromVersionId?: string }) =>
      api.post<Envelope<{ versionId: string }>>(`/admin/methods/${input.methodId}/versions`, {
        semanticVersion: input.semanticVersion,
        ...(input.copyFromVersionId ? { copyFromVersionId: input.copyFromVersionId } : {}),
      }),
    { invalidate: [METHODS_KEY] },
  );

  async function submit(): Promise<void> {
    if (!method) {
      return;
    }
    try {
      const response = await create.mutateAsync({
        methodId: method.methodId,
        semanticVersion,
        copyFromVersionId: copyFrom || undefined,
      });
      notify.success('Версия создана');
      onCreated(response.data.versionId);
    } catch {
      // Ошибка уже доступна как create.error и показана рядом с полем.
    }
  }

  return (
    <DetailDrawer
      open={method !== null}
      onOpenChange={(next) => {
        if (!next) {
          setSemanticVersion('');
          create.reset();
          onClose();
        }
      }}
      title={method ? `Новая версия: ${method.title}` : 'Новая версия'}
      description="Назначения, созданные по прежней версии, продолжат считаться по ней."
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

        <Field
          label="Скопировать содержимое"
          hint="Необязательно: можно начать с пустого черновика."
        >
          {({ inputId }) => (
            <Select
              id={inputId}
              value={copyFrom}
              onChange={(event) => setCopyFrom(event.target.value)}
            >
              <option value="">Начать с пустого черновика</option>
              {method?.versions.map((version) => (
                <option key={version.versionId} value={version.versionId}>
                  Версия {version.semanticVersion}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary" loading={create.isPending}>
            Создать версию
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
