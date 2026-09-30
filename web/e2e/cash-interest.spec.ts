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

// A draft saved by an earlier version has no cash interest setting. The field
// must open blank (meaning the 0% default), not show "undefined".
test('a draft saved before cash interest existed opens with the field blank', async ({ page }) => {
  const oldDraft = {
    version: 1,
    config: {
      simulation: { startDate: '2025-01', endDate: '2030-01', startingCash: 1000, emergencyFundMonths: null },
      common: { events: [], loans: [], investments: [] },
      scenarios: [{ id: 's1', name: 'saved plan', active: true, events: [], loans: [], investments: [] }],
    },
  };
  await page.addInitScript((state) => {
    window.localStorage.setItem('moneypath.editor.v1', JSON.stringify(state));
  }, oldDraft);
  await openApp(page);

  const rate = page.getByRole('textbox', { name: 'Cash interest rate', exact: true });
  await expect(rate).toHaveValue('');
  await expect(page.getByText('Enter a number.')).toHaveCount(0);
  // The rest of the saved draft survived.
  await expect(page.getByRole('textbox', { name: 'Starting cash', exact: true })).toHaveValue('1000');
});
