import { expect, type Page } from '@playwright/test';

/** Open the app and wait until the WebAssembly engine has answered. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 });
}

/** Run the starter plan and wait for the Results view to draw its chart. */
export async function runForecast(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run Forecast' }).first().click();
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.chart__svg')).toBeVisible();
}

/** Collects anything the browser reports as broken while a test runs. */
export function problems(page: Page): string[] {
  const found: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().includes('Content Security Policy')) found.push(m.text());
  });
  page.on('pageerror', (e) => found.push(e.message));
  page.on('requestfailed', (r) => found.push(`${r.url()} failed`));
  page.on('response', (r) => {
    if (r.status() >= 400) found.push(`${r.url()} returned ${r.status()}`);
  });
  return found;
}

/** Sideways scroll in CSS pixels; anything above zero is a layout bug on a phone. */
export async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
