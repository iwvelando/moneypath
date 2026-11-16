import { expect, test } from '@playwright/test';
import { openApp, overflow, problems } from './helpers';

// An error appears under the field it is about as it is typed, the run bar
// counts what is left and leads to it, and nothing is said anywhere else.
test('an error shows under its field, and a refused run leads back to it', async ({ page }) => {
  const found = problems(page);
  await openApp(page);

  await page.getByRole('button', { name: 'Edit Brokerage' }).click();
  const rate = page.getByRole('textbox', { name: 'Withdrawal tax rate', exact: true });
  await rate.fill('-1');
  await rate.blur();
  const field = page.locator('[data-path="common.investments.0.withdrawalTaxRate"]');
  await expect(field.locator('.field__message.is-error')).toHaveText(
    'The withdrawal tax rate must be at least 0 and less than 100.',
  );
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.workbar__error')).toHaveCount(0);
  expect(await overflow(page), 'field error').toBeLessThanOrEqual(0);

  // Collapsed, the entry still says to look inside.
  await page.getByRole('button', { name: 'Collapse Brokerage' }).click();
  await expect(page.locator('.editor-card', { hasText: 'Brokerage' }).first().locator('.editor-card__notice')).toHaveText(
    'Check details',
  );

  await page.getByRole('button', { name: 'Jump to section' }).click();
  await page.getByRole('button', { name: 'Scenarios', exact: true }).click();
  await page.getByRole('button', { name: 'Run Forecast', exact: true }).click();
  await expect(page.locator('.workbar__error')).toContainText('One thing in your plan needs fixing');
  await expect(page.getByRole('tab', { name: 'Results' })).toBeDisabled();
  expect(await overflow(page), 'refused run').toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Show it' }).click();
  await expect(rate).toBeFocused();
  await expect(rate).toBeInViewport();

  await rate.fill('15');
  await expect(field.locator('.field__message')).toHaveCount(0);
  await expect(page.locator('.workbar__error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run Forecast', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');
  expect(found).toEqual([]);
});

// A warning never stops a run: it sits under its field in a quieter style,
// and comes with the results of the run it was raised for.
test('a warning shows under its field and with the results, and the forecast still runs', async ({ page }) => {
  const found = problems(page);
  await openApp(page);

  await page.getByRole('button', { name: 'Edit Car loan' }).click();
  await page.getByRole('textbox', { name: 'Mortgage insurance', exact: true }).fill('40');
  const warning = page.locator('[data-path="common.loans.0.mortgageInsuranceCutoff"] .field__message.is-warning');
  await expect(warning).toHaveText(/^Warning: With no cutoff/);
  await expect(page.locator('.field__message.is-error')).toHaveCount(0);
  expect(await overflow(page), 'field warning').toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Run Forecast', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-results .run-warnings')).toContainText('Baseline, loan “Car loan”: With no cutoff');
  expect(await overflow(page), 'results warnings').toBeLessThanOrEqual(0);
  expect(found).toEqual([]);
});
