import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { config as loadDotenv } from 'dotenv';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Пересоздаёт тестовую схему перед набором integration-тестов.
 * Так проверки всегда идут на актуальных миграциях, а не на остатках прошлого запуска.
 */
export async function setup(): Promise<void> {
  loadDotenv({ path: join(root, '.env'), quiet: true });

  const env = { ...process.env };
  for (const key of [
    'DATABASE_URL_MIGRATOR',
    'DATABASE_URL_API',
    'DATABASE_URL_WORKER',
    'DATABASE_URL_EVALUATOR',
  ]) {
    const testValue = env[`TEST_${key}`];
    if (!testValue) {
      throw new Error(`Не задана TEST_${key} для integration-тестов.`);
    }
    env[key] = testValue;
  }
  env.APP_ENV = 'test';
  env.NODE_ENV = 'test';

  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(root, 'packages', 'database', 'src', 'cli', 'migrate.ts'),
      '--reset',
    ],
    { cwd: join(root, 'packages', 'database'), env, stdio: 'inherit' },
  );
}
