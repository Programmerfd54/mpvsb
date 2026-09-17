import { existsSync } from 'node:fs';

import { chromium, defineConfig, devices } from '@playwright/test';

/**
 * E2E-проверки платформы.
 *
 * Проекты:
 *   api      — сценарии безопасности и сквозной путь на уровне HTTP API, без браузера;
 *   chromium — UI-сценарии трёх ролей (появятся после редизайна интерфейса).
 *
 * Тесты работают против уже запущенных dev-серверов и базы с синтетическим seed:
 * сами серверы здесь не поднимаются (см. tests/e2e/README.md).
 *
 * Артефакты: trace, screenshot и video выключены везде и включаться по умолчанию
 * не должны. Trace записывает тела запросов и cookie — то есть пароль синтетической
 * учётной записи из POST /auth/login и значения сессионных cookie попали бы в
 * trace.zip и в html-отчёт. Правило «пароли, токены и секреты не сохраняются в
 * файлы, логи и отчёты» (ТЗ 12.5) сильнее удобства отладки: trace включается
 * вручную на время одного локального прогона (`--trace on`), а полученный
 * test-results/ удаляется и никуда не выгружается.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const isCi = Boolean(process.env.CI);

/**
 * Путь к chromium.
 *
 * Установленная сборка браузера может не совпадать с версией @playwright/test
 * (тогда запуск падал бы с «Executable doesn't exist»). Путь берётся из
 * E2E_CHROMIUM_PATH либо из реестра Playwright, и только если файл существует.
 * Если браузера нет, проект chromium пропускает свои тесты с объяснением
 * (tests/e2e/ui/smoke.spec.ts), а npm run test:e2e не падает.
 */
function resolveChromiumPath(): string | null {
  const explicit = process.env.E2E_CHROMIUM_PATH;
  if (explicit) {
    return existsSync(explicit) ? explicit : null;
  }
  try {
    const installed = chromium.executablePath();
    return installed && existsSync(installed) ? installed : null;
  } catch {
    return null;
  }
}

const chromiumPath = resolveChromiumPath();
// Читается тестами UI: без браузера они пропускаются с причиной, а не падают.
process.env.E2E_CHROMIUM_READY = chromiumPath ? '1' : '';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/e2e',
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: isCi ? 1 : 2,
  /*
   * Сквозной путь ждёт worker: общий лимит больше стандартных 30 секунд.
   * Наблюдавшийся разброс подготовки заключения на общем dev-стенде — от 25 с
   * до 150 с (диспетчер outbox опрашивает очередь пакетами, а стенд делят
   * параллельные прогоны). В лимит теста входит и ожидание черновика
   * (E2E_WORKER_TIMEOUT_MS), и уборка черновика в finally (E2E_CLEANUP_WAIT_MS).
   */
  timeout: 360_000,
  expect: { timeout: 10_000 },
  /*
   * Репортёр только текстовый. html-отчёт копирует к себе вложения (trace, тела
   * запросов) и приглашает выгрузить каталог как артефакт CI — до отдельного
   * решения о безопасной выгрузке его здесь нет.
   */
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'ru-RU',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'api',
      testMatch: 'api/**/*.spec.ts',
      use: {
        trace: 'off',
        // Только для HTTP-проекта: браузеру такой Accept ломал бы согласование содержимого.
        extraHTTPHeaders: { accept: 'application/json' },
      },
    },
    {
      name: 'chromium',
      testMatch: 'ui/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        trace: 'off',
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
});
