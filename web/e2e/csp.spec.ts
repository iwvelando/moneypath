import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openApp, problems, runForecast } from './helpers';

// The production Content-Security-Policy. CloudFront sends it (iwvelando/cloud-accounts,
// sites/moneypath.isaacvelando.com), vite preview sends it here, and the deploy
// job checks the live header still matches this file.
const policy = readFileSync('../deploy/content-security-policy.txt', 'utf8').trim();

test('preview serves the production Content-Security-Policy', async ({ request }) => {
  const response = await request.get('/');
  expect(response.headers()['content-security-policy']).toBe(policy);
});

test('the engine, a forecast, and both downloads run under the policy', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  // No mock-engine notice: production must run the real engine or say it failed.
  await expect(page.getByText(/mock engine/i)).toHaveCount(0);
  await runForecast(page);
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  expect((await csv).suggestedFilename()).toBe('moneypath.csv');
  const yaml = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Config' }).click();
  expect((await yaml).suggestedFilename()).toBe('moneypath.yaml');
  expect(found).toEqual([]);
});

test('the not-found page renders under the policy', async ({ page }) => {
  const found = problems(page);
  await page.goto('/404.html');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: /moneypath/ })).toHaveAttribute('href', '/');
  expect(found).toEqual([]);
});
