import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ParticipantShell } from '@/components/layout/participant-shell';
import { ToastHost } from '@/components/ui/toast';

export const metadata: Metadata = { title: 'Участие в оценке' };

/**
 * Оболочка участника.
 *
 * Без корпоративной навигации, списков людей и рейтингов: у участника одна
 * задача — спокойно ответить на вопросы. Уведомления живут рядом с оболочкой,
 * а не внутри <main>, чтобы не появлялся вложенный landmark.
 */
export default function ParticipantLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ParticipantShell>{children}</ParticipantShell>
      <ToastHost />
    </>
  );
}
