import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForecastResults, ScenarioValue } from '../engine/types';
import { Comparison } from './Comparison';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

const dates = ['2026-01', '2026-02', '2026-03'];

function value(liquid: number, total: number): ScenarioValue {
  return { liquid, total, notes: [] };
}

/** One column of values per scenario, in the order the names are given. */
function results(scenarios: Record<string, (ScenarioValue | null)[]>): ForecastResults {
  const names = Object.keys(scenarios);
  return {
    version: 'test',
    scenarios: names,
    rows: dates.map((date, row) => ({
      date,
      values: names.map((name) => scenarios[name]?.[row] ?? null),
    })),
    csv: '',
    metrics: names.map(() => ({ optimizations: [] })),
    warnings: [],
    configYaml: '',
  };
}

const three = () =>
  results({
    steady: [value(100, 1000), value(200, 2000), value(300, 3000)],
    'buy the house': [value(50, 900), value(-400, 1500), value(-250, 2500)],
    sabbatical: [value(80, 800), value(60, 700), value(40, 600)],
  });

function show(data: ForecastResults): void {
  act(() => {
    render(<Comparison results={data} />, host);
  });
}

function legend(): { name: string; value: string }[] {
  return [...host.querySelectorAll('.comparison__legend li')].map((item) => ({
    name: item.querySelector('.comparison__name')?.textContent ?? '',
    value: item.querySelector('.comparison__value')?.textContent ?? '',
  }));
}

function seriesButton(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('[role="group"] button')].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no series button labelled "${label}"`);
  return found;
}

function key(name: string): void {
  act(() => {
    host
      .querySelector('.chart__svg')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });
}

function focusChart(): void {
  act(() => {
    host.querySelector('.chart__svg')!.dispatchEvent(new FocusEvent('focus'));
  });
}

describe('the scenario comparison', () => {
  it('names every scenario once, in the order the plan lists them', () => {
    show(three());
    expect(legend().map((entry) => entry.name)).toEqual(['steady', 'buy the house', 'sabbatical']);
  });

  it('draws one line per scenario', () => {
    show(three());
    expect(host.querySelectorAll('.chart__line')).toHaveLength(3);
  });

  it('tells neighbouring scenarios apart by more than color', () => {
    show(three());
    const lines = [...host.querySelectorAll('.chart__line')];
    const dashes = lines.map((line) => [...line.classList].find((c) => c.startsWith('chart__dash--')));
    const colors = lines.map((line) => [...line.classList].find((c) => c.startsWith('chart__scenario--')));
    expect(new Set(dashes).size).toBe(3);
    expect(new Set(colors).size).toBe(3);
    // The legend carries the same line style, so it can be matched without color.
    const swatches = [...host.querySelectorAll('.comparison__legend li .chart__line-sample')];
    expect(swatches.map((s) => [...s.classList].find((c) => c.startsWith('chart__dash--')))).toEqual(dashes);
  });

  it('leads with the total and reads the final month until one is chosen', () => {
    show(three());
    expect(seriesButton('Total').getAttribute('aria-pressed')).toBe('true');
    expect(seriesButton('Liquid').getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('.comparison__month')?.textContent).toContain('2026-03');
    expect(legend().map((entry) => entry.value)).toEqual(['$3,000.00', '$2,500.00', '$600.00']);
  });

  it('switches every scenario to the liquid series', () => {
    show(three());
    act(() => seriesButton('Liquid').click());
    expect(seriesButton('Liquid').getAttribute('aria-pressed')).toBe('true');
    expect(seriesButton('Total').getAttribute('aria-pressed')).toBe('false');
    expect(legend().map((entry) => entry.value)).toEqual(['$300.00', '-$250.00', '$40.00']);
    expect(host.querySelector('.chart__svg title')?.textContent).toContain('Liquid');
  });

  it('fits a scale around every scenario, including one that goes negative', () => {
    show(three());
    act(() => seriesButton('Liquid').click());
    const ticks = [...host.querySelectorAll('.chart__grid .chart__tick')].map((n) => n.textContent ?? '');
    expect(ticks.some((label) => label.startsWith('-'))).toBe(true);
    expect(host.querySelector('.chart__zero')).not.toBeNull();

    const gridYs = [...host.querySelectorAll('.chart__grid line')].map((n) => Number(n.getAttribute('y1')));
    const top = Math.min(...gridYs);
    const bottom = Math.max(...gridYs);
    const ys = [...host.querySelectorAll('.chart__line')].flatMap((line) =>
      (line.getAttribute('points') ?? '').split(' ').map((point) => Number(point.split(',')[1])),
    );
    expect(ys).toHaveLength(9);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(top);
      expect(y).toBeLessThanOrEqual(bottom);
    }
  });

  it('reads each scenario for a month chosen with the keyboard', () => {
    show(three());
    const svg = host.querySelector('.chart__svg')!;
    // An svg keeps the attribute's case, and Safari needs it in lower case.
    expect(svg.getAttribute('tabindex')).toBe('0');
    focusChart();
    expect(host.querySelector('.comparison__month')?.textContent).toContain('2026-01');
    key('ArrowRight');
    expect(host.querySelector('.comparison__month')?.textContent).toContain('2026-02');
    expect(legend().map((entry) => entry.value)).toEqual(['$2,000.00', '$1,500.00', '$700.00']);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      '2026-02, total: steady $2,000.00, buy the house $1,500.00, sabbatical $700.00',
    );
    key('End');
    expect(host.querySelector('.comparison__month')?.textContent).toContain('2026-03');
    key('Home');
    expect(host.querySelector('.comparison__month')?.textContent).toContain('2026-01');
  });

  // jsdom has no layout: the chart is 320 wide and its plot runs from x=72 to x=292.
  function pointer(type: string, pointerType: string, clientX = 0, target?: Element): void {
    act(() => {
      const event = new MouseEvent(type, { bubbles: type !== 'pointerleave', clientX });
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      (target ?? host.querySelector('.chart__svg')!).dispatchEvent(event);
    });
  }
  const monthText = () => host.querySelector('.comparison__month')?.textContent ?? '';

  it('follows a mouse and lets go when it leaves', () => {
    show(three());
    pointer('pointermove', 'mouse', 72);
    expect(monthText()).toContain('2026-01');
    pointer('pointerleave', 'mouse');
    expect(monthText()).toContain('2026-03');
    expect(monthText()).toContain('final month');
  });

  it('keeps the month a finger tapped until the next tap elsewhere', () => {
    show(three());
    pointer('pointerdown', 'touch', 182);
    expect(monthText()).toContain('2026-02');
    // Lifting the finger ends the touch; the reading stays.
    pointer('pointerleave', 'touch');
    expect(monthText()).toContain('2026-02');
    pointer('pointerdown', 'touch', 72);
    expect(monthText()).toContain('2026-01');
    pointer('pointerdown', 'touch', 0, document.body);
    expect(monthText()).toContain('final month');
  });

  it('goes back to the final month when the chart loses focus', () => {
    show(three());
    focusChart();
    act(() => {
      host.querySelector('.chart__svg')!.dispatchEvent(new FocusEvent('blur'));
    });
    expect(host.querySelector('.comparison__month')?.textContent).toContain('2026-03');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('shows a dash where a scenario has no value for the month', () => {
    show(
      results({
        steady: [value(100, 1000), value(200, 2000), value(300, 3000)],
        late: [null, value(10, 20), null],
      }),
    );
    expect(legend().map((entry) => entry.value)).toEqual(['$3,000.00', '—']);
    focusChart();
    key('ArrowRight');
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      '2026-02, total: steady $2,000.00, late $20.00',
    );
    key('ArrowRight');
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      '2026-03, total: steady $3,000.00, late no value',
    );
  });

  it('marks a negative value in the readout', () => {
    show(three());
    act(() => seriesButton('Liquid').click());
    const values = [...host.querySelectorAll('.comparison__value')];
    expect(values[1]?.classList.contains('is-negative')).toBe(true);
    expect(values[0]?.classList.contains('is-negative')).toBe(false);
  });

  it('keeps scenarios that share a name apart', () => {
    const data = three();
    data.scenarios = ['twin', 'twin', 'other'];
    show(data);
    expect(legend().map((entry) => entry.name)).toEqual(['twin', 'twin', 'other']);
    expect(host.querySelectorAll('.chart__line')).toHaveLength(3);
  });

  it('says so when there is nothing to draw', () => {
    show(results({ a: [null, null, null], b: [null, null, null] }));
    expect(host.querySelector('.chart--empty')).not.toBeNull();
    expect(host.querySelector('.chart__line')).toBeNull();
  });
});
