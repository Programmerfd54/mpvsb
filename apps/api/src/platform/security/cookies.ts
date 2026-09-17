import type { CookieSerializeOptions } from '@fastify/cookie';

import { loadConfig } from '../config/env';

/**
 * Имена cookie различаются по типу доступа: одновременно открытые кабинеты
 * руководителя и участника не объединяют права (ТЗ 10.2).
 * В production используется префикс `__Host-`: Secure, Path=/, без Domain.
 */
export type SessionCookieKind = 'app' | 'participant';

export function sessionCookieName(kind: SessionCookieKind): string {
  const config = loadConfig();
  // Локальный HTTP не поддерживает `__Host-`; отдельное имя не ослабляет production.
  return config.COOKIE_SECURE ? `__Host-${kind}_session` : `dev_${kind}_session`;
}

export function csrfCookieName(): string {
  const config = loadConfig();
  return config.COOKIE_SECURE ? '__Host-csrf' : 'dev_csrf';
}

export function sessionCookieOptions(maxAgeSeconds: number): CookieSerializeOptions {
  const config = loadConfig();
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** CSRF-токен читается клиентским кодом, поэтому httpOnly здесь неприменим. */
export function csrfCookieOptions(maxAgeSeconds: number): CookieSerializeOptions {
  const config = loadConfig();
  return {
    httpOnly: false,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function clearedCookieOptions(): CookieSerializeOptions {
  const config = loadConfig();
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  };
}
