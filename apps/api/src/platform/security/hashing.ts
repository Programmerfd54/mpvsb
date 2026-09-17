import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import argon2 from 'argon2';

import { loadConfig } from '../config/env';

/**
 * Пароли: Argon2id. Параметры соответствуют рекомендациям OWASP на дату разработки
 * и подлежат перепроверке на целевом окружении (ТЗ 10.2).
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export async function hashPassword(password: string): Promise<string> {
  assertPasswordLength(password);
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function assertPasswordLength(password: string): void {
  // Пароль не обрезается: менеджеры паролей и вставка длинных строк должны работать.
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new RangeError(
      `Пароль должен содержать от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов.`,
    );
  }
}

/**
 * Секреты сессий и приглашений: 32 случайных байта в base64url.
 * В БД хранится только HMAC-SHA-256 — по содержимому таблицы ссылку не восстановить.
 */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashSecret(secret: string): string {
  const config = loadConfig();
  return createHmac('sha256', config.TOKEN_HASH_SECRET).update(secret).digest('hex');
}

/** Сравнение хэшей за постоянное время. */
export function secretsEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
