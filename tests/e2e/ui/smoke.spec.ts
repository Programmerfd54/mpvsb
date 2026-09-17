import { expect, test } from '@playwright/test';

import { isCredentialsRequired } from '../support/env';

/**
 * Единственный UI-сценарий на время редизайна: проверяет, что проект chromium
 * настроен и страница входа отдаётся. Полные сценарии трёх ролей, проверки
 * доступности и мобильные размеры добавляются после редизайна (см. README).
 */
const chromiumReady = Boolean(process.env.E2E_CHROMIUM_READY);

test.describe('UI: страница входа', () => {
  /*
   * Браузер тесты не скачивают. Локально отсутствие сборки chromium (или
   * несовпадение её версии с @playwright/test) даёт пропуск с названной
   * командой установки, и npm run test:e2e не падает.
   *
   * В режиме E2E_REQUIRE_CREDENTIALS=1 пропуск запрещён так же, как и пропуск
   * без паролей: иначе прогон без `npx playwright install` был бы зелёным
   * вообще без единой проверки интерфейса — ровно та ложная зелёность, ради
   * которой переменная и вводилась.
   */
  test.beforeAll(() => {
    if (!chromiumReady && isCredentialsRequired()) {
      throw new Error(
        'Chromium не установлен. Выполните npx playwright install chromium или укажите путь в E2E_CHROMIUM_PATH. ' +
          'Режим E2E_REQUIRE_CREDENTIALS=1 не разрешает пропускать проверки интерфейса.',
      );
    }
  });

  test.skip(
    !chromiumReady && !isCredentialsRequired(),
    'Chromium не установлен. Выполните npx playwright install chromium или укажите путь в E2E_CHROMIUM_PATH (см. tests/e2e/README.md).',
  );

  test('страница входа открывается', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status(), 'страница входа должна отвечать успешно').toBeLessThan(400);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
