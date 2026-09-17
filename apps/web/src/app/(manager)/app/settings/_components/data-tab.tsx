import { FileClock, ShieldCheck } from 'lucide-react';

import type { Envelope, OrganizationSummary } from '@context/contracts';

import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states';
import { useApiQuery } from '@/lib/query';

const MODE_LABEL: Record<OrganizationSummary['mode'], string> = {
  demo: 'Демонстрационный',
  research: 'Исследовательский',
  validated_use: 'Проверенное использование',
};

/**
 * Раздел «Данные»: политика хранения, статус договоров, запросы на экспорт
 * и удаление. У backend пока нет соответствующих ручек — раздел не
 * притворяется рабочим, но сохраняет структуру, чтобы её было легко
 * подключить, когда API появится.
 */
export function DataTab({ organizationId }: { organizationId: string }) {
  const orgQuery = useApiQuery<Envelope<OrganizationSummary>>(
    ['org', organizationId],
    `/orgs/${organizationId}`,
  );

  if (orgQuery.error) {
    return (
      <ErrorState
        title="Не удалось загрузить сведения об организации"
        requestId={orgQuery.error.problem.requestId}
        onRetry={orgQuery.refetch}
      />
    );
  }

  if (!orgQuery.data) {
    return <PageSkeleton variant="form" label="Загружаем сведения" />;
  }

  const organization = orgQuery.data.data;

  return (
    <div className="flex flex-col gap-5">
      <Callout tone="info" title="Текущий режим данных" icon={<ShieldCheck aria-hidden="true" />}>
        Организация работает в режиме «{MODE_LABEL[organization.mode]}»
        {organization.mode === 'demo'
          ? ': все участники и ответы синтетические, реальные оценки заблокированы.'
          : '.'}{' '}
        Подробности — на вкладке «Организация», в блоке готовности к реальным оценкам.
      </Callout>

      <Card>
        <CardHeader
          title="Политика хранения и статус договоров"
          description="Сроки хранения ответов и статус подписанных договоров об обработке данных."
        />
        <CardBody>
          <EmptyState
            compact
            icon={<FileClock aria-hidden="true" />}
            title="Пока не подключено"
            description="Управление политикой хранения и статусом договоров появится здесь, когда будет готов соответствующий раздел backend. Пока условия хранения определяются общими правилами платформы."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Запросы на экспорт и удаление данных"
          description="Обращения проходят стадии: ожидает → одобрено → выполняется → завершено или отклонено."
        />
        <CardBody>
          <EmptyState
            compact
            title="Эта возможность появится"
            description="Оформление запроса на экспорт или удаление данных организации станет доступно здесь после того, как заработает соответствующий backend-эндпоинт. Обратитесь к администратору платформы, если запрос нужен уже сейчас."
          />
        </CardBody>
      </Card>
    </div>
  );
}
