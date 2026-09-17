'use client';

import { Plus, Route } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import type { AdminScenario, AdminScenarioVersion, Envelope } from '@context/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DetailDrawer } from '@/components/ui/dialog';
import { Field, Select, TextInput } from '@/components/ui/field';
import { DataTable, type Column } from '@/components/ui/table';
import { EmptyState, ErrorState, ForbiddenState, PageSkeleton } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { formatDateTime } from '@/lib/format';

import { STATUS_LABELS } from '../_lib/labels';

const SCENARIOS_KEY = ['admin-scenarios'] as const;

const MODE_LABELS: Record<AdminScenarioVersion['applicabilityMode'], string> = {
  demo: 'Демонстрация',
  research: 'Исследование',
  validated_use: 'Подтверждённое применение',
};

/** Одна строка таблицы — версия сценария вместе со сведениями о самом сценарии. */
interface ScenarioVersionRow {
  readonly id: string;
  readonly scenario: AdminScenario;
  readonly version: AdminScenario['versions'][number];
}

export default function AdminScenariosPage() {
  const router = useRouter();
  const query = useApiQuery<Envelope<AdminScenario[]>>(SCENARIOS_KEY, '/admin/scenarios');
  const rows = query.data?.data ?? [];

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [newVersionFor, setNewVersionFor] = useState<AdminScenario | null>(null);

  if (query.error) {
    if (query.error.status === 403) {
      return <ForbiddenState />;
    }
    return (
      <ErrorState
        title="Не удалось загрузить сценарии"
        description="Проверьте подключение и попробуйте ещё раз."
        requestId={query.error.problem.requestId}
        onRetry={query.refetch}
      />
    );
  }

  if (query.isLoading) {
    return <PageSkeleton variant="list" label="Загружаем сценарии" />;
  }

  const versionRows: ScenarioVersionRow[] = rows.flatMap((scenario) =>
    scenario.versions.map((version) => ({
      id: version.versionId,
      scenario,
      version,
    })),
  );

  const columns: ReadonlyArray<Column<ScenarioVersionRow>> = [
    {
      key: 'scenario',
      header: 'Сценарий',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-[var(--text-primary)]">
            {row.scenario.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
            {row.scenario.code} · версия {row.version.semanticVersion}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      render: (row) => (
        <Badge tone={row.version.status === 'published' ? 'success' : 'neutral'}>
          {STATUS_LABELS[row.version.status] ?? row.version.status}
        </Badge>
      ),
    },
    {
      key: 'mode',
      header: 'Уровень применимости',
      hideOnMobile: true,
      render: (row) => (
        <Badge tone={row.version.applicabilityMode === 'demo' ? 'info' : 'accent'}>
          {MODE_LABELS[row.version.applicabilityMode] ?? row.version.applicabilityMode}
        </Badge>
      ),
    },
    {
      key: 'methods',
      header: 'Методик',
      align: 'right',
      hideOnMobile: true,
      render: (row) => <span className="tabular-nums">{row.version.methodCount}</span>,
    },
    {
      key: 'fields',
      header: 'Полей контекста',
      align: 'right',
      hideOnMobile: true,
      render: (row) => <span className="tabular-nums">{row.version.contextFieldCount}</span>,
    },
    {
      key: 'published',
      header: 'Опубликована',
      hideOnMobile: true,
      nowrap: true,
      render: (row) =>
        row.version.publishedAt ? (
          formatDateTime(row.version.publishedAt)
        ) : (
          <span className="text-[var(--text-tertiary)]">—</span>
        ),
    },
    {
      key: 'actions',
      header: 'Действия',
      align: 'right',
      render: (row) => (
        <Button size="sm" variant="secondary" onClick={() => setNewVersionFor(row.scenario)}>
          Новая версия
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Сценарии"
        description="Версия сценария закрепляет набор версий методик. Публикация проверяет, что все вложенные методики опубликованы и их уровень готовности не ниже уровня сценария."
        action={
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" />}
            onClick={() => setCreatorOpen(true)}
          >
            Создать сценарий
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Route strokeWidth={1.75} />}
          title="Сценариев пока нет"
          description="Создайте первый — он появится с пустым черновиком версии 1.0.0, готовым для настройки схемы контекста и состава методик."
          action={
            <Button variant="primary" onClick={() => setCreatorOpen(true)}>
              Создать сценарий
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={versionRows}
          columns={columns}
          caption="Сценарии и их версии"
          rowHref={(row) => `/admin/scenarios/${row.version.versionId}`}
        />
      )}

      <ScenarioCreator
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        onCreated={(versionId) => {
          setCreatorOpen(false);
          router.push(`/admin/scenarios/${versionId}`);
        }}
      />

      <VersionCreator
        scenario={newVersionFor}
        onClose={() => setNewVersionFor(null)}
        onCreated={(versionId) => {
          setNewVersionFor(null);
          router.push(`/admin/scenarios/${versionId}`);
        }}
      />
    </>
  );
}

/** Новый сценарий: код неизменяем, состав задаётся в редакторе версии. */
function ScenarioCreator({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (versionId: string) => void;
}) {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');

  const create = useApiMutation(
    (input: { code: string; title: string }) =>
      api.post<Envelope<AdminScenarioVersion>>('/admin/scenarios', {
        ...input,
        semanticVersion: '1.0.0',
      }),
    { invalidate: [SCENARIOS_KEY] },
  );

  async function submit(): Promise<void> {
    try {
      const response = await create.mutateAsync({ code, title });
      notify.success('Сценарий создан. Добавьте методики и правила заключения.');
      onCreated(response.data.versionId);
    } catch {
      // Ошибка уже доступна как create.error и показана рядом с полем.
    }
  }

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Новый сценарий"
      description="Создаётся черновик версии 1.0.0 на уровне «демонстрация» с заготовкой схемы контекста. Уровень применимости повышается отдельно и требует основания."
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
          label="Код сценария"
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

/** Новая версия сценария, при желании копией существующей. */
function VersionCreator({
  scenario,
  onClose,
  onCreated,
}: {
  scenario: AdminScenario | null;
  onClose: () => void;
  onCreated: (versionId: string) => void;
}) {
  const [semanticVersion, setSemanticVersion] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const copyFromId = useId();

  const create = useApiMutation(
    (input: { scenarioId: string; semanticVersion: string; copyFromVersionId?: string }) =>
      api.post<Envelope<AdminScenarioVersion>>(`/admin/scenarios/${input.scenarioId}/versions`, {
        semanticVersion: input.semanticVersion,
        ...(input.copyFromVersionId ? { copyFromVersionId: input.copyFromVersionId } : {}),
      }),
    { invalidate: [SCENARIOS_KEY] },
  );

  async function submit(): Promise<void> {
    if (!scenario) {
      return;
    }
    try {
      const response = await create.mutateAsync({
        scenarioId: scenario.scenarioId,
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
      open={scenario !== null}
      onOpenChange={(next) => {
        if (!next) {
          setSemanticVersion('');
          setCopyFrom('');
          create.reset();
          onClose();
        }
      }}
      title={scenario ? `Новая версия: ${scenario.title}` : 'Новая версия'}
      description="Назначения, созданные по прежней версии, продолжат проходить её набор методик."
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
          label="Скопировать состав"
          hint="Необязательно: можно начать с заготовки схемы контекста и пустого состава."
        >
          {() => (
            <Select
              id={copyFromId}
              value={copyFrom}
              onChange={(event) => setCopyFrom(event.target.value)}
            >
              <option value="">Начать с заготовки</option>
              {scenario?.versions.map((version) => (
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
