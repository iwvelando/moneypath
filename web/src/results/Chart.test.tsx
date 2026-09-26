import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Chart } from './Chart';

let host: HTMLDivElement;

const dates = ['2026-01', '2026-02', '2026-03', '2026-04'];

function renderChart(liquid: (number | null)[], total: (number | null)[]) {
  render(<Chart dates={dates} liquid={liquid} total={total} scenarioName="base" />, host);
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe('Chart graphics', () => {
  it('points every area fill at a gradient that exists in the same svg', () => {
    renderChart([100, 200, 300, 400], [150, 260, 380, 500]);
    const defined = new Set(
      [...host.querySelectorAll('linearGradient')].map((node) => node.getAttribute('id')),
    );
    const areas = [...host.querySelectorAll('.chart__area')];
    expect(areas.length).toBeGreaterThan(0);
    for (const area of areas) {
      const id = (area.getAttribute('fill') ?? '').replace(/^url\(#|\)$/g, '');
      // A dangling reference renders as no fill at all, silently.
      expect(defined).toContain(id);
    }
  });

  it('labels the last real value of each series', () => {
    renderChart([100, 200, 300, 400], [150, 260, 380, 500]);
    const labels = [...host.querySelectorAll('.chart__endlabel')].map((node) => node.textContent);
    expect(labels).toContain('$400');
    expect(labels).toContain('$500');
  });

  it('labels the last present value when a series ends in a gap', () => {
    renderChart([100, 200, 300, null], [150, 260, 380, 500]);
    const labels = [...host.querySelectorAll('.chart__endlabel')].map((node) => node.textContent);
    expect(labels).toContain('$300');
  });

  it('keeps both end labels apart when the series finish together', () => {
    renderChart([400, 400, 400, 400], [401, 401, 401, 401]);
    const ys = [...host.querySelectorAll('.chart__endlabel')].map((node) =>
      Number(node.getAttribute('y')),
    );
    expect(ys).toHaveLength(2);
    expect(Math.abs((ys[0] as number) - (ys[1] as number))).toBeGreaterThanOrEqual(15);
  });

  it('keeps the decorative layers out of the accessibility tree', () => {
    renderChart([100, 200, 300, 400], [150, 260, 380, 500]);
    for (const node of host.querySelectorAll('.chart__area, .chart__endlabel')) {
      expect(node.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('still renders the empty state, with no area fills, when there is no data', () => {
    renderChart([null, null, null, null], [null, null, null, null]);
    expect(host.querySelector('.chart--empty')).not.toBeNull();
    expect(host.querySelector('.chart__area')).toBeNull();
  });

  it('spaces date labels so they never run together on a narrow chart', () => {
    // jsdom has no layout, so the chart draws at its narrowest (phone) width.
    const months = Array.from({ length: 361 }, (_, i) => {
      const year = 2026 + Math.floor(i / 12);
      return `${year}-${String((i % 12) + 1).padStart(2, '0')}`;
    });
    const values = months.map((_, i) => i * 100);
    act(() => {
      render(<Chart dates={months} liquid={values} total={values} scenarioName="base" />, host);
    });
    expect(host.querySelector('.chart__svg')?.getAttribute('viewBox')).toBe('0 0 320 340');
    const xs = [...host.querySelectorAll('.chart__axis text')].map((node) => Number(node.getAttribute('x')));
    expect(xs.length).toBeGreaterThanOrEqual(2);
    // A YYYY-MM label is about 45 px wide at the axis font size.
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(52);
  });
});
