import { Copy } from 'lucide-react';

import type { IssuedLink } from '@context/contracts';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/states';
import { notify } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';

/**
 * Одноразовая ссылка активации: показывается один раз, дальше не хранится.
 * Копирование — в буфер обмена, не в URL и не в localStorage.
 */
export function IssuedLinkPanel({ link }: { link: IssuedLink }) {
  if (!link.secretAvailable) {
    return (
      <Callout tone="warning" title="Ссылка недоступна">
        Секрет уже был получен ранее и не сохраняется. Выпустите новую ссылку.
      </Callout>
    );
  }

  return (
    <Callout tone="info" title="Ссылка показывается один раз">
      <p>
        Передайте её сотруднику принятым у вас способом. Действует до{' '}
        {formatDateTime(link.expiresAt)}.
      </p>
      <code className="mt-3 block overflow-x-auto rounded-[var(--radius-control)] bg-[var(--bg-surface)] p-2.5 text-xs">
        {link.url}
      </code>
      <div className="mt-3">
        <Button
          variant="secondary"
          size="sm"
          icon={<Copy aria-hidden="true" />}
          onClick={() => {
            void navigator.clipboard.writeText(link.url);
            notify.success('Ссылка скопирована');
          }}
        >
          Скопировать ссылку
        </Button>
      </div>
    </Callout>
  );
}
