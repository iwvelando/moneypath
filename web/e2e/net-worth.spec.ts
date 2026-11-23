import { expect, test, type Page } from '@playwright/test';
import { engineForecast, openApp, overflow, problems, uploadAndRun } from './helpers';

/**
 * The net-worth fixture: a student loan on both paths, and a mortgage sold in
 * 2027-09 and a car paid off by threshold on "own and sell".
 */
const NET_WORTH_PLAN = '../testdata/conformance/net-worth/config.yaml';

interface Value {
  liquid: number;
  total: number;
  liabilities: number;
  netWorth: number;
}
interface Results {
  rows: { date: string; values: Value[] }[];
  metrics: { keyFigures: { endingNetWorth: number } }[];
  todaysDollars: { rows: { date: string; values: Value[] }[] };
}

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

async function compare(page: Page): Promise<void> {
  await page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab', { name: /^Compare/ }).click();
}

test('a scenario that owes shows its debt and net worth, in both readings', async ({ page }) => {
  const found = problems(page);
  const engine = engineForecast(NET_WORTH_PLAN) as unknown as Results;
  await openApp(page);
  await uploadAndRun(page, NET_WORTH_PLAN);

  await page.getByRole('tab', { name: /^own and sell/ }).click();
  await expect(page.locator('.results__networth')).toContainText('It counts no home, car or other property.');
  await expect(page.locator('.chart__line--networth')).toHaveCount(1);
  const table = page.locator('.results-table');
  await expect(table.locator('thead th')).toHaveText(['Date', 'Liquid', 'Total', 'Debt', 'Net worth']);
  const first = engine.rows[0]!.values[1]!;
  await expect(table.locator('tbody tr').first().locator('td')).toHaveText([
    money(first.liquid), money(first.total), money(first.liabilities), money(first.netWorth),
  ]);

  await page.getByRole('group', { name: 'Show amounts' }).locator('label', { hasText: 'Today’s dollars' }).click();
  const saleMonth = engine.todaysDollars.rows.findIndex((row) => row.date === '2027-09');
  const sold = engine.todaysDollars.rows[saleMonth]!.values[1]!;
  await expect(table.locator('tbody tr.month-row').nth(saleMonth).locator('td')).toHaveText([
    money(sold.liquid), money(sold.total), money(sold.liabilities), money(sold.netWorth),
  ]);
  expect(found).toEqual([]);
});

test('Compare reads net worth for every scenario and when it changes hands', async ({ page }) => {
  const found = problems(page);
  const engine = engineForecast(NET_WORTH_PLAN) as unknown as Results;
  await openApp(page);
  await uploadAndRun(page, NET_WORTH_PLAN);
  await compare(page);

  const comparison = page.locator('.comparison');
  await comparison.getByRole('group', { name: 'Series to compare' }).getByRole('button', { name: 'Net worth' }).click();
  await expect(comparison.locator('.comparison__month')).toContainText('Net worth in 2028-12');
  await expect(comparison.locator('.comparison__value')).toHaveText(
    engine.metrics.map((m) => money(m.keyFigures.endingNetWorth)),
  );
  await expect(comparison.locator('.figures-table thead th')).toHaveText([
    'Scenario', 'Lowest cash', 'Ending cash', 'Ending total', 'Ending net worth', 'Emergency fund',
  ]);

  const breakEven = page.locator('.difference__breakeven > div', { hasText: 'Net worth break-even' });
  await expect(breakEven.locator('dd')).toHaveText('2027-09: own and sell moves ahead');
  const total = page.locator('.difference__breakeven > div', { hasText: 'Total break-even' });
  await expect(total.locator('dd')).toHaveText('2026-12: own and sell moves ahead');
  expect(found).toEqual([]);
});

test('the added columns and series fit a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openApp(page);
  await uploadAndRun(page, NET_WORTH_PLAN);
  await page.getByRole('tab', { name: /^own and sell/ }).click();
  await expect(page.locator('.results-table thead th')).toHaveCount(5);
  expect(await overflow(page), 'scenario view').toBeLessThanOrEqual(0);
  await compare(page);
  await page.getByRole('group', { name: 'Series to compare' }).getByRole('button', { name: 'Net worth' }).click();
  expect(await overflow(page), 'Compare').toBeLessThanOrEqual(0);
});

test('a path that owes nothing keeps three columns, which fit a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openApp(page);
  // "steady" owes nothing, though another scenario of the plan has a car loan.
  await uploadAndRun(page, '../testdata/conformance/todays-dollars/config.yaml');
  await page.getByRole('tab', { name: /^steady/ }).click();
  const table = page.locator('.results-table');
  await expect(table.locator('thead th')).toHaveText(['Date', 'Liquid', 'Total']);
  await expect(page.locator('.chart__line--networth')).toHaveCount(0);
  expect(await page.locator('.table-wrap').evaluate((el) => el.scrollWidth - el.clientWidth), 'three-column table').toBeLessThanOrEqual(1);
  await page.getByRole('tab', { name: /^car/ }).click();
  await expect(table.locator('thead th')).toHaveCount(5);
});
