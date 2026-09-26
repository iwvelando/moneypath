// Renders the link-preview card (public/og-image.png) from the built site, so
// it carries moneypath's own chart, type, and colours: the starter plan's
// forecast, drawn by the real engine, under the app's brand. Run `make
// share-card` (which builds first), check the image by eye, and commit it; it
// changes only when the site's look does.
//
// Fonts come from the machine that renders; the app uses a system stack, so
// render on macOS.
import { chromium } from '@playwright/test';
import { preview } from 'vite';

// Not 4173: that port belongs to the Playwright test server.
const server = await preview({ preview: { host: '127.0.0.1', port: 4174, strictPort: true } });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  await page.goto('http://127.0.0.1:4174/');
  await page.waitForSelector('html[data-engine=ready]');
  await page.getByRole('button', { name: 'Run Forecast' }).first().click();
  await page.waitForSelector('.chart__svg .chart__line');

  // The chart without its hover cursor or tick labels, over the header's
  // brand. Stacked and centred so a square crop keeps both.
  await page.evaluate(() => {
    // Clones, not the live nodes: the chart redraws itself when its container
    // resizes, and moving it out would shrink it to its minimum width.
    const svg = document.querySelector('.chart__svg').cloneNode(true);
    for (const noise of svg.querySelectorAll('.chart__cursor, .chart__tick, .chart__axis')) noise.remove();

    const brand = document.querySelector('.appbar__brand').cloneNode(true);
    brand.style.cssText = 'gap: 22px';
    const mark = brand.querySelector('.brandmark');
    mark.setAttribute('width', '76');
    mark.setAttribute('height', '76');
    brand.querySelector('h1').style.cssText = 'font-size: 60px; line-height: 1';
    brand.querySelector('p').style.cssText = 'font-size: 22px; margin-top: 8px';

    const card = document.createElement('main');
    card.style.cssText = `
      width: 1200px; height: 630px; box-sizing: border-box; padding: 44px 80px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 34px; background: var(--bg); color: var(--text);`;
    card.append(brand, svg);
    document.body.replaceChildren(card);
    document.body.style.margin = '0';

    // Crop to what is drawn, now that the tick labels' margin is empty.
    const box = svg.getBBox();
    const pad = Math.max(box.width, box.height) * 0.02;
    const [x, y, w, h] = [box.x - pad, box.y - pad, box.width + 2 * pad, box.height + 2 * pad];
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    const scale = Math.min(1040 / w, 360 / h);
    svg.setAttribute('width', String(w * scale));
    svg.setAttribute('height', String(h * scale));
  });
  await page.screenshot({ path: 'public/og-image.png' });
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
console.log('Wrote public/og-image.png.');
