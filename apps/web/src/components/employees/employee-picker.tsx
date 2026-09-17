'use client';

import { ChevronDown, Search } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useId, useState } from 'react';

import type { EmployeeSummary, Envelope, ListEnvelope } from '@context/contracts';

import { Monogram } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox, CONTROL_CLASS, SearchInput } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/states';
import { Pagination } from '@/components/ui/table';
import { cx } from '@/components/ui/tint';
import { useApiQuery } from '@/lib/query';

export function EmployeePicker({
  organizationId,
  selected,
  onToggle,
  multiple = false,
  limit = 50,
}: {
  organizationId: string | undefined;
  selected: readonly string[];
  onToggle: (employee: EmployeeSummary) => void;
  multiple?: boolean;
  limit?: number;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: '20',
    status: multiple ? 'active' : 'all',
    sort: 'name',
    order: 'asc',
  });
  if (search) params.set('query', search);
  const result = useApiQuery<ListEnvelope<EmployeeSummary>>(
    ['employee-picker', organizationId, multiple, search, page],
    organizationId ? `/orgs/${organizationId}/employees?${params}` : null,
  );
  const searching = result.isFetching || query.trim() !== search;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SearchInput
        label="Найти сотрудника"
        placeholder="Имя или внутренний код"
        value={query}
        onValueChange={(value) => setQuery(value.slice(0, 200))}
        loading={searching}
      />
      {result.error ? (
        <ErrorState title="Не удалось загрузить сотрудников" onRetry={result.refetch} />
      ) : searching ? (
        <LoadingBlock label="Ищем сотрудников" />
      ) : result.data?.data.length === 0 ? (
        <EmptyState
          compact
          icon={<Search />}
          title="Сотрудники не найдены"
          description="Попробуйте другое имя или внутренний код."
        />
      ) : (
        <ul aria-label="Сотрудники" className="m-0 max-h-80 list-none overflow-y-auto p-0">
          {result.data?.data.map((employee) => {
            const checked = selected.includes(employee.id);
            const label = employee.displayName ?? employee.externalCode ?? 'Без имени';
            const description = [
              employee.jobTitle,
              employee.department,
              employee.archivedAt ? 'В архиве' : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li
                key={employee.id}
                className={cx(
                  'rounded-xl px-3',
                  checked ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg-hover)]',
                )}
              >
                {multiple ? (
                  <Checkbox
                    checked={checked}
                    onChange={() => onToggle(employee)}
                    disabled={!checked && selected.length >= limit}
                    label={label}
                    description={description}
                  />
                ) : (
                  <button
                    type="button"
                    aria-pressed={checked}
                    onClick={() => onToggle(employee)}
                    className="flex min-h-14 w-full items-center gap-3 py-3 text-left"
                  >
                    <Monogram name={label} seed={employee.id} size="sm" />
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-medium">{label}</span>
                      <span className="block text-xs text-[var(--text-secondary)]">
                        {description}
                      </span>
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {multiple && selected.length >= limit ? (
        <p className="text-sm text-[var(--warning-text)]" role="status">
          Выбрано {limit} сотрудников. Снимите отметку, чтобы выбрать другого.
        </p>
      ) : null}
      {!searching && result.data ? (
        <Pagination page={page} pageSize={20} total={result.data.meta.total} onChange={setPage} />
      ) : null}
    </div>
  );
}

export function EmployeeFilter({
  id,
  organizationId,
  value,
  onChange,
}: {
  id: string;
  organizationId: string | undefined;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const employee = useApiQuery<Envelope<EmployeeSummary>>(
    ['employee-filter-value', organizationId, value],
    organizationId && value ? `/orgs/${organizationId}/employees/${value}` : null,
  );
  const label = value
    ? (employee.data?.data.displayName ?? employee.data?.data.externalCode ?? 'Выбранный сотрудник')
    : 'Все сотрудники';
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          className={cx(
            CONTROL_CLASS,
            'flex h-11 w-full max-w-xs items-center justify-between gap-3 text-left',
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-labelledby={titleId}
          className="z-50 w-[380px] max-w-[calc(100vw-24px)] rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-overlay)]"
        >
          <h2 id={titleId} className="mb-3 text-base font-semibold">
            Выберите сотрудника
          </h2>
          <EmployeePicker
            organizationId={organizationId}
            selected={value ? [value] : []}
            onToggle={(item) => {
              onChange(item.id);
              setOpen(false);
            }}
          />
          {value ? (
            <Button
              variant="ghost"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              Сбросить выбор
            </Button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
