import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { CHOICES_EXAMPLE, openApp, problems, runForecast, uploadChoices } from './helpers';

async function downloadConfig(page: Page): Promise<Record<string, unknown>> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Config' }).click();
  return parse(readFileSync(await (await download).path(), 'utf8')) as Record<string, unknown>;
}

/** Each body row of the guardrails table in view: the path, then each result. */
async function rows(page: Page, scope = page.locator('.guardrails').first()): Promise<string[][]> {
  return scope.locator('tbody tr').evaluateAll((trs) =>
    trs.map((tr) =>
      [...tr.querySelectorAll('th, td')].map((cell) => {
        const copy = cell.cloneNode(true) as HTMLElement;
        copy.querySelector('.figures-table__label')?.remove();
        return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
      }),
    ),
  );
}

test('an uploaded plan reports its guardrails on every scenario and keeps them', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  await uploadChoices(page);
  await runForecast(page);

  await page.getByRole('tab', { name: /^Compare/ }).click();
  const brokerage = 'Holds Tightest 2026-01, $40,600.00 left';
  const sold = 'Holds Debt-free from 2027-06, 31 months to spare';
  expect(await rows(page)).toEqual([
    [
      'as we are',
      'Holds Tightest 2026-01, $5,044.20 to spare',
      'Breaks in 2030-01 Owes $194,640.48 then; still owed at the end of the window',
      brokerage,
    ],
    ['sell', 'Holds Tightest 2026-01, $5,044.20 to spare', sold, brokerage],
    ['sell and freelance', 'Breaks in 2027-02 Tightest 2027-02, $4,441.15 short', sold, brokerage],
  ]);

  await page.getByRole('tab', { name: /^sell and freelance/ }).click();
  const card = page.locator('.summary__card', { has: page.getByRole('heading', { name: 'Guardrails' }) });
  await expect(card).toContainText('Cushion');
  await expect(card).toContainText('Mortgage gone by 2030 Holds Debt-free from 2027-06, 31 months to spare');
  await expect(card.locator('.is-negative')).toHaveText('Breaks in 2027-02');

  const written = await downloadConfig(page);
  const source = parse(readFileSync(CHOICES_EXAMPLE, 'utf8')) as Record<string, unknown>;
  expect(written['guardrails']).toEqual(source['guardrails']);
  expect(Object.keys(written).indexOf('guardrails')).toBe(Object.keys(written).indexOf('common') - 1);
  expect(found).toEqual([]);
});

test('a guardrail added in the editor is refused until it has a floor, then reported', async ({ page }) => {
  await openApp(page);
  const section = page.locator('#section-guardrails');
  await section.getByRole('button', { name: 'Add guardrail' }).click();
  await expect(section.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await section.getByRole('textbox', { name: 'Name', exact: true }).fill('Never overdrawn');

  await page.getByRole('button', { name: 'Run Forecast' }).first().click();
  await expect(page.locator('.workbar__error')).toContainText('needs fixing');
  await expect(section.locator('[data-path="guardrails.0.amount"]')).toContainText('The floor amount is required.');

  await section.getByRole('textbox', { name: 'Floor', exact: true }).fill('0');
  await section.getByRole('textbox', { name: 'Start month', exact: true }).pressSequentially('209901');
  await expect(section.locator('[data-path="guardrails.0.startDate"]')).toContainText(
    'Warning: This starts after the simulation ends',
  );
  await runForecast(page);
  const card = page.locator('.summary__card', { has: page.getByRole('heading', { name: 'Guardrails' }) });
  await expect(card).toContainText('Never overdrawn Does not apply');
});

test('the flip panel shows the flipped path’s guardrails beside the scenario’s', async ({ page }) => {
  await openApp(page);
  await uploadChoices(page);
  await runForecast(page);
  const flip = page.locator('.flip');
  await flip.getByRole('combobox', { name: 'Choice' }).selectOption({ label: 'Job' });
  await flip.getByRole('combobox', { name: 'Instead of Stay' }).selectOption({ label: 'Go freelance' });
  await expect(flip.locator('.guardrails')).toBeVisible();
  expect(await rows(page, flip.locator('.guardrails'))).toEqual([
    [
      'as we are',
      'Holds Tightest 2026-01, $5,044.20 to spare',
      'Breaks in 2030-01 Owes $194,640.48 then; still owed at the end of the window',
      'Holds Tightest 2026-01, $40,600.00 left',
    ],
    // Going freelance without selling: the months before freelance income starts cost the cushion.
    [
      'as we are (Job: Go freelance)',
      'Breaks in 2027-02 Tightest 2027-02, $3,141.15 short',
      'Breaks in 2030-01 Owes $194,640.48 then; still owed at the end of the window',
      'Holds Tightest 2026-01, $40,600.00 left',
    ],
  ]);
});

test('a debt-free and an investments-last built in the editor are checked and reported', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  await uploadChoices(page);
  const section = page.locator('#section-guardrails');
  const card = section.locator('.editor-card').last();

  await section.getByRole('button', { name: 'Add guardrail' }).click();
  await card.getByRole('textbox', { name: 'Name', exact: true }).fill('Mortgage gone by 2028');
  await card.getByRole('combobox', { name: 'Kind' }).selectOption({ label: 'Debt-free' });
  await page.getByRole('button', { name: 'Run Forecast' }).first().click();
  await expect(card.locator('[data-path="guardrails.3.startDate"]')).toContainText('Required');
  await card.getByRole('textbox', { name: 'Debt-free from', exact: true }).pressSequentially('202801');
  await card.getByRole('checkbox', { name: 'Mortgage' }).check();

  await section.getByRole('button', { name: 'Add guardrail' }).click();
  const lasts = section.locator('.editor-card').last();
  await lasts.getByRole('textbox', { name: 'Name', exact: true }).fill('Keep a million');
  await lasts.getByRole('combobox', { name: 'Kind' }).selectOption({ label: 'Investments last' });
  await lasts.getByRole('textbox', { name: 'Never below', exact: true }).fill('0');
  await expect(lasts.locator('[data-path="guardrails.4.investments"]')).toContainText('List at least one investment');
  await expect(lasts.locator('[data-path="guardrails.4.amount"]')).toContainText('The amount must be more than 0.');
  await lasts.getByRole('checkbox', { name: 'Brokerage' }).check();
  await lasts.getByRole('textbox', { name: 'Never below', exact: true }).fill('1000000');

  await runForecast(page);
  await page.getByRole('tab', { name: /^Compare/ }).click();
  const results = (await rows(page)).map((row) => [row[0], row[4], row[5]]);
  expect(results).toEqual([
    [
      'as we are',
      'Breaks in 2028-01 Owes $206,085.41 then; still owed at the end of the window',
      'Breaks in 2026-01 Tightest 2026-01, $959,400.00 short',
    ],
    ['sell', 'Holds Debt-free from 2027-06, 7 months to spare', 'Breaks in 2026-01 Tightest 2026-01, $959,400.00 short'],
    [
      'sell and freelance',
      'Holds Debt-free from 2027-06, 7 months to spare',
      'Breaks in 2026-01 Tightest 2026-01, $959,400.00 short',
    ],
  ]);

  const written = await downloadConfig(page);
  expect((written['guardrails'] as unknown[]).slice(3)).toEqual([
    { name: 'Mortgage gone by 2028', kind: 'debtFree', loans: ['Mortgage'], startDate: '2028-01' },
    { name: 'Keep a million', kind: 'lasts', amount: 1000000, investments: ['Brokerage'] },
  ]);
  expect(found).toEqual([]);
});
