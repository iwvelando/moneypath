import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Search engines read these from the public host's root, so they carry absolute
// URLs, like the link-preview tags. The sitemap lists the one page there is: the
// app has no client-side routing and no deep-linkable views.
const canonical = readFileSync('index.html', 'utf8').match(/rel="canonical" href="([^"]+)"/)![1];

test('@smoke robots.txt allows crawling and points at the sitemap', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^text\/plain/);
  const body = await response.text();
  expect(body).toMatch(/^User-agent: \*$/m);
  expect(body).not.toMatch(/^Disallow: \/\S/m);
  expect(body).toMatch(new RegExp(`^Sitemap: ${canonical}sitemap\\.xml$`, 'm'));
});

test('@smoke sitemap.xml lists the canonical page', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/xml/);
  const body = await response.text();
  expect(body).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  expect([...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual([canonical]);
});
