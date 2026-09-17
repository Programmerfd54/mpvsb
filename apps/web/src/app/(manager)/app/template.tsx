'use client';

import type { ReactNode } from 'react';

import { PageTransition } from '@/components/ui/motion';

/** Мягкое появление страницы. Layout с навигацией при переходе не перерисовывается. */
export default function ManagerTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
