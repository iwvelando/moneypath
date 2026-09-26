import { expect, test } from '@playwright/test';
import { openApp, overflow, problems, runForecast } from './helpers';

// Safari's engine on an iPhone profile, which every iOS browser uses. Runs in
// the `webkit` project only (`make test-webkit`, and the macOS CI job).
test('an iPhone loads the engine, runs a forecast, and never scrolls sideways', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  expect(await overflow(page), 'workspace').toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Jump to section' }).tap();
  await page.getByRole('button', { name: 'Common settings', exact: true }).tap();
  await expect(page.locator('#section-common')).toBeFocused();
  const optimizer = page.getByRole('button', { name: /^Optimizer:/ });
  await optimizer.tap();
  await expect(page.getByRole('checkbox', { name: 'Run the optimizer' })).toBeVisible();
  expect(await overflow(page), 'optimizer panel').toBeLessThanOrEqual(0);
  await optimizer.tap();
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


test('a pointer selection works after keyboard focus in the workbar', async ({ page }) => {
  await openApp(page);
  const jump = page.getByRole('button', { name: 'Jump to section' });
  await jump.focus();
  await jump.press('Enter');
  await page.getByRole('button', { name: 'Common settings', exact: true }).click();
  await expect(page.locator('#section-common')).toBeFocused();
  const optimizer = page.getByRole('button', { name: /^Optimizer:/ });
  await optimizer.focus();
  await optimizer.press('Enter');
  const toggle = page.getByRole('checkbox', { name: 'Run the optimizer' });
  await toggle.setChecked(true);
  await expect(toggle).toBeChecked();
  await jump.click();
  await expect(jump).toHaveAttribute('aria-expanded', 'true');
  await expect(optimizer).toHaveAttribute('aria-expanded', 'false');
});
