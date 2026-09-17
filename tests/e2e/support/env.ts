import { test } from '@playwright/test';

import { SYNTHETIC_ACCOUNTS } from '@context/testing';

/**
 * Учётные записи для E2E.
 *
 * Пароли берутся только из окружения: seed генерирует их при каждом запуске
 * и нигде не сохраняет. В файлах репозитория паролей нет и быть не должно.
 * Адреса по умолчанию — синтетические из packages/testing.
 */
export type E2eRole = 'admin' | 'managerA' | 'managerB' | 'reviewerA';

const ROLE_ENV: Readonly<Record<E2eRole, { prefix: string; accountKey: string }>> = {
  admin: { prefix: 'E2E_ADMIN', accountKey: 'admin' },
  managerA: { prefix: 'E2E_MANAGER_A', accountKey: 'manager_a' },
  managerB: { prefix: 'E2E_MANAGER_B', accountKey: 'manager_b' },
  reviewerA: { prefix: 'E2E_REVIEWER_A', accountKey: 'reviewer_a' },
};

export interface E2eCredentials {
  readonly email: string;
  readonly password: string;
}

function defaultEmail(accountKey: string): string {
  const account = SYNTHETIC_ACCOUNTS.find((item) => item.key === accountKey);
  if (!account) {
    throw new Error(`В packages/testing нет синтетической учётной записи ${accountKey}`);
  }
  return account.email;
}

/** Учётные данные роли или null, если пароль не задан. */
export function credentialsFor(role: E2eRole): E2eCredentials | null {
  const { prefix, accountKey } = ROLE_ENV[role];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!password) {
    return null;
  }
  return { email: process.env[`${prefix}_EMAIL`] ?? defaultEmail(accountKey), password };
}

/**
 * Пропускает тест, если для нужных ролей не заданы пароли.
 * Причина называет переменные, а не значения.
 *
 * При `E2E_REQUIRE_CREDENTIALS=1` (режим CI) пропуск запрещён: прогон без
 * учётных данных обязан падать, иначе «9 skipped, exit 0» неотличимо от
 * успешной проверки.
 */
export function requireRoles(...roles: E2eRole[]): void {
  const missing = roles
    .filter((role) => credentialsFor(role) === null)
    .map((role) => `${ROLE_ENV[role].prefix}_PASSWORD`);
  if (missing.length === 0) {
    return;
  }
  const hint = `Не заданы переменные ${missing.join(', ')}. Выполните npm run db:seed:demo и передайте выданные пароли через окружение (см. tests/e2e/README.md).`;
  if (isCredentialsRequired()) {
    throw new Error(
      `${hint} Режим E2E_REQUIRE_CREDENTIALS=1 не разрешает пропускать проверки без учётных данных.`,
    );
  }
  test.skip(true, hint);
}

/** Признак режима, в котором отсутствие учётных данных — ошибка, а не пропуск. */
export function isCredentialsRequired(): boolean {
  const value = process.env.E2E_REQUIRE_CREDENTIALS;
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

export function mustCredentials(role: E2eRole): E2eCredentials {
  const credentials = credentialsFor(role);
  if (!credentials) {
    throw new Error(`Пароль для ${ROLE_ENV[role].prefix} не задан в окружении`);
  }
  return credentials;
}
