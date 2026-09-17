import { Compass } from 'lucide-react';

import { ButtonLink } from '@/components/ui/button';
import { AuthCard } from '@/components/layout/auth-layout';

/**
 * Страница не найдена.
 *
 * Тот же публичный каркас, что у входа и приглашения: логомарк, тёплый фон,
 * карточка по центру. Текст одинаков для несуществующего и недоступного
 * адреса: по ответу нельзя судить, существует ли объект в другой
 * организации (ТЗ A14).
 */
export default function NotFound() {
  return (
    <AuthCard
      icon={<Compass aria-hidden="true" strokeWidth={1.75} />}
      tintClassName="bg-[var(--sky-soft)] text-[var(--sky-ink)]"
      title="Страница не найдена"
      description="Адрес не существует или у вас нет к нему доступа. Вернитесь в рабочее пространство."
    >
      <div className="mt-6">
        {/* ButtonLink, а не <a href>: переход внутри приложения без перезагрузки. */}
        <ButtonLink href="/app" variant="primary">
          В рабочее пространство
        </ButtonLink>
      </div>
    </AuthCard>
  );
}
