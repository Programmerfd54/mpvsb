import type { EvidenceItemView } from '@context/contracts';

import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';

/** Same source presentation for the manager and reviewer; no source limitations are hidden. */
export function EvidenceCard({ evidence }: { evidence: EvidenceItemView }) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-nested)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="info">{evidence.kindLabel}</Badge>
        <span className="text-xs text-[var(--text-secondary)]">
          {formatDateTime(evidence.collectedAt)}
        </span>
      </div>
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
        {evidence.content}
      </p>
      {evidence.kindLimit || evidence.limitations.length ? (
        <div className="border-t border-[var(--border-subtle)] pt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          <p className="mb-1 font-semibold">Как читать этот источник</p>
          {evidence.kindLimit ? <p>{evidence.kindLimit}</p> : null}
          {evidence.limitations.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {evidence.limitations.map((limit, index) => (
                <li key={index}>{limit}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
