import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// Окружение монорепозитория лежит в корне, а не рядом с приложением.
loadEnv({ path: path.join(process.cwd(), '..', '..', '.env'), quiet: true });

/** Внутренний адрес API. В production запросы идут через общий reverse proxy. */
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Next создаёт собственные AGENTS.md/CLAUDE.md. В этом репозитории инструкции
  // для разработки живут в корневом CLAUDE.md и генерируются из docs/.
  agentRules: false,

  // Плашка dev-индикатора перекрывает интерфейс на скриншотах. Ошибки сборки
  // и рантайма по-прежнему показываются overlay.
  devIndicators: false,

  /**
   * API отдаётся с того же origin, что и страницы.
   *
   * Это не косметика: cookie сессии остаются first-party, CORS открывать не нужно,
   * а CSRF-проверка по Origin работает так же, как в production за общим proxy
   * (ТЗ 06.2).
   */
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` },
      { source: '/health/:path*', destination: `${apiInternalUrl}/health/:path*` },
    ];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        // Страницы кабинетов и участия персональны: общий кэш недопустим.
        source: '/(app|admin|participant|participate)/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
};

export default config;
