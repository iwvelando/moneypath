// Render the full branching-path logo and wordmark from the built app.
// This is a brand illustration, not a forecast. Run `make share-card` and
// check the image by eye when the identity changes. Render on macOS so the
// system serif matches the app's usual presentation.
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const server = await preview({ preview: { host: '127.0.0.1', port: 4174, strictPort: true } });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  await page.goto('http://127.0.0.1:4174/');
  await page.waitForSelector('.path-sketch');
  await page.evaluate(() => {
    const logo = document.querySelector('.path-sketch').cloneNode(true);
    logo.style.cssText = 'display: block; width: 640px; height: auto; flex: none';
    const wordmark = document.querySelector('.appbar__brand > div').cloneNode(true);
    wordmark.querySelector('h1').style.cssText = 'font: 400 76px/1.1 var(--serif); letter-spacing: -2px';
    wordmark.querySelector('p').style.cssText = 'font-size: 22px; margin-top: 16px; color: var(--text-muted)';
    const card = document.createElement('main');
    card.style.cssText = `
      width: 1200px; height: 630px; padding: 60px 80px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 58px; text-align: center; background: var(--bg); color: var(--text);`;
    card.append(wordmark, logo);
    document.body.replaceChildren(card);
    document.body.style.margin = '0';
  });
  await page.screenshot({ path: 'public/og-image.png' });
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
console.log('Wrote public/og-image.png.');
