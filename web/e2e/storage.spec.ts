import { expect, test } from '@playwright/test';
import { openApp, problems, runForecast } from './helpers';

// Persistence is optional: private windows and locked-down browsers throw on
// any localStorage access, and the planner must still work.
test('forecasts still run when storage is denied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  const found = problems(page);
  await openApp(page);
  await runForecast(page);
  expect(found.filter((text) => !text.includes('denied'))).toEqual([]);
});
