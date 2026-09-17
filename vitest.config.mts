import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * NestJS использует `emitDecoratorMetadata` для внедрения зависимостей.
 * esbuild, которым vitest транслирует TypeScript по умолчанию, эту возможность
 * не поддерживает, поэтому файлы API проходят через SWC — как и при запуске dev.
 */
const swcPlugin = swc.vite({
  module: { type: 'es6' },
  jsc: {
    target: 'es2023',
    parser: { syntax: 'typescript', decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
    keepClassNames: true,
  },
});

/**
 * Два набора проверок:
 *   unit        — чистые правила, схемы, подсчёт. Без внешних зависимостей.
 *   integration — реальный PostgreSQL. Проверяет RLS, права ролей и транзакции
 *                 под runtime-пользователем, а не под владельцем схемы.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [swcPlugin],
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [swcPlugin],
        test: {
          name: 'integration',
          include: [
            'packages/*/tests/**/*.integration.test.ts',
            'apps/*/tests/**/*.integration.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**'],
          environment: 'node',
          globalSetup: ['./tests/setup/migrate-test-db.ts'],
          setupFiles: ['./tests/setup/load-test-env.ts'],
          hookTimeout: 60_000,
          testTimeout: 30_000,
          // Тесты изоляции делят одну базу: параллельные файлы дали бы гонки состояния.
          fileParallelism: false,
        },
      },
    ],
  },
});
