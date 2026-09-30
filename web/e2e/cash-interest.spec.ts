import { expect, test, type Page } from '@playwright/test';
import { openApp, runForecast } from './helpers';

/** The liquid figure in the last row of the results table, as a number. */
async function finalLiquid(page: Page): Promise<number> {
  const cell = page.locator('.results-table tbody tr.month-row').last().locator('td').first();
  const text = await cell.innerText();
  return Number(text.replace(/[^0-9.-]/g, ''));
}

// The real engine, in the browser, honours the rate typed into the editor:
// the same plan ends with more cash than it does at the default of 0%.
test('a cash interest rate grows cash in the real engine', async ({ page }) => {
  await openApp(page);
  await runForecast(page);
  const withoutInterest = await finalLiquid(page);

  await page.getByRole('tab', { name: 'Planning Workspace' }).click();
  const rate = page.getByRole('textbox', { name: 'Cash interest rate', exact: true });
  await rate.fill('4');
  await rate.blur();
  await runForecast(page);
  const withInterest = await finalLiquid(page);

  expect(withInterest).toBeGreaterThan(withoutInterest);

  // Back to the default: the plan reproduces the original numbers exactly.
  await page.getByRole('tab', { name: 'Planning Workspace' }).click();
  await rate.fill('');
  await rate.blur();
  await runForecast(page);
  expect(await finalLiquid(page)).toBe(withoutInterest);
});
