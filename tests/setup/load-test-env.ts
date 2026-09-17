/**
 * Подменяет рабочие подключения на тестовые до импорта приложения.
 * Тесты никогда не должны попасть в базу разработки или production.
 */
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: new URL('../../.env', import.meta.url).pathname, quiet: true });

const REQUIRED = [
  'TEST_DATABASE_URL_MIGRATOR',
  'TEST_DATABASE_URL_API',
  'TEST_DATABASE_URL_WORKER',
  'TEST_DATABASE_URL_EVALUATOR',
] as const;

for (const key of REQUIRED) {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Не задана ${key}. Поднимите тестовую базу: docker compose -f infra/compose.yaml up -d postgres-test`,
    );
  }
  process.env[key.replace('TEST_', '')] = value;
}

process.env.APP_ENV = 'test';
process.env.NODE_ENV = 'test';
