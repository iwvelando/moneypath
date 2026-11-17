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

test('an uploaded plan reports its cash floor on every scenario and keeps it', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  await uploadChoices(page);
  await runForecast(page);

  await page.getByRole('tab', { name: /^Compare/ }).click();
  expect(await rows(page)).toEqual([
    ['as we are', 'Holds Tightest 2026-01, $5,000.00 to spare'],
    ['sell', 'Holds Tightest 2026-01, $5,000.00 to spare'],
    ['sell and freelance', 'Breaks in 2027-02 Tightest 2027-02, $4,545.36 short'],
  ]);

  await page.getByRole('tab', { name: /^sell and freelance/ }).click();
  const card = page.locator('.summary__card', { has: page.getByRole('heading', { name: 'Guardrails' }) });
  await expect(card).toContainText('Cushion');
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
    ['as we are', 'Holds Tightest 2026-01, $5,000.00 to spare'],
    // Going freelance without selling: the months before freelance income starts cost the cushion.
    ['as we are (Job: Go freelance)', 'Breaks in 2027-02 Tightest 2027-02, $3,245.36 short'],
  ]);
});
