import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';

import { QueryProvider } from '@/lib/query';

import '@/styles/globals.css';

/**
 * Шрифт подключается через next/font: файлы скачиваются при сборке и отдаются
 * с собственного домена. Внешних запросов к шрифтовому CDN во время работы нет.
 */
const manrope = Manrope({
  /*
   * Без списка weight подключается переменное начертание (200–800). Со
   * статическим списком 400/500/600/700 промежуточные значения не
   * существовали: заголовки с font-weight 650 из базовых стилей округлялись
   * до 700 или дорисовывались синтетикой.
   */
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-ui',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'Контекст',
  description: 'Оценка сотрудников по конкретному вопросу руководителя.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={manrope.variable}>
      <body>
        <a href="#main" className="skip-link">
          Перейти к содержимому
        </a>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
