'use client';

import { useState } from 'react';

import type { Envelope, GenericAcknowledgement, RecordDecisionRequest } from '@context/contracts';
import { DECISION_ACTIONS, DECISION_ACTION_LABELS } from '@context/domain';

import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DateField } from '@/components/ui/date-field';
import { CharacterCount, Field, Select, TextArea } from '@/components/ui/field';
import { notify } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/query';

const COMMENT_MAX = 2000;

/**
 * «Полдень» вместо полуночи: перевод даты-без-времени в ISO-datetime не должен
 * из-за часового пояса браузера съехать на соседний день на сервере.
 */
function dateInputToIso(value: string): string {
  return new Date(`${value}T12:00:00`).toISOString();
}

/**
 * Личная запись руководителя о решении по заключению.
 *
 * Ничего не публикует и не меняет заключение — только фиксирует, что сделал
 * руководитель (ТЗ M09). Дата следующего шага необязательна.
 */
export function DecisionPanel({
  organizationId,
  reportId,
}: {
  organizationId: string;
  reportId: string;
}) {
  const [action, setAction] = useState<string>(DECISION_ACTIONS[0]);
  const [comment, setComment] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  const mutation = useApiMutation<RecordDecisionRequest, Envelope<GenericAcknowledgement>>(
    (body) => api.post(`/orgs/${organizationId}/reports/${reportId}/decisions`, body),
    {
      invalidate: [['report', organizationId, reportId]],
      onSuccess: (result) => {
        notify.success(result.data.message);
        setComment('');
        setFollowUpDate('');
      },
      onError: (error) => {
        if (error) {
          notify.error(error.problem.title, { requestId: error.problem.requestId });
        }
      },
    },
  );

  function submit(): void {
    mutation.mutate({
      actionCode: action as RecordDecisionRequest['actionCode'],
      comment: comment.trim() || undefined,
      followUpAt: followUpDate ? dateInputToIso(followUpDate) : undefined,
    });
  }

  return (
    <Card>
      <CardHeader
        title="Зафиксировать решение"
        description="Это ваша запись. Она не меняет заключение и не запускает действий над сотрудником."
      />
      <CardBody className="flex flex-col gap-4">
        <Field label="Что вы сделали">
          {({ inputId }) => (
            <Select id={inputId} value={action} onChange={(event) => setAction(event.target.value)}>
              {DECISION_ACTIONS.map((code) => (
                <option key={code} value={code}>
                  {DECISION_ACTION_LABELS[code]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Комментарий" hint="Необязательно.">
          {({ inputId, describedBy }) => (
            <>
              <TextArea
                id={inputId}
                aria-describedby={describedBy}
                value={comment}
                onChange={(event) => setComment(event.target.value.slice(0, COMMENT_MAX))}
                maxLength={COMMENT_MAX}
                rows={3}
              />
              <CharacterCount value={comment} max={COMMENT_MAX} />
            </>
          )}
        </Field>

        <Field
          label="Дата следующего шага"
          hint="Например, дата разговора с сотрудником. Необязательно."
        >
          {({ inputId }) => (
            <DateField id={inputId} value={followUpDate} onChange={setFollowUpDate} />
          )}
        </Field>

        <Button variant="primary" loading={mutation.isPending} onClick={submit} fullWidth>
          Записать решение
        </Button>
      </CardBody>
    </Card>
  );
}
