import { ArrowRight, CalendarDays } from 'lucide-react';

import type { EmployeeAssessment } from '@context/contracts';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

const tones: Record<EmployeeAssessment['status'], BadgeTone> = {
  new: 'accent',
  in_progress: 'warning',
  submitted: 'info',
  report_preparing: 'info',
  completed: 'success',
  expired: 'danger',
  cancelled: 'neutral',
};

export function AssessmentCard({
  assessment,
  primary = false,
}: {
  assessment: EmployeeAssessment;
  primary?: boolean;
}) {
  return (
    <Card>
      <CardHeader
        eyebrow={primary ? 'Сейчас' : undefined}
        title={assessment.title}
        action={<Badge tone={tones[assessment.status]}>{assessment.statusLabel}</Badge>}
        description={`${assessment.submittedCount} из ${assessment.methodCount} этапов отправлено`}
      />
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]">
          <CalendarDays aria-hidden="true" className="size-4" />
          <span>
            {assessment.dueAt ? `Срок до ${formatDate(assessment.dueAt)}` : 'Срок не ограничен'}
          </span>
        </div>
        <ButtonLink
          href={`/employee/assessments/${assessment.id}`}
          variant={primary ? 'primary' : 'secondary'}
          className="self-start"
          icon={<ArrowRight aria-hidden="true" />}
        >
          {assessment.actionLabel ?? 'Открыть'}
        </ButtonLink>
      </CardBody>
    </Card>
  );
}
