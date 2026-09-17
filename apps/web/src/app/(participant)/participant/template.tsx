'use client';

import type { ReactNode } from 'react';

import { PageTransition } from '@/components/ui/motion';

/** Мягкое появление страницы. Верхняя строка оболочки при переходе не перерисовывается. */
export default function ParticipantTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
