import type { ReportDetail } from '@context/contracts';
import { computeChecks } from '@/lib/report-checks';
import { Callout } from '@/components/ui/states';

export { computeChecks } from '@/lib/report-checks';

export function ChecksTab({ report }: { report: ReportDetail }) {
  const checks = computeChecks(report);

  return (
    <div className="flex flex-col gap-4">
      <Callout tone="neutral" title="Это подсказки, а не гарантия">
        Проверки считаются по уже загруженному черновику и не заменяют разбор рецензента: они не
        подтверждают научную обоснованность методик и не проверяют факты за пределами платформы.
      </Callout>

      {checks.map((check) => (
        <Callout key={check.id} tone={check.ok ? 'success' : 'warning'} title={check.label}>
          {check.detail}
        </Callout>
      ))}
    </div>
  );
}
