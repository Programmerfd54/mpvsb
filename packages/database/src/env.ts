/**
 * Конфигурация подключений. Реальные значения приходят из окружения или secret manager.
 * В репозитории хранится только `.env.example` с placeholder-значениями.
 */

export type DatabaseRole = 'migrator' | 'api' | 'worker' | 'evaluator';

const ENV_KEYS: Readonly<Record<DatabaseRole, string>> = {
  migrator: 'DATABASE_URL_MIGRATOR',
  api: 'DATABASE_URL_API',
  worker: 'DATABASE_URL_WORKER',
  evaluator: 'DATABASE_URL_EVALUATOR',
};

export function databaseUrl(role: DatabaseRole): string {
  const key = ENV_KEYS[role];
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `Не задана переменная окружения ${key}. Скопируйте .env.example в .env и заполните подключение.`,
    );
  }
  return value;
}

export function optionalDatabaseUrl(role: DatabaseRole): string | null {
  const value = process.env[ENV_KEYS[role]];
  return value && value.trim() !== '' ? value : null;
}

/** Пароли runtime-ролей задаёт окружение; в SQL-миграциях их нет. */
export function runtimeRolePasswords(): Readonly<Record<'api' | 'worker' | 'evaluator', string>> {
  const read = (key: string): string => {
    const value = process.env[key];
    if (!value || value.length < 8) {
      throw new Error(`Не задан или слишком короткий пароль роли: ${key} (минимум 8 символов).`);
    }
    return value;
  };
  return {
    api: read('DB_PASSWORD_API'),
    worker: read('DB_PASSWORD_WORKER'),
    evaluator: read('DB_PASSWORD_EVALUATOR'),
  };
}

export function isProductionLike(): boolean {
  const env = (process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development').toLowerCase();
  return env === 'production' || env === 'staging';
}
