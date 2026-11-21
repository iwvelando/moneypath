import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { engineForecast, openApp, problems, runForecast, uploadAndRun } from './helpers';

/** The growth fixture, whose numbers an independent model was checked against. */
const GROWTH_PLAN = '../testdata/conformance/growth/config.yaml';

async function downloadConfig(page: Page): Promise<Record<string, unknown>> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Config' }).click();
  return parse(readFileSync(await (await download).path(), 'utf8')) as Record<string, unknown>;
}

test('an uploaded plan with growth forecasts as the engine does and downloads every growth back', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  await uploadAndRun(page, GROWTH_PLAN);
  await expect(page.locator('.guardrails__list').first()).toContainText('Cushion Holds Tightest 2027-06, $4,515.00 to spare');

  const written = await downloadConfig(page);
  const source = parse(readFileSync(GROWTH_PLAN, 'utf8')) as Record<string, unknown>;
  for (const key of ['simulation', 'guardrails', 'common', 'choices'] as const) {
    expect(written[key], key).toEqual(source[key]);
  }
  expect(found).toEqual([]);
});

test('growth set in the editor on an event and a guardrail reaches the forecast and the download', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  const simulation = page.locator('#section-simulation');
  await simulation.getByRole('textbox', { name: 'Inflation rate', exact: true }).fill('3');

  await page.getByRole('button', { name: 'Edit Living expenses' }).click();
  const living = page.locator('.editor-card').filter({ has: page.getByRole('button', { name: 'Collapse Living expenses' }) });
  await living.getByRole('combobox', { name: 'Growth', exact: true }).selectOption({ label: 'With inflation' });
  await expect(living.locator('.editor-card__summary')).toHaveText('-$3,400.00 · Monthly · With inflation');

  await page.getByRole('button', { name: 'Edit Take-home pay' }).click();
  const pay = page.locator('.editor-card').filter({ has: page.getByRole('button', { name: 'Collapse Take-home pay' }) });
  await pay.getByRole('combobox', { name: 'Growth', exact: true }).selectOption({ label: 'At its own rate' });
  const rate = pay.getByRole('textbox', { name: 'Yearly growth', exact: true });
  await page.getByRole('button', { name: 'Run Forecast' }).first().click();
  await expect(pay.locator('[data-path="common.events.0.growth"]')).toContainText('Enter the yearly growth.');
  await expect(page.locator('.workbar__error')).toContainText('needs fixing');
  await rate.fill('-100');
  await expect(pay.locator('[data-path="common.events.0.growth"]')).toContainText('The yearly growth must be more than -100.');
  await rate.fill('4');

  const guardrails = page.locator('#section-guardrails');
  await guardrails.getByRole('button', { name: 'Add guardrail' }).click();
  await guardrails.getByRole('textbox', { name: 'Name', exact: true }).fill('Cushion');
  await guardrails.getByRole('textbox', { name: 'Floor', exact: true }).fill('5000');
  await guardrails.getByRole('combobox', { name: 'Growth', exact: true }).selectOption({ label: 'With inflation' });
  await runForecast(page);
  await expect(page.locator('.summary__card', { has: page.getByRole('heading', { name: 'Guardrails' }) })).toContainText('Cushion');

  const written = await downloadConfig(page);
  expect((written['simulation'] as Record<string, unknown>)['inflationRate']).toBe(3);
  const events = (written['common'] as { events: Record<string, unknown>[] }).events;
  expect(events[0]).toMatchObject({ name: 'Take-home pay', growth: 4 });
  expect(events[1]).toMatchObject({ name: 'Living expenses', growth: 'inflation' });
  expect(Object.keys(events[1]!).slice(0, 3)).toEqual(['name', 'amount', 'growth']);
  expect((written['guardrails'] as Record<string, unknown>[])[0]).toEqual({
    name: 'Cushion',
    kind: 'cashFloor',
    amount: 5000,
    growth: 'inflation',
  });
  expect(found).toEqual([]);
});

test('results read in today’s dollars switch the amounts, stay chosen for the next run, and leave one download', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  await uploadAndRun(page, GROWTH_PLAN);
  const readings = page.getByRole('group', { name: 'Show amounts' });
  const nominal = readings.getByRole('radio', { name: 'Nominal' });
  // The plan starts in 2026-06, named unless that is the current month.
  const today = readings.getByRole('radio', { name: /^Today’s dollars( \(June 2026\))?$/ });
  await expect(nominal).toBeChecked();
  const cushion = page.locator('.guardrails__list').first();
  await expect(cushion).toContainText('Cushion Holds Tightest 2027-06, $4,515.00 to spare');

  await readings.locator('label', { hasText: 'Today’s dollars' }).click();
  await expect(today).toBeChecked();
  await expect(cushion).toContainText('Cushion Holds Tightest 2027-06, $4,383.50 to spare');
  await expect(page.locator('.results-table')).toContainText('$24,978.40');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const csv = readFileSync(await (await download).path(), 'utf8');
  expect(csv).toBe(engineForecast(GROWTH_PLAN)['csv']);
  expect(csv.split('\n')[0]).toContain('"liquid in 2026-06 dollars (grows)","total in 2026-06 dollars (grows)"');

  await page.getByRole('tab', { name: 'Planning Workspace' }).click();
  await runForecast(page);
  await expect(today).toBeChecked();
  await expect(cushion).toContainText('$4,383.50 to spare');
  expect(found).toEqual([]);
});

test('a plan without an inflation rate offers no reading in today’s dollars', async ({ page }) => {
  await openApp(page);
  await runForecast(page);
  await expect(page.locator('.results__reading')).toHaveCount(0);
});
