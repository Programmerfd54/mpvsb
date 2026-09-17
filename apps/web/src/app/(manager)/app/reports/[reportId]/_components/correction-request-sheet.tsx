'use client';

import { useState, type RefObject } from 'react';

import type { CorrectionRequestInput, Envelope } from '@context/contracts';
import { CORRECTION_BLOCK_KEYS, CORRECTION_BLOCK_LABELS } from '@context/contracts';

import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/dialog';
import { CharacterCount, Field, Select, TextArea } from '@/components/ui/field';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/query';

const DESCRIPTION_MAX = 2000;
const DESCRIPTION_MIN = 5;

/**
 * Форма «Сообщить о неточности» (ТЗ M09).
 *
 * Отправляет запрос рецензенту, ничего не меняя в самом заключении: успех
 * подтверждается только текстом, который прислал сервер.
 */
export function CorrectionRequestSheet({
  open,
  onOpenChange,
  organizationId,
  reportId,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  reportId: string;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [blockKey, setBlockKey] = useState<string>(CORRECTION_BLOCK_KEYS[0]);
  const [description, setDescription] = useState('');

  const mutation = useApiMutation<
    CorrectionRequestInput,
    Envelope<{ receiptId: string; message: string }>
  >((body) => api.post(`/orgs/${organizationId}/reports/${reportId}/corrections`, body), {
    onSuccess: (result) => {
      notify.success(result.data.message);
      setDescription('');
      onOpenChange(false);
    },
    onError: (error) => {
      if (error) {
        notify.error(error.problem.title, { requestId: error.problem.requestId });
      }
    },
  });

  const trimmed = description.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < DESCRIPTION_MIN;

  function submit(): void {
    if (trimmed.length < DESCRIPTION_MIN) {
      return;
    }
    mutation.mutate({
      blockKey: blockKey as CorrectionRequestInput['blockKey'],
      description: trimmed,
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Сообщить о неточности"
      description="Опишите, что именно в заключении выглядит неверным. Заключение останется доступным; рецензент разберёт обращение и при подтверждённой ошибке выпустит исправленную версию."
      returnFocusRef={returnFocusRef}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={trimmed.length < DESCRIPTION_MIN}
            disabledReason={
              trimmed.length < DESCRIPTION_MIN
                ? 'Опишите неточность (минимум 5 символов)'
                : undefined
            }
            onClick={submit}
          >
            Отправить
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Какой раздел это касается">
          {({ inputId }) => (
            <Select
              id={inputId}
              value={blockKey}
              onChange={(event) => setBlockKey(event.target.value)}
            >
              {CORRECTION_BLOCK_KEYS.map((key) => (
                <option key={key} value={key}>
                  {CORRECTION_BLOCK_LABELS[key]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Описание"
          required
          error={tooShort ? 'Слишком коротко: опишите неточность подробнее' : undefined}
        >
          {({ inputId, describedBy }) => (
            <>
              <TextArea
                id={inputId}
                aria-describedby={describedBy}
                invalid={tooShort}
                value={description}
                onChange={(event) => setDescription(event.target.value.slice(0, DESCRIPTION_MAX))}
                maxLength={DESCRIPTION_MAX}
                rows={5}
                placeholder="Например: в основаниях перепутаны источники двух ответов."
              />
              <CharacterCount value={description} max={DESCRIPTION_MAX} />
            </>
          )}
        </Field>
      </div>
    </Sheet>
  );
}
