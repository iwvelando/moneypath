import { expect, test } from '@playwright/test';
import { openApp, overflow, runForecast } from './helpers';

// Runs in the `phone` project (360 px wide). Every view and state is visited
// before measuring, because an overflow only counts if a reader can reach it.
test('no view scrolls sideways on a narrow phone', async ({ page }) => {
  await openApp(page);
  expect(await overflow(page), 'workspace').toBeLessThanOrEqual(0);

  for (const id of ['section-simulation', 'section-common', 'section-scenarios']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    expect(await overflow(page), id).toBeLessThanOrEqual(0);
  }

  await runForecast(page);
  expect(await overflow(page), 'results').toBeLessThanOrEqual(0);
  const scenarios = page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab');
  for (let i = 0; i < (await scenarios.count()); i += 1) {
    await scenarios.nth(i).click();
    await page.locator('.results-table').scrollIntoViewIfNeeded();
    expect(await overflow(page), `results, scenario ${i + 1}`).toBeLessThanOrEqual(0);
  }

  await page.getByRole('tab', { name: 'Planning Workspace' }).click();
  await page.getByRole('button', { name: 'Reset Config' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  expect(await overflow(page), 'reset confirmation').toBeLessThanOrEqual(0);
});

test('the run button stays reachable deep in the editor', async ({ page }) => {
  await openApp(page);
  await page.locator('#section-scenarios').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Run Forecast' }).last().click();
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');
});

test('results-table dates stay on one line', async ({ page }) => {
  await openApp(page);
  await runForecast(page);
  const cell = page.locator('.results-table tbody th').first();
  await expect(cell).toHaveText(/^\d{4}-\d{2}$/);
  const lines = await cell.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });
  expect(lines).toBe(1);
});

// Both palettes must preserve the editor and chart at desktop and phone widths.
for (const theme of ['Light', 'Dark']) {
  test(`${theme} theme keeps fields, help, and forecast controls usable`, async ({ page }) => {
    await openApp(page);
    await page.getByRole('radio', { name: theme, exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
    const cash = page.getByRole('textbox', { name: 'Starting cash', exact: true });
    await cash.fill('30000');
    await cash.blur();
    await expect(cash).toHaveValue('30000');
    const help = page.getByRole('button', { name: 'Help: Starting cash', exact: true });
    await help.click();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(await overflow(page), `${theme} help`).toBeLessThanOrEqual(0);
    await help.click();
    await expect(page.getByRole('button', { name: 'Run Forecast', exact: true })).toBeInViewport();
    expect(await overflow(page), `${theme} editor`).toBeLessThanOrEqual(0);
    await runForecast(page);
    expect(await overflow(page), `${theme} results`).toBeLessThanOrEqual(0);
    await page.locator('.chart__svg').focus();
    await page.keyboard.press('End');
    await expect(page.locator('.chart__tooltip')).toBeVisible();
    await page.getByRole('tab', { name: 'Planning Workspace' }).click();
    await expect(cash).toHaveValue('30000');
  });
}

for (const optimize of [false, true]) {
  test(`desktop result cards align with optimizer ${optimize ? 'on' : 'off'}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'Desktop card alignment');
    await openApp(page);
    await page.getByLabel('Upload a moneypath config file').setInputFiles({
      name: 'layout.yaml',
      mimeType: 'application/yaml',
      buffer: Buffer.from(`version: 2
simulation:
  startDate: 2026-01
  endDate: 2027-01
  startingCash: 25000
common:
  events:
    - name: Expenses
      amount: -1000
scenarios:
  - name: A possible path
    events:
      - name: Income
        amount: 1500
        optimize:
          field: amount
          min: 0
          max: 2000
`),
    });
    await page.getByRole('button', { name: /^Optimizer:/ }).click();
    await page.getByRole('checkbox', { name: 'Run the optimizer', exact: true }).setChecked(optimize);
    await page.getByRole('button', { name: /^Optimizer:/ }).click();
    await runForecast(page);
    await expect(page.getByRole('heading', { name: 'Optimizer adjustments', exact: true })).toHaveCount(optimize ? 1 : 0);
    for (const width of [1092, 1440]) {
      await page.setViewportSize({ width, height: 998 });
      const projection = await page.locator('.results__projection').boundingBox();
      const summary = await page.locator('.summary__card').first().boundingBox();
      const chartHeading = await page.getByRole('heading', { name: 'Net worth over time', exact: true }).boundingBox();
      const fundHeading = await page.getByRole('heading', { name: 'Emergency fund', exact: true }).boundingBox();
      expect(Math.abs(projection!.y - summary!.y), 'card tops').toBeLessThanOrEqual(1);
      expect(Math.abs(chartHeading!.y - fundHeading!.y), 'heading tops').toBeLessThanOrEqual(1);
      expect(await overflow(page), 'desktop results').toBeLessThanOrEqual(0);
    }
  });
}

test('monthly events expand by keyboard or row and reset for another forecast', async ({ page }, testInfo) => {
  await openApp(page);
  await runForecast(page);
  const table = page.locator('.results-table');
  await expect(table.locator('thead th')).toHaveText(['Date', 'Liquid', 'Total']);
  await expect(table.locator('.month-row').first().getByRole('button')).toHaveCount(0);
  const toggle = table.getByRole('button').first();
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const detailId = await toggle.getAttribute('aria-controls');
  const details = page.locator(`[id="${detailId}"]`);
  await expect(details).toBeVisible();
  await expect(details.getByRole('listitem').first()).toContainText('Brokerage');
  expect(await overflow(page), 'expanded monthly events').toBeLessThanOrEqual(0);
  expect(await page.locator('.table-wrap').evaluate((el) => el.scrollWidth - el.clientWidth), 'three-column table').toBeLessThanOrEqual(1);
  await toggle.press('Space');
  await expect(details).toBeHidden();
  await expect(toggle).toBeFocused();
  const value = table.locator('.month-row.is-expandable').first().locator('td').first();
  if (testInfo.project.name === 'phone') await value.tap();
  else await value.click();
  await expect(details).toBeVisible();

  const scenarios = page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab');
  await scenarios.nth(1).click();
  await expect(table.locator('button[aria-expanded="true"]')).toHaveCount(0);
  await table.getByRole('button').first().click();
  await expect(table.locator('button[aria-expanded="true"]')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Planning Workspace' }).click();
  await runForecast(page);
  await expect(table.locator('button[aria-expanded="true"]')).toHaveCount(0);
});

test('desktop section introductions stay below the bar and stop at their section boundary', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Desktop side-by-side layout');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  const common = page.locator('#section-common');
  const intro = common.locator('.section__intro');
  const bar = page.locator('.workbar');
  const checkPinned = async () => {
    await expect.poll(async () => {
      const heading = await intro.boundingBox();
      const controls = await bar.boundingBox();
      return Math.round(heading!.y - controls!.y - controls!.height);
    }).toBe(24);
    await expect(intro.getByRole('heading', { name: 'Common settings' })).toBeInViewport();
  };
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 998 });
    for (const name of ['Loans', 'Investments']) {
      await common.getByRole('heading', { name, exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await checkPinned();
    }
    await page.getByRole('button', { name: 'Jump to section' }).click();
    await page.getByRole('button', { name: 'Scenarios', exact: true }).click();
    await expect(page.locator('#section-scenarios')).toBeFocused();
    const section = await common.boundingBox();
    const heading = await intro.boundingBox();
    expect(heading!.y + heading!.height).toBeLessThanOrEqual(section!.y + section!.height);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  }
  // A run error makes the pinned bar taller; it must not cover the introduction.
  await page.getByRole('button', { name: 'Jump to section' }).click();
  await page.getByRole('button', { name: 'Simulation', exact: true }).click();
  const end = page.locator('#section-simulation').getByRole('textbox', { name: 'End month', exact: true });
  await end.fill('1900-01');
  await end.blur();
  await page.getByRole('button', { name: 'Run Forecast', exact: true }).click();
  await expect(page.locator('.workbar__error')).toBeVisible();
  await common.getByRole('heading', { name: 'Loans', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await checkPinned();
});

test('phone introductions scroll away while jump and run controls stay available', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout');
  await openApp(page);
  const common = page.locator('#section-common');
  await common.getByRole('heading', { name: 'Loans', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const intro = await common.locator('.section__intro').boundingBox();
  expect(intro!.y + intro!.height).toBeLessThan(0);
  await expect(page.getByRole('button', { name: 'Run Forecast', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Jump to section' }).click();
  await page.getByRole('button', { name: 'Simulation', exact: true }).click();
  await expect(page.locator('#section-simulation')).toBeFocused();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('workbar disclosures support keyboard navigation and direct common-settings jumps', async ({ page }) => {
  await openApp(page);
  const jump = page.getByRole('button', { name: 'Jump to section' });
  await jump.focus();
  await jump.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Simulation', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  const common = page.getByRole('button', { name: 'Common settings', exact: true });
  await expect(common).toBeFocused();
  await common.press('Escape');
  await expect(jump).toBeFocused();
  await expect(jump).toHaveAttribute('aria-expanded', 'false');
  await jump.press('Space');
  await common.click();
  await expect(page.locator('#section-common')).toBeFocused();
  await expect(jump).toHaveAttribute('aria-expanded', 'false');

  const optimizer = page.getByRole('button', { name: /^Optimizer:/ });
  await optimizer.click();
  const toggle = page.getByRole('checkbox', { name: 'Run the optimizer' });
  await toggle.focus();
  await toggle.press('Escape');
  await expect(optimizer).toBeFocused();
  await optimizer.press('Enter');
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  // The starter has no optimized events: tabbing beyond the switch closes the panel.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Run Forecast', exact: true })).toBeFocused();
  await expect(optimizer).toHaveAttribute('aria-expanded', 'false');
});

test('long section lists and optimizer panels fit the viewport and remain usable', async ({ page }, testInfo) => {
  await openApp(page);
  const names = Array.from({ length: 18 }, (_, i) => `Path ${i + 1}: a longer scenario name for a complex financial plan`);
  await page.getByLabel('Upload a moneypath config file').setInputFiles({
    name: 'many-scenarios.yaml', mimeType: 'application/yaml',
    buffer: Buffer.from(`version: 2
simulation:
  startDate: 2026-01
  endDate: 2027-01
  startingCash: 25000
common:
  events:
    - name: Expenses
      amount: -100
scenarios:
${names.map((name) => `  - name: "${name}"
    events:
      - name: Extra savings
        amount: 100
        optimize:
          field: amount
          min: 0
          max: 200`).join('\n')}
`),
  });
  const activate = async (locator: ReturnType<typeof page.getByRole>) => {
    if (testInfo.project.name === 'phone') await locator.tap();
    else await locator.click();
  };
  const jump = page.getByRole('button', { name: 'Jump to section' });
  await activate(jump);
  const panel = page.locator('.sectionnav__panel');
  expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await overflow(page), 'long navigation').toBeLessThanOrEqual(0);
  const initialBox = await panel.boundingBox();
  expect(initialBox!.y).toBeGreaterThanOrEqual(0);
  expect(initialBox!.y + initialBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  if (testInfo.project.name === 'chromium') {
    // A resize can change the anchor from the trigger to the full workbar.
    for (const width of [360, 800, 1440]) {
      await page.setViewportSize({ width, height: 760 });
      await expect.poll(async () => {
        const bounds = await panel.boundingBox();
        return bounds!.y >= 0 && bounds!.y + bounds!.height <= 760 &&
          bounds!.x >= 0 && bounds!.x + bounds!.width <= width;
      }).toBe(true);
    }
  }
  await activate(panel.getByRole('button', { name: names[17], exact: true }));
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: names[17], exact: true }) })).toBeFocused();
  await expect(jump).toHaveAttribute('aria-expanded', 'false');
  await activate(page.getByRole('button', { name: /^Optimizer:/ }));
  await page.getByRole('checkbox', { name: 'Run the optimizer' }).check();
  const optimizer = page.getByRole('button', { name: 'Optimizer: On' });
  await expect(optimizer).toBeVisible();
  const optimizerHeight = (await optimizer.boundingBox())!.height;
  expect(optimizerHeight, 'status button stays one line even with many events').toBeLessThanOrEqual(48);
  expect(await overflow(page), 'optimizer with many events').toBeLessThanOrEqual(0);
  const box = await page.locator('.optctl__panel').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await activate(page.locator('.optctl__entry').last());
  await expect(page.locator('.row-card:focus')).toContainText('Extra savings');
  await activate(optimizer);
  await activate(jump);
  await expect(optimizer).toHaveAttribute('aria-expanded', 'false');
  await activate(page.getByRole('button', { name: 'Run Forecast', exact: true }));
  await expect(page.locator('.workbar__error')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');
});
