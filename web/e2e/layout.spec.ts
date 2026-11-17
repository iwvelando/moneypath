import { expect, test } from '@playwright/test';
import { openApp, overflow, runForecast, uploadChoices } from './helpers';

// Runs in the `phone` project (360 px wide). Every view and state is visited
// before measuring, because an overflow only counts if a reader can reach it.
test('no view scrolls sideways on a narrow phone', async ({ page }) => {
  await openApp(page);
  expect(await overflow(page), 'workspace').toBeLessThanOrEqual(0);

  for (const id of ['section-simulation', 'section-guardrails', 'section-common', 'section-choices', 'section-scenarios']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    expect(await overflow(page), id).toBeLessThanOrEqual(0);
  }

  await runForecast(page);
  expect(await overflow(page), 'results').toBeLessThanOrEqual(0);
  const scenarios = page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab');
  // The last tab is the comparison, which ends in the key figures, not the monthly table.
  for (let i = 0; i < (await scenarios.count()); i += 1) {
    const tab = scenarios.nth(i);
    await tab.click();
    const compare = (await tab.textContent())?.trim() === 'Compare';
    await page.locator(compare ? '.figures-table' : '.results-table').scrollIntoViewIfNeeded();
    expect(await overflow(page), `results, tab ${i + 1}`).toBeLessThanOrEqual(0);
    if (compare) {
      await page.locator('.difference .chart__svg').scrollIntoViewIfNeeded();
      expect(await overflow(page), 'difference between two scenarios').toBeLessThanOrEqual(0);
    }
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
  // The date's own text, whether or not the month has events to expand.
  const cell = page.locator('.results-table tbody th').first().locator('span');
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
  await expect(table.locator('.month-row:not(.is-expandable)').getByRole('button')).toHaveCount(0);
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
  // Exercise pinning within a long section, then verify its boundary.
  await common.getByRole('button', { name: 'Edit Car loan', exact: true }).click();
  await common.getByRole('button', { name: 'Edit Brokerage', exact: true }).click();
  const bar = page.locator('.workbar');
  const checkPinned = async () => {
    await expect.poll(async () => {
      const heading = await intro.boundingBox();
      const controls = await bar.boundingBox();
      return Math.round(heading!.y - controls!.y - controls!.height);
    }).toBe(24);
    await expect(intro.getByRole('heading', { name: 'Baseline' })).toBeInViewport();
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
  await expect(page.getByRole('button', { name: 'Guardrails', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  const common = page.getByRole('button', { name: 'Baseline', exact: true });
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
  await expect(page.locator('.row-card:focus > .editor-card__body')).toBeVisible();
  await expect(page.locator('.row-card:focus').getByRole('textbox', { name: 'Amount', exact: true })).toBeVisible();
  await activate(optimizer);
  await activate(jump);
  await expect(optimizer).toHaveAttribute('aria-expanded', 'false');
  await activate(page.getByRole('button', { name: 'Run Forecast', exact: true }));
  await expect(page.locator('.workbar__error')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');
});


test('compact entries open inline, keep edits, and expose nested investment schedules', async ({ page }) => {
  await openApp(page);
  const common = page.locator('#section-common');
  const rentToggle = common.getByRole('button', { name: 'Edit Living expenses', exact: true });
  await expect(rentToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(common.getByRole('textbox', { name: 'Amount', exact: true })).toHaveCount(0);
  await rentToggle.press('Enter');
  const rent = common.locator('.editor-card').filter({ has: page.getByRole('button', { name: 'Collapse Living expenses', exact: true }) });
  await expect(rent.getByRole('group', { name: 'Schedule', exact: true })).toBeVisible();
  const amount = rent.getByRole('textbox', { name: 'Amount', exact: true });
  await amount.fill('-4500');
  await amount.blur();
  await rent.getByRole('button', { name: 'Collapse details', exact: true }).click();
  await expect(rentToggle).toContainText('-$4,500.00');
  await rentToggle.press('Space');
  await expect(amount).toHaveValue('-4500');
  await common.getByRole('button', { name: 'Edit Car loan', exact: true }).click();
  const loan = common.locator('.editor-card').filter({ has: page.getByRole('button', { name: 'Collapse Car loan', exact: true }) });
  await expect(loan.getByRole('group', { name: 'Loan terms', exact: true })).toBeVisible();
  await expect(loan.getByRole('group', { name: 'Escrow and insurance', exact: true })).toBeVisible();
  await expect(loan.getByRole('textbox', { name: 'Principal', exact: true })).toHaveValue('28000');
  await expect(amount).toBeVisible();
  await common.getByRole('button', { name: 'Edit Brokerage', exact: true }).click();
  const account = common.locator('.editor-card').filter({ has: page.getByRole('button', { name: 'Collapse Brokerage', exact: true }) });
  await expect(account.getByRole('group', { name: 'Taxes and cash flow', exact: true })).toBeVisible();
  await account.getByRole('button', { name: 'Edit Contribution 1', exact: true }).click();
  await expect(account.getByRole('textbox', { name: 'Amount', exact: true })).toHaveValue('600');
  expect(await overflow(page), 'expanded nested editor').toBeLessThanOrEqual(0);
  await account.getByRole('button', { name: 'Collapse Brokerage', exact: true }).click();
  await common.getByRole('button', { name: 'Edit Brokerage', exact: true }).click();
  await expect(account.getByRole('textbox', { name: 'Amount', exact: true })).toHaveValue('600');
  await runForecast(page);
});

test('new and duplicated entries open for editing and all entries remain expandable', async ({ page }, testInfo) => {
  await openApp(page);
  const common = page.locator('#section-common');
  await common.getByRole('button', { name: 'Edit Living expenses', exact: true }).click();
  await common.getByRole('button', { name: 'Duplicate Living expenses', exact: true }).click();
  const duplicateId = await common.locator('.editor-card').filter({ has: page.getByRole('button', { name: 'Collapse Living expenses', exact: true }) }).last().getAttribute('id');
  const duplicate = page.locator(`[id="${duplicateId}"]`);
  await expect(duplicate.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await duplicate.getByRole('textbox', { name: 'Name', exact: true }).fill('New spending');
  await duplicate.getByRole('button', { name: 'Collapse details', exact: true }).click();
  await expect(common.getByRole('button', { name: 'Edit New spending', exact: true })).toBeVisible();
  const eventList = common.locator('.section__body > .list-block').first();
  await eventList.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(eventList.getByRole('textbox', { name: 'Amount', exact: true })).toHaveCount(4);
  await eventList.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(eventList.getByRole('textbox', { name: 'Amount', exact: true })).toHaveCount(0);
  for (const kind of ['event', 'loan', 'investment']) {
    const add = common.getByRole('button', { name: `Add ${kind}`, exact: true });
    if (testInfo.project.name === 'phone') await add.tap();
    else await add.click();
    const focused = page.locator('input:focus');
    await expect(focused).toHaveValue('');
    await expect(focused).toBeInViewport();
    expect(await overflow(page), `new ${kind}`).toBeLessThanOrEqual(0);
  }
});

// A help button can sit anywhere in a row, including at the right edge, so its
// panel is placed against the viewport rather than against the button.
test('every help panel opens inside the viewport', async ({ page }) => {
  await openApp(page);
  const expand = page.getByRole('button', { name: 'Expand all' });
  while ((await expand.count()) > 0) await expand.first().click();
  const buttons = page.getByRole('button', { name: /^Help: / });
  const count = await buttons.count();
  expect(count).toBeGreaterThan(20);
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible())) continue;
    const name = await button.getAttribute('aria-label');
    await button.click();
    const box = await button.evaluate((el) => {
      const rect = el.parentElement!.querySelector('.helptip__text')!.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth };
    });
    expect(box.left, `${name} left edge`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${name} right edge`).toBeLessThanOrEqual(box.viewport);
    expect(await overflow(page), name ?? '').toBeLessThanOrEqual(0);
    await button.click();
  }
});

test('the comparison overlays every scenario and reads a month for each', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  await openApp(page);
  await page.getByLabel('Upload a moneypath config file').setInputFiles({
    name: 'compare.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(`version: 2
simulation:
  startDate: 2026-01
  endDate: 2028-01
  startingCash: 5000
common:
  events:
    - name: Income
      amount: 1000
scenarios:
  - name: Steady
  - name: Take the long sabbatical and travel for a year
    events:
      - name: Travel
        amount: -1600
  - name: Skipped
    active: false
  - name: Save
    events:
      - name: Side work
        amount: 700
`),
  });
  await runForecast(page);

  const tabs = page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab');
  await expect(tabs).toHaveCount(4);
  const compare = tabs.last();
  await expect(compare).toHaveText('Compare');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  if (phone) await compare.tap();
  else await compare.click();
  await expect(compare).toHaveAttribute('aria-selected', 'true');

  const comparison = page.locator('.comparison');
  await expect(comparison.getByRole('heading', { name: 'Scenarios side by side' })).toBeVisible();
  await expect(comparison.locator('.comparison__name')).toHaveText([
    'Steady',
    'Take the long sabbatical and travel for a year',
    'Save',
  ]);
  await expect(comparison.locator('.chart__svg .chart__line')).toHaveCount(3);
  await expect(page.locator('.results-table')).toHaveCount(0);

  // Each line is told apart by its pattern as well as its color.
  const strokes = await comparison.locator('.chart__svg .chart__line').evaluateAll((lines) =>
    lines.map((line) => {
      const style = getComputedStyle(line);
      return { color: style.stroke, dash: style.strokeDasharray };
    }),
  );
  expect(new Set(strokes.map((stroke) => stroke.color)).size).toBe(3);
  expect(new Set(strokes.map((stroke) => stroke.dash)).size).toBe(3);

  const group = comparison.getByRole('group', { name: 'Series to compare' });
  const total = group.getByRole('button', { name: 'Total' });
  const liquid = group.getByRole('button', { name: 'Liquid' });
  await expect(total).toHaveAttribute('aria-pressed', 'true');
  const month = comparison.locator('.comparison__month');
  await expect(month).toContainText('Total in 2028-01');

  if (phone) await liquid.tap();
  else await liquid.click();
  await expect(liquid).toHaveAttribute('aria-pressed', 'true');
  await expect(total).toHaveAttribute('aria-pressed', 'false');
  await expect(month).toContainText('Liquid in 2028-01');

  // The sabbatical spends more than it earns, so the scale reaches below zero.
  const values = comparison.locator('.comparison__value');
  await expect(values.nth(1)).toHaveText(/^-\$/);
  await expect(comparison.locator('.chart__zero')).toHaveCount(1);
  const frame = (await comparison.locator('.chart__svg').boundingBox())!;
  for (const box of await comparison.locator('.chart__svg .chart__line').evaluateAll((lines) =>
    lines.map((line) => line.getBoundingClientRect().toJSON() as { top: number; bottom: number }),
  )) {
    expect(box.top).toBeGreaterThanOrEqual(frame.y);
    expect(box.bottom).toBeLessThanOrEqual(frame.y + frame.height);
  }

  // Tabs keep their names readable, and the date axis stays inside the chart.
  const compareBox = (await compare.boundingBox())!;
  expect(compareBox.width, 'Compare tab width').toBeGreaterThanOrEqual(88);
  for (const box of await comparison.locator('.chart__axis text').evaluateAll((labels) =>
    labels.map((label) => label.getBoundingClientRect().toJSON() as { left: number; right: number }),
  )) {
    expect(box.right, 'date label').toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    expect(box.left, 'date label').toBeGreaterThanOrEqual(frame.x - 0.5);
  }

  // The series control is only as wide as its two choices.
  expect((await group.boundingBox())!.width, 'series control width').toBeLessThanOrEqual(200);

  // By pointer: a tap or a hover reads the month under it.
  const before = await month.textContent();
  await comparison.locator('.chart__svg').scrollIntoViewIfNeeded();
  const plot = (await comparison.locator('.chart__svg').boundingBox())!;
  if (phone) await page.touchscreen.tap(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5);
  else await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5);
  await expect(month).not.toHaveText(before!);
  await expect(comparison.locator('.chart__cursor circle')).toHaveCount(3);
  if (phone) await comparison.getByRole('heading', { name: 'Scenarios side by side' }).tap();
  else await page.mouse.move(2, 2);
  await expect(month).toHaveText(before!);

  // By keyboard: focus the chart and walk the months.
  const chart = comparison.locator('.chart__svg');
  if (!phone) await page.mouse.move(plot.x + plot.width * 0.9, plot.y + plot.height * 0.5);
  await chart.focus();
  await chart.press('Home');
  await expect(month).toContainText('2026-01');
  const first = await values.allTextContents();
  await chart.press('ArrowRight');
  await expect(month).toContainText('2026-02');
  expect(await values.allTextContents()).not.toEqual(first);
  await expect(comparison.getByRole('status')).toContainText('2026-02, liquid: Steady');
  await chart.press('End');
  await expect(month).toContainText('2028-01');

  await comparison.locator('.comparison__legend').scrollIntoViewIfNeeded();
  expect(await overflow(page), 'comparison').toBeLessThanOrEqual(0);
  const legend = (await comparison.locator('.comparison__legend').boundingBox())!;
  for (const box of await values.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().toJSON() as { right: number }),
  )) {
    expect(box.right, 'value stays inside the legend').toBeLessThanOrEqual(legend.x + legend.width + 1);
  }

  // The comparison is left the same way it was entered.
  await tabs.first().click();
  await expect(page.locator('.results-table')).toBeVisible();
  await expect(comparison).toHaveCount(0);
});

test('the key figures list every scenario and lead to each one', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  await openApp(page);
  await page.getByLabel('Upload a moneypath config file').setInputFiles({
    name: 'figures.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(`version: 2
simulation:
  startDate: 2025-01
  endDate: 2025-07
  startingCash: 5000
common:
  investments:
    - name: Index fund
      startingValue: 10000
      annualReturnRate: 12
scenarios:
  - name: Dips twice
    events:
      - {name: Roof repair, amount: -2000, startDate: 2025-02, endDate: 2025-02}
      - {name: Bonus, amount: 2000, startDate: 2025-03, endDate: 2025-03}
      - {name: Car repair, amount: -2000, startDate: 2025-05, endDate: 2025-05}
      - {name: Tax refund, amount: 2500, startDate: 2025-06, endDate: 2025-06}
  - name: Only grows while everything else in the plan stays exactly as it is
    events:
      - {name: Income, amount: 500}
  - name: Spends down
    events:
      - {name: Living costs, amount: -1000000}
`),
  });
  await runForecast(page);
  const tabs = page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab');
  const compare = tabs.last();
  if (phone) await compare.tap();
  else await compare.click();

  // A table to assistive technology at every width, stacked or not.
  const table = page.getByRole('table', { name: 'Key figures for each scenario' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText(
    ['Scenario', 'Lowest cash', 'Ending cash', 'Ending total', 'Emergency fund'],
  );
  await expect(table.getByRole('rowheader')).toHaveText([
    'Dips twice',
    'Only grows while everything else in the plan stays exactly as it is',
    'Spends down',
  ]);
  const rows = table.locator('tbody').getByRole('row');
  await expect(rows).toHaveCount(3);

  // The engine's figures: the earlier of two equal lows, a low in the start
  // month, and one in the final month.
  const values = (row: number) => rows.nth(row).locator('.figures-table__value');
  const lowest = (row: number) => rows.nth(row).getByRole('cell').first();
  await expect(lowest(0)).toContainText('$3,000.00 in 2025-02');
  await expect(lowest(1)).toContainText('$5,500.00 in 2025-01');
  await expect(lowest(2)).toContainText('-$6,995,000.00 in 2025-07');
  await expect(values(0)).toHaveText(['$3,000.00', '$5,500.00', '$16,221.35', '$1,571.43 surplus']);
  await expect(values(2)).toHaveText(['-$6,995,000.00', '-$6,995,000.00', '-$6,984,278.65', '$5,995,000.00 short']);

  // The ending totals are the ones the chart's legend reads for the final month.
  const legend = await page.locator('.comparison__value').allTextContents();
  for (let row = 0; row < 3; row += 1) await expect(values(row).nth(2)).toHaveText(legend[row]!);

  // Long names and large amounts stay inside the page and inside their table.
  await table.scrollIntoViewIfNeeded();
  expect(await overflow(page), 'key figures').toBeLessThanOrEqual(0);
  const wrap = page.locator('.figures__wrap');
  expect(await wrap.evaluate((el) => el.scrollWidth - el.clientWidth), 'table scrolls sideways').toBeLessThanOrEqual(0);
  const labels = rows.first().locator('.figures-table__label');
  if (phone) {
    // Stacked: every figure sits under its own column name, and the header row is out of sight.
    await expect(labels).toHaveText(['Lowest cash', 'Ending cash', 'Ending total', 'Emergency fund']);
    for (const label of await labels.all()) await expect(label).toBeVisible();
    const head = (await table.locator('thead').boundingBox())!;
    expect(head.width * head.height, 'header row area').toBeLessThanOrEqual(1);
    const frame = (await wrap.boundingBox())!;
    for (const box of await table.locator('tbody th, tbody td').evaluateAll((cells) =>
      cells.map((cell) => cell.getBoundingClientRect().toJSON() as { left: number; right: number }),
    )) {
      expect(box.left, 'cell').toBeGreaterThanOrEqual(frame.x - 0.5);
      expect(box.right, 'cell').toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    }
  } else {
    for (const label of await labels.all()) await expect(label).toBeHidden();
    await expect(table.getByRole('columnheader').first()).toBeVisible();
  }

  // A row leads to its scenario's own view, with its tab in sight.
  const open = table.getByRole('button', { name: 'Spends down' });
  if (phone) await open.tap();
  else await open.click();
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(2)).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.results-table')).toBeVisible();
  await expect(page.locator('.comparison')).toHaveCount(0);

  // The same from the keyboard, which takes focus to the tab.
  await compare.click();
  await table.getByRole('button', { name: 'Dips twice' }).focus();
  await page.keyboard.press('Enter');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Month by month' })).toBeVisible();
});

test('the difference between two scenarios names the months the lead changes hands', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  await openApp(page);
  await page.getByLabel('Upload a moneypath config file').setInputFiles({
    name: 'difference.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(`version: 2
simulation:
  startDate: 2025-01
  endDate: 2025-09
  startingCash: 5000
scenarios:
  - name: Stay employed and keep building the retirement match for the whole year
    events:
      - {name: Savings from salary, amount: 500}
    investments:
      - name: Employer retirement match
        startingValue: 0
        annualReturnRate: 0
        contributions:
          - {amount: 300}
  - name: Take the course
    events:
      - {name: Savings from salary, amount: 500}
      - {name: Course fee, amount: -2000, startDate: 2025-02, endDate: 2025-02}
      - {name: Freelance work, amount: 500, frequency: 2, startDate: 2025-03, endDate: 2025-09}
      - {name: First contract, amount: 1500, startDate: 2025-04, endDate: 2025-04}
      - {name: Equipment, amount: -500, startDate: 2025-06, endDate: 2025-06}
      - {name: Conference, amount: -1500, startDate: 2025-08, endDate: 2025-08}
  - name: Coast
`),
  });
  await runForecast(page);
  const employed = 'Stay employed and keep building the retirement match for the whole year';
  const tabs = page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab');
  // A single scenario's view has no difference to show.
  await expect(page.locator('.difference')).toHaveCount(0);
  if (phone) await tabs.last().tap();
  else await tabs.last().click();

  const difference = page.locator('.difference');
  await expect(difference.getByRole('heading', { name: 'Difference between two scenarios' })).toBeVisible();
  const first = difference.getByLabel('Compare');
  const second = difference.getByLabel('against');
  const chosen = async () => [
    await first.locator('option:checked').textContent(),
    await second.locator('option:checked').textContent(),
  ];
  expect(await chosen()).toEqual([employed, 'Take the course']);

  // The engine's months: a level month is skipped, a lead that is lost to a
  // level month and regained is not a change, and the total is never overtaken.
  const rows = difference.locator('.difference__breakeven > div');
  await expect(rows.nth(0)).toContainText('Total break-even');
  await expect(rows.nth(0).locator('dd')).toHaveText('The lead never changes hands.');
  await expect(rows.nth(1)).toContainText('Liquid break-even');
  await expect(rows.nth(1).locator('li')).toHaveText([
    '2025-05: Take the course moves ahead',
    `2025-08: ${employed} moves ahead`,
  ]);
  await expect(difference.locator('.difference__reading')).toHaveText(
    `Above zero, ${employed} is ahead of Take the course; below zero, it is behind.`,
  );

  // The chart reads the engine's difference for a month.
  const chart = difference.locator('.chart__svg');
  await expect(chart.locator('.chart__line')).toHaveCount(2);
  await chart.focus();
  await chart.press('End');
  await expect(difference.getByRole('status')).toHaveText('2025-09: liquid $500.00, total $3,200.00');

  // Long names stay inside the page, and inside their pickers.
  await chart.scrollIntoViewIfNeeded();
  expect(await overflow(page), 'difference').toBeLessThanOrEqual(0);
  const card = (await difference.locator('.results__projection').boundingBox())!;
  for (const select of [first, second]) {
    const box = (await select.boundingBox())!;
    expect(box.x, 'picker left edge').toBeGreaterThanOrEqual(card.x);
    expect(box.x + box.width, 'picker right edge').toBeLessThanOrEqual(card.x + card.width + 0.5);
    // The arrow is the page's own, set in from the edge, with room kept for it.
    const style = await select.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { appearance: computed.appearance, room: parseFloat(computed.paddingRight), arrow: computed.backgroundImage };
    });
    expect(style.appearance).toBe('none');
    expect(style.room).toBeGreaterThanOrEqual(32);
    expect(style.arrow).toContain('linear-gradient');
  }

  // Either picker changes the pair; choosing the scenario the other holds swaps them.
  await second.selectOption({ label: 'Coast' });
  expect(await chosen()).toEqual([employed, 'Coast']);
  await expect(rows.nth(1).locator('dd')).toHaveText('The lead never changes hands.');
  await chart.focus();
  await chart.press('End');
  await expect(difference.getByRole('status')).toHaveText('2025-09: liquid $4,500.00, total $7,200.00');
  await first.selectOption({ label: 'Coast' });
  expect(await chosen()).toEqual(['Coast', employed]);
  await chart.focus();
  await chart.press('End');
  await expect(difference.getByRole('status')).toHaveText('2025-09: liquid -$4,500.00, total -$7,200.00');
  expect(await overflow(page), 'difference after choosing').toBeLessThanOrEqual(0);
});

test('the key figures leave out the emergency fund when it is switched off', async ({ page }) => {
  await openApp(page);
  await page.getByLabel('Upload a moneypath config file').setInputFiles({
    name: 'no-fund.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(`version: 2
simulation:
  startDate: 2025-01
  endDate: 2025-04
  startingCash: 5000
recommendations:
  emergencyFundMonths: 0
scenarios:
  - name: Keep
    events:
      - {name: Income, amount: 100}
  - name: Spend
    events:
      - {name: Costs, amount: -100}
`),
  });
  await runForecast(page);
  await page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab').last().click();
  const table = page.getByRole('table', { name: 'Key figures for each scenario' });
  await expect(table.getByRole('columnheader')).toHaveText(['Scenario', 'Lowest cash', 'Ending cash', 'Ending total']);
  await expect(table.locator('tbody').getByRole('row').first().getByRole('cell')).toHaveCount(3);
  await expect(table).not.toContainText('Emergency fund');
});

for (const theme of ['Light', 'Dark'] as const) {
  test(`${theme} theme keeps every scenario line clear of its background`, async ({ page }) => {
    await openApp(page);
    await page.getByRole('radio', { name: theme, exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
    await runForecast(page);
    await page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab', { name: 'Compare' }).click();
    const contrasts = await page.locator('.comparison .chart__svg .chart__line').evaluateAll((lines) => {
      const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const luminance = (color: string) => {
        const [r, g, b] = (color.match(/[\d.]+/g) ?? []).map((n) => channel(Number(n) / 255));
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const card = lines[0]!.closest('.results__projection')!;
      const surface = luminance(getComputedStyle(card).backgroundColor);
      return lines.map((line) => {
        const stroke = luminance(getComputedStyle(line).stroke);
        return (Math.max(stroke, surface) + 0.05) / (Math.min(stroke, surface) + 0.05);
      });
    });
    expect(contrasts).toHaveLength(2);
    for (const contrast of contrasts) expect(contrast).toBeGreaterThanOrEqual(3);
  });
}

test('many scenarios stay on one row of tabs that scrolls sideways', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  await openApp(page);
  const names = Array.from({ length: 12 }, (_, i) => `A possible path number ${i + 1}`);
  await page.getByLabel('Upload a moneypath config file').setInputFiles({
    name: 'many.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(`version: 2
simulation:
  startDate: 2026-01
  endDate: 2027-01
  startingCash: 5000
scenarios:
${names.map((name, i) => `  - name: ${name}\n    events:\n      - name: Income\n        amount: ${100 * (i + 1)}`).join('\n')}
`),
  });
  await runForecast(page);

  const tablist = page.getByRole('tablist', { name: 'Scenarios' });
  const tabs = tablist.getByRole('tab');
  await expect(tabs).toHaveCount(13);
  const boxes = () =>
    tabs.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().toJSON() as { top: number; left: number; right: number }),
    );
  const strip = async () => (await tablist.boundingBox())!;

  // One row, wider than its strip, and the page itself still does not scroll sideways.
  expect(new Set((await boxes()).map((box) => Math.round(box.top))).size, 'rows of tabs').toBe(1);
  expect(await tablist.evaluate((el) => el.scrollWidth - el.clientWidth), 'strip scrolls').toBeGreaterThan(0);
  expect(await overflow(page), 'results with many scenarios').toBeLessThanOrEqual(0);
  const viewport = page.viewportSize()!;
  expect((await strip()).x + (await strip()).width, 'strip stays in the page').toBeLessThanOrEqual(viewport.width);
  // The run details and the download stay on screen beside or below the strip.
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeInViewport();

  // The shadows that hint at more tabs sit flush with the edges the tabs are cut off at.
  const hintOffsets = await tablist.evaluate((el) => getComputedStyle(el).backgroundPositionX);
  expect(hintOffsets, 'edge hints start at the very edge').not.toMatch(/[1-9][\d.]*px/);

  // Choosing a tab that is only partly showing brings all of it into the strip.
  const edge = (await strip()).x + (await strip()).width;
  const cut = (await boxes()).findIndex((box) => box.left < edge - 12 && box.right > edge + 1);
  if (cut >= 0) {
    const box = (await boxes())[cut]!;
    const y = (await strip()).y + 20;
    if (phone) await page.touchscreen.tap(box.left + 6, y);
    else await page.mouse.click(box.left + 6, y);
    await expect(tabs.nth(cut)).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(async () => (await boxes())[cut]!.right - ((await strip()).x + (await strip()).width))
      .toBeLessThanOrEqual(1);
  }

  // The arrow keys do the same for a neighbour that is showing only a sliver.
  await tablist.evaluate((el) => {
    const sixth = el.querySelectorAll('[role="tab"]')[5]!.getBoundingClientRect();
    el.scrollLeft += sixth.left + 6 - el.getBoundingClientRect().right;
  });
  await tabs.nth(4).focus();
  await tabs.nth(4).press('ArrowRight');
  await expect(tabs.nth(5)).toBeFocused();
  await expect
    .poll(async () => (await boxes())[5]!.right - ((await strip()).x + (await strip()).width))
    .toBeLessThanOrEqual(1);

  // The arrow keys wrap round to the comparison at the far end and bring it into view.
  await tablist.evaluate((el) => el.scrollTo({ left: 0 }));
  await tabs.first().focus();
  await tabs.first().press('ArrowLeft');
  const compare = tabs.last();
  await expect(compare).toBeFocused();
  await expect(compare).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(async () => (await boxes())[12]!.right - ((await strip()).x + (await strip()).width))
    .toBeLessThanOrEqual(1);
  await expect(page.locator('.comparison')).toBeVisible();
  expect(await overflow(page), 'comparison with many scenarios').toBeLessThanOrEqual(0);
});

test('a comparison with only the initial month still draws every scenario', async ({ page }) => {
  await openApp(page);
  await page.getByLabel('Upload a moneypath config file').setInputFiles({
    name: 'initial-month.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(`version: 2
simulation:
  startDate: 2026-01
  endDate: 2026-01
  startingCash: 5000
scenarios:
  - name: First
  - name: Second
`),
  });
  await runForecast(page);
  await page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab', { name: 'Compare' }).click();
  const comparison = page.locator('.comparison');
  await expect(comparison.locator('.comparison__value')).toHaveText(['$5,000.00', '$5,000.00']);
  const points = comparison.locator('.comparison__point');
  await expect(points).toHaveCount(2);
  for (const point of await points.all()) {
    const box = (await point.boundingBox())!;
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  }
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

// Runs at desktop width and in the `phone` project. The option, its change to a
// baseline entry and the entry picker are the widest things the editor holds.
test('choices, an open change and the selections never scroll sideways', async ({ page }) => {
  await openApp(page);
  await uploadChoices(page);

  const housing = page.locator('section', { has: page.getByRole('heading', { name: 'Housing', exact: true }) });
  await housing.getByRole('button', { name: 'Edit Sell and rent', exact: true }).click();
  await housing.getByRole('button', { name: 'Edit Changes Mortgage', exact: true }).click();
  await expect(housing.locator('.changed-list li')).toHaveCount(4);
  for (const part of ['.changed-list', '.target-picker', '.editor-card__footer']) {
    await housing.locator(part).last().scrollIntoViewIfNeeded();
    expect(await overflow(page), part).toBeLessThanOrEqual(0);
  }
  // The entry search opens a list over the form: inside the page, and whole.
  const picker = housing.getByRole('combobox', { name: 'Baseline entry' });
  await picker.click();
  const list = housing.getByRole('listbox', { name: 'Baseline entry' });
  await expect(list.getByRole('option')).toHaveCount(5);
  expect(await overflow(page), 'entry list').toBeLessThanOrEqual(0);
  await picker.fill('liv');
  await expect(list.getByRole('option')).toHaveCount(1);
  const option = list.getByRole('option', { name: /Living costs/ });
  // Nothing covers it: a list clipped by its card would not take the click.
  await option.click({ trial: true });
  await picker.press('Escape');
  await expect(list).toHaveCount(0);

  // A reset button stays inside its row, beside the field it resets.
  const row = housing.locator('.changed-list li').first();
  const rowBox = (await row.boundingBox())!;
  const reset = (await row.getByRole('button', { name: 'Reset Early payoff month' }).boundingBox())!;
  expect(reset.x + reset.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);

  const selections = page.locator('.selections').last();
  await selections.scrollIntoViewIfNeeded();
  expect(await overflow(page), 'selections').toBeLessThanOrEqual(0);
  const dropdown = selections.getByRole('combobox', { name: 'Job' });
  const group = (await selections.boundingBox())!;
  const box = (await dropdown.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(group.x - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(group.x + group.width + 0.5);
});

test('guardrails, their results and the flip panel never scroll sideways', async ({ page }) => {
  await openApp(page);
  await uploadChoices(page);
  const section = page.locator('#section-guardrails');
  await section.getByRole('button', { name: 'Edit Cushion' }).click();
  await section.getByRole('combobox', { name: 'Kind' }).scrollIntoViewIfNeeded();
  expect(await overflow(page), 'an open guardrail').toBeLessThanOrEqual(0);

  await runForecast(page);
  await page.getByRole('tab', { name: /^Compare/ }).click();
  await page.locator('.guardrails-table').scrollIntoViewIfNeeded();
  expect(await overflow(page), 'guardrails in Compare').toBeLessThanOrEqual(0);

  await page.getByRole('tab', { name: /^as we are/ }).click();
  const flip = page.locator('.flip');
  await flip.getByRole('combobox', { name: 'Choice' }).selectOption({ label: 'Job' });
  await flip.getByRole('combobox', { name: 'Instead of Stay' }).selectOption({ label: 'Go freelance' });
  await flip.locator('.guardrails-table').scrollIntoViewIfNeeded();
  expect(await overflow(page), 'guardrails in the flip panel').toBeLessThanOrEqual(0);
});
