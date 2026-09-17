'use client';

import { useEffect } from 'react';
import { Library } from 'lucide-react';
import type { EvidenceItemView } from '@context/contracts';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { Callout } from '@/components/ui/states';
import { EvidenceCard } from './evidence-card';

export function EvidenceBrowser({
  evidence,
  selectedCode,
  onSelect,
}: {
  evidence: readonly EvidenceItemView[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
}) {
  const selected = evidence.find((item) => item.evidenceCode === selectedCode) ?? evidence[0];
  useEffect(() => {
    if (selectedCode) document.getElementById('selected-evidence')?.focus({ preventScroll: true });
  }, [selectedCode]);
  return (
    <Card>
      <CardHeader
        title="Сверка с источником"
        icon={<Library aria-hidden="true" />}
        description="Нажмите на источник под утверждением — он откроется здесь, рядом с текстом."
      />
      <CardBody className="flex flex-col gap-3">
        <label htmlFor="review-source" className="text-sm font-medium">
          Источник ({evidence.length})
        </label>
        <Select
          id="review-source"
          value={selected?.evidenceCode ?? ''}
          onChange={(event) => onSelect(event.target.value)}
        >
          {!evidence.length ? <option value="">Источников нет</option> : null}
          {evidence.map((item) => (
            <option key={item.evidenceCode} value={item.evidenceCode}>
              {item.kindLabel} · {item.evidenceCode}
            </option>
          ))}
        </Select>
        <div
          id="selected-evidence"
          tabIndex={-1}
          aria-label="Выбранный источник"
          className="rounded-2xl outline-offset-2"
        >
          {selected ? (
            <EvidenceCard evidence={selected} />
          ) : (
            <Callout tone="warning" title="Источники отсутствуют">
              Проверьте основания перед публикацией.
            </Callout>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
