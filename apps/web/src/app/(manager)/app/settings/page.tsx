'use client';

import { useState } from 'react';
import { Database, KeyRound, ShieldCheck } from 'lucide-react';

import { PageHeader } from '@/components/layout/manager-shell';
import { ForbiddenState, PageSkeleton } from '@/components/ui/states';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useSession } from '@/lib/session';

import { AccessGrantsSection } from './_components/access-grants-section';
import { DataTab } from './_components/data-tab';
import { MembersSection } from './_components/members-section';
import { OrganizationTab } from './_components/organization-tab';

type SettingsTab = 'organization' | 'access' | 'data';

export default function SettingsPage() {
  const session = useSession();
  const [tab, setTab] = useState<SettingsTab>('organization');

  if (session.status === 'loading') {
    return <PageSkeleton variant="form" label="Проверяем доступ к настройкам" />;
  }

  if (session.status === 'error') {
    return <ForbiddenState description="Не удалось проверить права доступа. Обновите страницу." />;
  }

  const organizationId = session.organization?.organizationId;
  const canManage = session.has('org.manage');

  if (!organizationId || !canManage) {
    return (
      <ForbiddenState description="Настройки организации доступны владельцу — тому, у кого есть право «Управление организацией и доступами». Обратитесь к владельцу, если доступ нужен вам." />
    );
  }

  return (
    <>
      <PageHeader
        title="Настройки"
        description="Организация, доступы и данные. Изменения применяются к будущим назначениям: уже зафиксированные условия участия не переписываются."
      />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as SettingsTab)}
        label="Разделы настроек"
        items={[
          {
            value: 'organization',
            label: 'Организация',
            icon: <ShieldCheck aria-hidden="true" strokeWidth={1.75} />,
          },
          {
            value: 'access',
            label: 'Доступы',
            icon: <KeyRound aria-hidden="true" strokeWidth={1.75} />,
          },
          {
            value: 'data',
            label: 'Данные',
            icon: <Database aria-hidden="true" strokeWidth={1.75} />,
          },
        ]}
      >
        <TabPanel value="organization">
          <OrganizationTab organizationId={organizationId} />
        </TabPanel>
        <TabPanel value="access">
          <div className="flex flex-col gap-5">
            <MembersSection organizationId={organizationId} />
            <AccessGrantsSection organizationId={organizationId} />
          </div>
        </TabPanel>
        <TabPanel value="data">
          <DataTab organizationId={organizationId} />
        </TabPanel>
      </Tabs>
    </>
  );
}
