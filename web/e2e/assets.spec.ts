import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { engineForecast, openApp, overflow, problems, uploadAndRun } from './helpers';

/**
 * The choices plan with the house listed as an asset: "as we are" keeps it,
 * "sell" sells it in 2027-06 (spec/03, Asset).
 */
const ASSET_PLAN = '../testdata/conformance/asset-choices/config.yaml';

interface Value {
  liquid: number;
  total: number;
  assets: number;
  liabilities: number;
  netWorth: number;
  equity: number;
}
interface Results {
  rows: { date: string; values: Value[] }[];
  csv: string;
}

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

async function scenario(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab', { name }).click();
}

test('a path that holds an asset shows its assets, debt, net worth and equity', async ({ page }) => {
  const found = problems(page);
  const engine = engineForecast(ASSET_PLAN) as unknown as Results;
  await openApp(page);
  await uploadAndRun(page, ASSET_PLAN);

  await scenario(page, /^as we are/);
  await expect(page.locator('.results__networth')).toContainText('Equity is what your listed assets are worth');
  const table = page.locator('.results-table');
  await expect(table.locator('thead th')).toHaveText(['Date', 'Liquid', 'Total', 'Assets', 'Debt', 'Net worth', 'Equity']);
  const first = engine.rows[0]!.values[0]!;
  await expect(table.locator('tbody tr.month-row').first().locator('td')).toHaveText([
    money(first.liquid), money(first.total), money(first.assets), money(first.liabilities), money(first.netWorth), money(first.equity),
  ]);

  // The sale month reads the sale's note and an empty balance sheet.
  await scenario(page, /^sell$/);
  const sale = engine.rows.findIndex((row) => row.date === '2027-06');
  const row = table.locator('tbody tr.month-row').nth(sale);
  await row.getByRole('button', { name: 'Show events for 2027-06' }).click();
  await expect(page.getByRole('list', { name: 'Events for 2027-06' })).toContainText('selling asset House for 312829.23 with 18769.75 selling costs');
  const sold = engine.rows[sale]!.values[1]!;
  await expect(row.locator('td')).toHaveText([
    money(sold.liquid), money(sold.total), money(0), money(0), money(sold.netWorth), money(0),
  ]);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const csv = await readFile((await (await download).path())!, 'utf8');
  expect(csv).toBe(engine.csv);
  expect(csv.split('\n')[0]).toContain('"assets (as we are)","liabilities (as we are)","net worth (as we are)","equity (as we are)"');
  expect(found).toEqual([]);
});

test('an asset is entered in the editor and a loan secured on it', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  await uploadAndRun(page, ASSET_PLAN);
  await page.getByRole('tab', { name: 'Planning Workspace' }).click();
  const baseline = page.locator('#section-common');
  const assets = baseline.locator('.list-block', { has: page.getByRole('heading', { name: 'Assets' }) });
  await assets.getByRole('button', { name: 'Add asset' }).click();
  await assets.getByLabel('Name', { exact: true }).first().fill('Car');
  await assets.getByLabel('Value', { exact: true }).first().fill('18000');
  await expect(assets.getByRole('textbox', { name: 'Purchase month' }).first()).toHaveAttribute('placeholder', 'Owned at the start');

  // The mortgage offers every asset name, and is secured on the house.
  await baseline.getByRole('button', { name: 'Edit Mortgage' }).click();
  const secured = baseline.getByRole('combobox', { name: 'Secured on' }).first();
  await expect(secured.locator('option')).toHaveText(['No asset', 'Car', 'House']);
  await expect(secured).toHaveValue('House');
  await expect(baseline.getByText('This loan is paid off when House is sold')).toBeVisible();
  expect(found).toEqual([]);
});

test('the balance-sheet columns scroll within their frame on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openApp(page);
  await uploadAndRun(page, ASSET_PLAN);
  await scenario(page, /^as we are/);
  await expect(page.locator('.results-table thead th')).toHaveCount(7);
  expect(await overflow(page), 'scenario view').toBeLessThanOrEqual(0);
});

test('the table scrolls one way at a time: its frame sideways, its rows up and down', async ({ page }) => {
  // On iOS a gesture goes to the scroller that moves in its first direction,
  // so two one-way scrollers keep a swipe on one axis.
  await page.setViewportSize({ width: 360, height: 780 });
  await openApp(page);
  await uploadAndRun(page, ASSET_PLAN);
  await scenario(page, /^as we are/);
  const frame = page.locator('.table-wrap');
  const rows = frame.locator('.table-wrap__rows');
  const axes = (el: Element) => {
    const style = getComputedStyle(el);
    return { x: style.overflowX, y: style.overflowY, wide: el.scrollWidth - el.clientWidth, tall: el.scrollHeight - el.clientHeight };
  };
  const outer = await frame.evaluate(axes);
  expect(outer).toMatchObject({ x: 'auto', y: 'hidden' });
  expect(outer.wide, 'the frame scrolls sideways').toBeGreaterThan(0);
  expect(outer.tall).toBeLessThanOrEqual(0);
  const inner = await rows.evaluate(axes);
  expect(inner).toMatchObject({ x: 'hidden', y: 'auto' });
  expect(inner.tall, 'the rows scroll up and down').toBeGreaterThan(0);
  expect(inner.wide).toBeLessThanOrEqual(0);

  // The header row stays at the top of the rows while they scroll.
  await rows.evaluate((el) => { el.scrollTop = 400; });
  const head = (await rows.locator('thead th').first().boundingBox())!;
  const box = (await rows.boundingBox())!;
  expect(Math.abs(head.y - box.y)).toBeLessThanOrEqual(1);
});
