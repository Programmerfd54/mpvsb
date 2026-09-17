'use client';

import { Monogram } from '@/components/ui/avatar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KeyValueList } from '@/components/ui/data-list';
import { PageHeader } from '@/components/layout/manager-shell';
import { PageSkeleton } from '@/components/ui/states';
import { useSession } from '@/lib/session';

import { ChangePasswordCard } from './_components/change-password-card';
import { SessionsCard } from './_components/sessions-card';

export default function ProfilePage() {
  const session = useSession();

  if (session.status === 'loading') {
    return <PageSkeleton variant="form" label="Загружаем профиль" />;
  }

  if (!session.profile) {
    // Анонимный доступ сюда не должен попадать: оболочка кабинета проверяет
    // вход раньше. Показываем скелетон, а не пустую страницу, пока оболочка
    // решает, что делать дальше (перенаправление или собственная ошибка).
    return <PageSkeleton variant="form" label="Проверяем доступ" />;
  }

  return (
    <>
      <PageHeader title="Профиль" description="Учётная запись и активные сессии." />

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Учётная запись" />
          <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <Monogram name={session.profile.displayName} seed={session.profile.userId} size="lg" />
            <KeyValueList
              className="flex-1"
              columns={2}
              items={[
                { label: 'Имя', value: session.profile.displayName },
                { label: 'Email', value: session.profile.email },
                {
                  label: 'Роль',
                  value: 'Свою роль изменить нельзя: доступы выдаёт владелец организации.',
                },
              ]}
            />
          </CardBody>
        </Card>

        <ChangePasswordCard />

        <SessionsCard />
      </div>
    </>
  );
}
