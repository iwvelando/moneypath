import { expect, test } from '@playwright/test';
import { problems, runForecast } from './helpers';

// Post-deploy smoke test. CI runs it against the preview build, and again
// against the live site with BASE_URL=https://moneypath.isaacvelando.com after
// each deploy. Keep it fast and read-only.
test('@smoke the engine loads and runs a forecast with no browser errors', async ({ page }) => {
  const found = problems(page);
  const wasm = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('.wasm'));
  await page.goto('/');
  const engine = (await wasm).headers();
  expect(engine['content-type']).toBe('application/wasm');
  // CloudFront compresses the engine to about a quarter of its size, choosing
  // Brotli or gzip per browser. If a distribution setting or the object's
  // content type changed, it would silently ship uncompressed; vite preview
  // never compresses, so this only applies to a deployed site.
  if (process.env.BASE_URL) expect(['br', 'gzip']).toContain(engine['content-encoding']);
  await expect(page.locator('html')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 });
  await runForecast(page);
  expect(await page.locator('.chart__line').count()).toBeGreaterThanOrEqual(2);
  expect(await page.locator('.results-table tbody tr').count()).toBeGreaterThan(10);
  expect(found).toEqual([]);
});
