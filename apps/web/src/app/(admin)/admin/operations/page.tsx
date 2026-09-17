'use client';

import { useState } from 'react';

import type { AdminOperationsFacets, Envelope } from '@context/contracts';

import { PageHeader } from '@/components/layout/page-header';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useApiQuery } from '@/lib/query';

import { AuditPanel } from './_components/audit-panel';
import { JobsPanel } from './_components/jobs-panel';

type Tab = 'jobs' | 'audit';

/**
 * Обработка и аудит.
 *
 * Показываются идентификаторы, типы и коды ошибок. Полезная нагрузка заданий,
 * ответы участников и тексты заключений сюда не попадают (ТЗ A09, A11).
 */
export default function AdminOperationsPage() {
  const [tab, setTab] = useState<Tab>('jobs');

  // Справочник фильтров — вспомогательное: без него экран остаётся рабочим,
  // поэтому ошибка запроса нигде отдельно не показывается.
  const { data: facetsResponse } = useApiQuery<Envelope<AdminOperationsFacets>>(
    ['admin-operations-facets'],
    '/admin/operations/facets',
    { staleTime: 5 * 60_000 },
  );
  const facets = facetsResponse?.data ?? null;

  return (
    <>
      <PageHeader
        title="Обработка и аудит"
        description="Технические сведения без содержания оценок: ответы участников и тексты заключений на этих экранах не показываются."
      />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        label="Разделы эксплуатации"
        items={[
          { value: 'jobs', label: 'Обработка' },
          { value: 'audit', label: 'Аудит' },
        ]}
      >
        <TabPanel value="jobs">
          <JobsPanel facets={facets} />
        </TabPanel>
        <TabPanel value="audit">
          <AuditPanel facets={facets} />
        </TabPanel>
      </Tabs>
    </>
  );
}
