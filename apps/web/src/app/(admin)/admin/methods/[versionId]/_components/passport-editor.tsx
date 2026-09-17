'use client';

import { IdCard } from 'lucide-react';

import type { DraftMethodPassport } from '@context/contracts';
import { missingPassportFields } from '@context/contracts';

import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CharacterCount, Field, TextArea, TextInput } from '@/components/ui/field';
import { Callout } from '@/components/ui/states';

/**
 * Паспорт методики.
 *
 * Ограничения применения и основание использования — обязательные поля.
 * Их не заполняет ни система, ни языковая модель: за содержание отвечает
 * человек, который методику вносит (ТЗ A05).
 */
export function PassportEditor({
  value,
  onChange,
  disabled,
}: {
  value: DraftMethodPassport;
  onChange: (next: DraftMethodPassport) => void;
  disabled: boolean;
}) {
  const missing = missingPassportFields(value);

  function set<K extends keyof DraftMethodPassport>(key: K, next: DraftMethodPassport[K]): void {
    onChange({ ...value, [key]: next });
  }

  return (
    <Card>
      <CardHeader
        icon={<IdCard aria-hidden="true" strokeWidth={1.75} />}
        title="Паспорт"
        description="Сведения о методике, которые видит участник и которые попадают в заключение."
      />
      <CardBody className="flex flex-col gap-5">
        {missing.length > 0 ? (
          <Callout tone="warning" title="Для публикации не хватает">
            {missing.join(', ')}.
          </Callout>
        ) : null}

        <Field label="Название" required>
          {({ inputId }) => (
            <TextInput
              id={inputId}
              value={value.title}
              maxLength={200}
              disabled={disabled}
              onChange={(event) => set('title', event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Что методика измеряет по заявлению владельца"
          hint="Формулировка владельца методики, а не вывод системы."
          required
        >
          {({ inputId, describedBy }) => (
            <div className="flex flex-col gap-1">
              <TextArea
                id={inputId}
                aria-describedby={describedBy}
                value={value.purpose}
                maxLength={2000}
                rows={3}
                disabled={disabled}
                onChange={(event) => set('purpose', event.target.value)}
              />
              <CharacterCount value={value.purpose} max={2000} />
            </div>
          )}
        </Field>

        <Field label="Целевая группа" required>
          {({ inputId }) => (
            <TextInput
              id={inputId}
              value={value.targetPopulation}
              maxLength={500}
              disabled={disabled}
              onChange={(event) => set('targetPopulation', event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Ограничения применения"
          hint="По одному на строку. Это то, что увидит участник и что попадёт в заключение."
          required
        >
          {({ inputId, describedBy }) => (
            <TextArea
              id={inputId}
              aria-describedby={describedBy}
              value={value.limitations.join('\n')}
              rows={4}
              disabled={disabled}
              onChange={(event) =>
                set(
                  'limitations',
                  event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0),
                )
              }
            />
          )}
        </Field>

        <Field label="Источник содержимого" hint="Откуда взяты вопросы." required>
          {({ inputId, describedBy }) => (
            <TextInput
              id={inputId}
              aria-describedby={describedBy}
              value={value.sourceStatement}
              maxLength={1000}
              disabled={disabled}
              onChange={(event) => set('sourceStatement', event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Основание использования"
          hint="На каком основании содержимое можно использовать в этой платформе."
          required
        >
          {({ inputId, describedBy }) => (
            <TextInput
              id={inputId}
              aria-describedby={describedBy}
              value={value.rightsStatement}
              maxLength={1000}
              disabled={disabled}
              onChange={(event) => set('rightsStatement', event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Ориентир длительности, минут"
          hint="Оставьте пустым, если время не измеряли. Выдуманное значение хуже его отсутствия."
        >
          {({ inputId, describedBy }) => (
            <div className="flex items-center gap-3">
              <TextInput
                id={inputId}
                aria-describedby={describedBy}
                type="number"
                min={1}
                max={240}
                className="max-w-[160px]"
                value={value.estimatedMinutes ?? ''}
                disabled={disabled}
                onChange={(event) =>
                  set('estimatedMinutes', event.target.value ? Number(event.target.value) : null)
                }
              />
              {value.estimatedMinutes !== null ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => set('estimatedMinutes', null)}
                >
                  Не измеряли
                </Button>
              ) : null}
            </div>
          )}
        </Field>

        <Field label="Что видит участник перед началом" required>
          {({ inputId }) => (
            <TextArea
              id={inputId}
              value={value.participantIntro}
              maxLength={2000}
              rows={3}
              disabled={disabled}
              onChange={(event) => set('participantIntro', event.target.value)}
            />
          )}
        </Field>
      </CardBody>
    </Card>
  );
}
