'use client';

import type { ReactNode } from 'react';

import { PageTransition } from '@/components/ui/motion';

/** Мягкое появление страницы. Layout с навигацией при переходе не перерисовывается. */
export default function AdminTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
