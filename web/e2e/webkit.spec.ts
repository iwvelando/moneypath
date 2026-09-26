import { expect, test } from '@playwright/test';
import { openApp, overflow, problems, runForecast } from './helpers';

// Safari's engine on an iPhone profile, which every iOS browser uses. Runs in
// the `webkit` project only (`make test-webkit`, and the macOS CI job).
test('an iPhone loads the engine, runs a forecast, and never scrolls sideways', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  expect(await overflow(page), 'workspace').toBeLessThanOrEqual(0);
  await runForecast(page);
  expect(await overflow(page), 'results').toBeLessThanOrEqual(0);
  await page.locator('.results-table').scrollIntoViewIfNeeded();
  expect(await overflow(page), 'results table').toBeLessThanOrEqual(0);
  const month = page.locator('.results-table').getByRole('button').first();
  await month.tap();
  await expect(month).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.month-details:not([hidden])')).toBeVisible();
  expect(await overflow(page), 'expanded events').toBeLessThanOrEqual(0);
  await month.tap();
  await expect(month).toHaveAttribute('aria-expanded', 'false');
  expect(found).toEqual([]);
});
