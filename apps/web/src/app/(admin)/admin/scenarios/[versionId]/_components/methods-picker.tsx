'use client';

import { ArrowDown, ArrowUp, BookOpenCheck, X } from 'lucide-react';
import { useId, useMemo } from 'react';

import type { AvailableMethodVersion } from '@context/contracts';

import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Select } from '@/components/ui/field';
import { Callout, EmptyState } from '@/components/ui/states';

import { STATUS_LABELS } from '../../../_lib/labels';

/** Строка состава сценария: ссылка на версию методики, порядок и обязательность. */
export interface SelectedMethod {
  readonly methodVersionId: string;
  readonly required: boolean;
}

interface MethodInfo {
  readonly title: string;
  readonly code: string;
  readonly semanticVersion: string;
  readonly status: string;
  readonly itemCount: number;
}

/**
 * Состав сценария.
 *
 * Выбирается именно версия методики, а не методика: назначение обязано
 * считаться по тем правилам, по которым создавалось. Порядок задаёт сценарий —
 * ни руководитель, ни участник его не меняют (ТЗ 01.4).
 */
export function MethodsPicker({
  selected,
  available,
  describe,
  onChange,
  disabled,
}: {
  selected: readonly SelectedMethod[];
  available: readonly AvailableMethodVersion[];
  /** Сведения о версии, которой уже нет среди доступных (например, снятой с публикации). */
  describe: (methodVersionId: string) => MethodInfo | null;
  onChange: (next: SelectedMethod[]) => void;
  disabled: boolean;
}) {
  const addFieldId = useId();
  const chosen = new Set(selected.map((item) => item.methodVersionId));
  const addable = available.filter((version) => !chosen.has(version.methodVersionId));

  // Две версии одной методики в одном сценарии несовместимы: код методики —
  // общий у всех её версий, а значит надёжный признак конфликта здесь,
  // где полный methodId компоненту не передаётся.
  const conflicts = useMemo(() => {
    const byCode = new Map<string, { code: string; title: string; versions: string[] }>();
    for (const item of selected) {
      const info = describe(item.methodVersionId);
      if (!info) {
        continue;
      }
      const entry = byCode.get(info.code) ?? { code: info.code, title: info.title, versions: [] };
      entry.versions.push(info.semanticVersion);
      byCode.set(info.code, entry);
    }
    return [...byCode.values()].filter((entry) => entry.versions.length > 1);
  }, [selected, describe]);

  const conflictingCodes = useMemo(
    () => new Set(conflicts.map((entry) => entry.code)),
    [conflicts],
  );

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= selected.length) {
      return;
    }
    const copy = [...selected];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved!);
    onChange(copy);
  }

  return (
    <Card>
      <CardHeader
        icon={<BookOpenCheck strokeWidth={1.75} />}
        title={`Методики сценария (${selected.length})`}
        description="Доступны только опубликованные версии. Порядок прохождения фиксируется этой версией сценария."
        action={
          disabled ? null : (
            <div className="flex items-center gap-2">
              <label htmlFor={addFieldId} className="sr-only">
                Версия методики для добавления
              </label>
              <Select
                id={addFieldId}
                defaultValue=""
                wrapperClassName="max-w-[320px]"
                onChange={(event) => {
                  if (event.target.value) {
                    onChange([
                      ...selected,
                      { methodVersionId: event.target.value, required: true },
                    ]);
                    event.target.value = '';
                  }
                }}
              >
                <option value="">Добавить методику…</option>
                {addable.map((version) => (
                  <option key={version.methodVersionId} value={version.methodVersionId}>
                    {version.title} · v{version.semanticVersion}
                  </option>
                ))}
              </Select>
            </div>
          )
        }
      />
      <CardBody className="flex flex-col gap-4">
        {available.length === 0 ? (
          <Callout tone="warning" role="status">
            Нет ни одной опубликованной версии методики. Сначала опубликуйте методику — сценарий без
            методик опубликовать нельзя.
          </Callout>
        ) : null}

        {conflicts.length > 0 ? (
          <Callout
            tone="danger"
            role="alert"
            title="В сценарии добавлено несколько версий одной методики"
          >
            <ul className="flex list-none flex-col gap-1 p-0">
              {conflicts.map((entry) => (
                <li key={entry.title}>
                  «{entry.title}»: версии {entry.versions.join(', ')}. Оставьте только одну — иначе
                  публикация будет отклонена.
                </li>
              ))}
            </ul>
          </Callout>
        ) : null}

        {selected.length === 0 ? (
          <EmptyState
            compact
            icon={<BookOpenCheck strokeWidth={1.75} />}
            title="Методик пока нет"
            description="Добавьте хотя бы одну через список выше: назначение без методик нечем считать."
          />
        ) : (
          <ol className="flex list-none flex-col gap-2 p-0">
            {selected.map((item, index) => {
              const info = describe(item.methodVersionId);
              const conflicting = info ? conflictingCodes.has(info.code) : false;
              return (
                <li
                  key={item.methodVersionId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-nested)] border border-[var(--border-hairline)] bg-[var(--bg-inset)] p-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {index + 1}. {info ? info.title : 'Версия недоступна'}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                      {info
                        ? `${info.code} v${info.semanticVersion} · вопросов ${info.itemCount}`
                        : 'Эта версия методики больше не опубликована — замените её или удалите.'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {info ? (
                      <Badge tone={info.status === 'published' ? 'success' : 'warning'}>
                        {STATUS_LABELS[info.status] ?? info.status}
                      </Badge>
                    ) : (
                      <Badge tone="danger">Недоступна</Badge>
                    )}

                    {conflicting ? <Badge tone="danger">Конфликт версий</Badge> : null}

                    <Checkbox
                      checked={item.required}
                      disabled={disabled}
                      onChange={(checked) => {
                        const copy = [...selected];
                        copy[index] = { ...item, required: checked };
                        onChange(copy);
                      }}
                      label="Обязательная"
                      className="py-0"
                    />

                    {disabled ? null : (
                      <>
                        <IconButton
                          label={`Переместить методику ${index + 1} выше`}
                          icon={<ArrowUp aria-hidden="true" strokeWidth={1.75} />}
                          variant="ghost"
                          size="sm"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                        />
                        <IconButton
                          label={`Переместить методику ${index + 1} ниже`}
                          icon={<ArrowDown aria-hidden="true" strokeWidth={1.75} />}
                          variant="ghost"
                          size="sm"
                          onClick={() => move(index, 1)}
                          disabled={index === selected.length - 1}
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          icon={<X aria-hidden="true" strokeWidth={1.75} />}
                          aria-label={`Убрать методику ${index + 1} из сценария`}
                          onClick={() =>
                            onChange(selected.filter((_, position) => position !== index))
                          }
                        >
                          Убрать
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
