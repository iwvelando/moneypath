import { expect, test } from '@playwright/test';
import { openApp, overflow, problems, runForecast } from './helpers';

// Safari's engine on an iPhone profile, which every iOS browser uses. Runs in
// the `webkit` project only (`make test-webkit`, and the macOS CI job).
test('an iPhone loads the engine, runs a forecast, and never scrolls sideways', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  expect(await overflow(page), 'workspace').toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Jump to section' }).tap();
  await page.getByRole('button', { name: 'Common settings', exact: true }).tap();
  await expect(page.locator('#section-common')).toBeFocused();
  await page.getByRole('button', { name: 'Edit Living expenses', exact: true }).tap();
  await expect(page.locator('#section-common').getByRole('textbox', { name: 'Amount', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse Living expenses', exact: true }).tap();
  const optimizer = page.getByRole('button', { name: /^Optimizer:/ });
  await optimizer.tap();
  await expect(page.getByRole('checkbox', { name: 'Run the optimizer' })).toBeVisible();
  expect(await overflow(page), 'optimizer panel').toBeLessThanOrEqual(0);
  await optimizer.tap();
  await runForecast(page);
  expect(await overflow(page), 'results').toBeLessThanOrEqual(0);
  await page.locator('.results-table').scrollIntoViewIfNeeded();
  expect(await overflow(page), 'results table').toBeLessThanOrEqual(0);
  const month = page.locator('.results-table').getByRole('button').first();
  await month.tap();
  await expect(month).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.month-details:not([hidden])')).toBeVisible();
  expect(await overflow(page), 'expanded events').toBeLessThanOrEqual(0);
  await month.tap();
  await expect(month).toHaveAttribute('aria-expanded', 'false');
  expect(found).toEqual([]);
});


test('a pointer selection works after keyboard focus in the workbar', async ({ page }) => {
  await openApp(page);
  const jump = page.getByRole('button', { name: 'Jump to section' });
  await jump.focus();
  await jump.press('Enter');
  await page.getByRole('button', { name: 'Common settings', exact: true }).click();
  await expect(page.locator('#section-common')).toBeFocused();
  const optimizer = page.getByRole('button', { name: /^Optimizer:/ });
  await optimizer.focus();
  await optimizer.press('Enter');
  const toggle = page.getByRole('checkbox', { name: 'Run the optimizer' });
  await toggle.setChecked(true);
  await expect(toggle).toBeChecked();
  await jump.click();
  await expect(jump).toHaveAttribute('aria-expanded', 'true');
  await expect(optimizer).toHaveAttribute('aria-expanded', 'false');
});

test('the comparison tab and its series control answer taps and keys', async ({ page }) => {
  const found = problems(page);
  // WebKit styles a select's internal text with a blocked inline declaration.
  // Match that event's target, rather than ignoring all stylesheet errors.
  await page.addInitScript(() => {
    const violations: { nativeSelect: boolean; directive: string; blocked: string }[] = [];
    Object.assign(window, { comparisonPolicyViolations: violations });
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push({
        nativeSelect:
          event.target instanceof HTMLSelectElement &&
          !event.target.hasAttribute('style') &&
          event.effectiveDirective === 'style-src-attr' &&
          event.blockedURI === 'inline',
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
      });
    });
  });
  await openApp(page);
  await runForecast(page);
  const tabs = page.getByRole('tablist', { name: 'Scenarios' }).getByRole('tab');
  const compare = tabs.filter({ hasText: 'Compare' });
  await compare.tap();
  await expect(compare).toHaveAttribute('aria-selected', 'true');
  const comparison = page.locator('.comparison');
  await expect(comparison.locator('.comparison__name')).toHaveText(['current path', 'save more aggressively']);
  expect(await overflow(page), 'comparison').toBeLessThanOrEqual(0);

  // Safari does not focus a button it is tapped on; the choice must not depend on focus.
  const group = comparison.getByRole('group', { name: 'Series to compare' });
  const total = group.getByRole('button', { name: 'Total' });
  const liquid = group.getByRole('button', { name: 'Liquid' });
  await liquid.tap();
  await expect(liquid).toHaveAttribute('aria-pressed', 'true');
  await expect(comparison.locator('.comparison__month')).toContainText('Liquid in');
  await total.focus();
  await total.press('Enter');
  await expect(total).toHaveAttribute('aria-pressed', 'true');
  await expect(total).toBeFocused();

  // Reading a month from the keyboard, then leaving the chart by tapping elsewhere.
  const chart = comparison.locator('.chart__svg');
  const month = comparison.locator('.comparison__month');
  const last = await month.textContent();
  await chart.focus();
  await expect(chart).toBeFocused();
  await chart.press('ArrowRight');
  await expect(month).not.toHaveText(last!);
  await liquid.tap();
  await expect(liquid).toHaveAttribute('aria-pressed', 'true');

  // Arrow keys carry focus along the tabs, back to a scenario.
  await compare.focus();
  await compare.press('ArrowLeft');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.results-table')).toBeVisible();
  // A scenario's own chart takes keyboard focus the same way.
  const scenarioChart = page.locator('#scenario-panel .chart__svg');
  await scenarioChart.focus();
  await expect(scenarioChart).toBeFocused();
  await scenarioChart.press('ArrowRight');
  await expect(page.locator('.chart__tooltip')).toBeVisible();
  await compare.tap();
  await expect(comparison).toBeVisible();
  expect(await overflow(page), 'comparison after switching').toBeLessThanOrEqual(0);

  // A scenario's row in the key figures opens it. The tap moves focus to the
  // scenario's tab, and a phone would ring that tab unless told otherwise.
  const table = comparison.getByRole('table', { name: 'Key figures for each scenario' });
  await table.scrollIntoViewIfNeeded();
  expect(await overflow(page), 'key figures').toBeLessThanOrEqual(0);
  await table.getByRole('button', { name: 'save more aggressively' }).tap();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toBeInViewport({ ratio: 1 });
  expect((await tabs.nth(1).boundingBox())!.y, 'room above the tab').toBeGreaterThanOrEqual(8);
  expect(await tabs.nth(1).evaluate((tab) => getComputedStyle(tab).outlineStyle)).toBe('none');
  await expect(page.locator('.results-table')).toBeVisible();
  // Reached with the keyboard afterwards, the same tab shows its ring again.
  await tabs.nth(1).press('ArrowLeft');
  await tabs.first().press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
  expect(await tabs.nth(1).evaluate((tab) => getComputedStyle(tab).outlineStyle)).not.toBe('none');

  // The difference between two scenarios: its pickers and its chart answer a
  // finger, and nothing runs off the side.
  await compare.tap();
  const difference = page.locator('.difference');
  await difference.locator('.chart__svg').scrollIntoViewIfNeeded();
  expect(await overflow(page), 'difference').toBeLessThanOrEqual(0);
  const first = difference.getByLabel('Compare');
  const second = difference.getByLabel('against');
  await expect(first.locator('option:checked')).toHaveText('current path');
  await second.selectOption({ label: 'current path' });
  await expect(first.locator('option:checked')).toHaveText('save more aggressively');
  await expect(second.locator('option:checked')).toHaveText('current path');
  await expect(difference.locator('.difference__reading')).toContainText(
    'save more aggressively is ahead of current path',
  );
  const differenceChart = difference.locator('.chart__svg');
  await differenceChart.tap();
  await expect(difference.locator('.chart__tooltip')).toBeVisible();
  await differenceChart.focus();
  await differenceChart.press('End');
  await expect(difference.getByRole('status')).toContainText('liquid');
  expect(await overflow(page), 'difference after choosing').toBeLessThanOrEqual(0);

  // Tapping anywhere else on a row works too.
  await page.locator('.comparison').scrollIntoViewIfNeeded();
  await table.locator('tbody').getByRole('row').first().getByRole('cell').first().tap();
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  const violations: { nativeSelect: boolean; directive: string; blocked: string }[] =
    await page.evaluate(() => Reflect.get(window, 'comparisonPolicyViolations'));
  expect(violations.filter((violation) => !violation.nativeSelect)).toEqual([]);
  const selectMessage = "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";
  expect(found.filter((problem) => problem !== selectMessage)).toEqual([]);
  expect(found.filter((problem) => problem === selectMessage)).toHaveLength(violations.length);
});
