import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForecastResults, ScenarioComparison, SeriesComparison } from '../engine/types';
import { Difference } from './Difference';

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

function series(difference: number[], breakEven: SeriesComparison['breakEven'] = []): SeriesComparison {
  return { difference, breakEven };
}

/**
 * Every scenario's monthly values are the same, so anything the section
 * shows can only have come from the comparisons the engine reported.
 */
function results(names: string[], comparisons: ScenarioComparison[] | undefined): ForecastResults {
  return {
    version: 'test',
    scenarios: names,
    rows: dates.map((date) => ({ date, values: names.map(() => ({ liquid: 1, total: 2, notes: [] })) })),
    csv: '',
    metrics: names.map(() => ({})),
    comparisons,
    warnings: [],
    configYaml: '',
  };
}

const names = ['rent', 'buy the house', 'sabbatical'];

const three = () =>
  results(names, [
    {
      scenario: 0,
      against: 1,
      cash: series([0, 400, -250], [{ date: '2026-03', leader: 1 }]),
      total: series([0, 150, 175]),
    },
    { scenario: 0, against: 2, cash: series([0, 20, 40]), total: series([0, 30, 60]) },
    {
      scenario: 1,
      against: 0,
      cash: series([0, -400, 250], [{ date: '2026-03', leader: 1 }]),
      total: series([0, -150, -175]),
    },
    { scenario: 1, against: 2, cash: series([0, -7, -9]), total: series([0, -11, -13]) },
    { scenario: 2, against: 0, cash: series([0, -20, -40]), total: series([0, -30, -60]) },
    {
      scenario: 2,
      against: 1,
      cash: series([0, 7, 9]),
      total: series([0, 11, -13], [
        { date: '2026-02', leader: 2 },
        { date: '2026-03', leader: 1 },
      ]),
    },
  ]);

function show(data: ForecastResults): void {
  act(() => {
    render(<Difference results={data} />, host);
  });
}

function picker(label: string): HTMLSelectElement {
  const found = [...host.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(label));
  const select = found?.querySelector('select');
  if (!select) throw new Error(`no picker labelled "${label}"`);
  return select;
}

function pick(label: string, scenario: number): void {
  act(() => {
    const select = picker(label);
    select.value = String(scenario);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function chosen(): string[] {
  return ['Compare', 'against'].map((label) => names[Number(picker(label).value)] ?? '');
}

function breakEven(seriesLabel: string): string {
  const found = [...host.querySelectorAll('.difference__breakeven > div')].find((row) =>
    row.querySelector('dt')?.textContent?.startsWith(seriesLabel),
  );
  return found?.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** What the chart reads out for the last month. */
function finalMonth(): string {
  const chart = host.querySelector('.chart__svg')!;
  act(() => {
    chart.dispatchEvent(new FocusEvent('focus'));
  });
  act(() => {
    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  });
  return host.querySelector('[role="status"]')?.textContent ?? '';
}

describe('the difference between two scenarios', () => {
  it('starts with the first scenario against the second', () => {
    show(three());
    expect(chosen()).toEqual(['rent', 'buy the house']);
    expect(host.querySelector('.difference__reading')?.textContent).toBe(
      'Above zero, rent is ahead of buy the house; below zero, it is behind.',
    );
  });

  it('charts the differences the engine reported for the pair', () => {
    show(three());
    expect(host.querySelectorAll('.chart__line')).toHaveLength(2);
    expect(finalMonth()).toBe('2026-03: liquid -$250.00, total $175.00');
    expect(host.querySelector('.chart__svg title')?.textContent).toContain(
      'Liquid and total net worth of rent minus buy the house, 2026-01 to 2026-03',
    );
  });

  it('names the month the other scenario moves ahead, for each series', () => {
    show(three());
    expect(breakEven('Liquid')).toBe('2026-03: buy the house moves ahead');
    expect(breakEven('Total')).toBe('The lead never changes hands.');
  });

  it('lists every break-even month in order', () => {
    show(three());
    pick('Compare', 2);
    expect(chosen()).toEqual(['sabbatical', 'buy the house']);
    expect(breakEven('Total')).toBe('2026-02: sabbatical moves ahead 2026-03: buy the house moves ahead');
    expect(host.querySelectorAll('.difference__breakeven li')).toHaveLength(2);
  });

  it('follows either picker to that pair', () => {
    show(three());
    pick('against', 2);
    expect(chosen()).toEqual(['rent', 'sabbatical']);
    expect(finalMonth()).toBe('2026-03: liquid $40.00, total $60.00');
    pick('Compare', 1);
    expect(chosen()).toEqual(['buy the house', 'sabbatical']);
    expect(finalMonth()).toBe('2026-03: liquid -$9.00, total -$13.00');
  });

  it('swaps the two when one picker chooses the scenario the other holds', () => {
    show(three());
    pick('Compare', 1);
    expect(chosen()).toEqual(['buy the house', 'rent']);
    pick('against', 1);
    expect(chosen()).toEqual(['rent', 'buy the house']);
  });

  it('goes back to the first two scenarios when a new run has fewer', () => {
    show(three());
    pick('against', 2);
    show(
      results(['rent', 'buy the house'], [
        { scenario: 0, against: 1, cash: series([0, 1, 2]), total: series([0, 3, 4]) },
        { scenario: 1, against: 0, cash: series([0, -1, -2]), total: series([0, -3, -4]) },
      ]),
    );
    expect(chosen()).toEqual(['rent', 'buy the house']);
    expect(finalMonth()).toBe('2026-03: liquid $2.00, total $4.00');
  });

  it('is left out when the engine reported no comparison', () => {
    show(results(names, undefined));
    expect(host.innerHTML).toBe('');
    show(results(names, []));
    expect(host.innerHTML).toBe('');
  });
});
