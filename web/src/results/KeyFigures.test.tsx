import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmergencyFundMetrics, ForecastResults, KeyFigureMetrics, ScenarioMetrics } from '../engine/types';
import { KeyFigures } from './KeyFigures';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function figures(lowestCash: number, lowestCashDate: string, endingCash: number, endingTotal: number): KeyFigureMetrics {
  return { lowestCash, lowestCashDate, endingCash, endingTotal };
}

function fund(shortfall: number, surplus: number): EmergencyFundMetrics {
  return {
    targetMonths: 6,
    averageMonthlyExpenses: 1000,
    targetAmount: 6000,
    initialLiquid: 6000 - shortfall + surplus,
    fundedMonths: 6,
    shortfall,
    surplus,
  };
}

/**
 * The rows deliberately disagree with the metrics: the table must show what
 * the engine reported, not something worked out from the monthly values.
 */
function results(scenarios: Record<string, ScenarioMetrics>): ForecastResults {
  const names = Object.keys(scenarios);
  return {
    version: 'test',
    scenarios: names,
    rows: ['2026-01', '2026-02'].map((date) => ({
      date,
      values: names.map(() => ({ liquid: 1, total: 2, notes: [] })),
    })),
    csv: '',
    metrics: names.map((name) => scenarios[name]!),
    warnings: [],
    configYaml: '',
  };
}

const three = () =>
  results({
    'dips twice': { keyFigures: figures(3000, '2025-02', 5500, 16115.2015), emergencyFund: fund(0, 1000) },
    'only grows': { keyFigures: figures(5000, '2025-01', 8000, 18615.2015), emergencyFund: fund(0, 0) },
    'spends down': { keyFigures: figures(-1000, '2025-07', -1000, 9615.2015), emergencyFund: fund(1000, 0) },
  });

function show(data: ForecastResults, onOpenScenario: (index: number, byPointer: boolean) => void = () => {}): void {
  act(() => {
    render(<KeyFigures results={data} onOpenScenario={onOpenScenario} />, host);
  });
}

function text(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function headers(): string[] {
  return [...host.querySelectorAll('thead th')].map(text);
}

/** Each body row as its cells' text, with the labels meant only for sight removed. */
function body(): string[][] {
  return [...host.querySelectorAll('tbody tr')].map((row) =>
    [...row.children].map((cell) => {
      const copy = cell.cloneNode(true) as Element;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
      return text(copy);
    }),
  );
}

describe('the key figures table', () => {
  it('is a table with a caption, column headers and a row header per scenario', () => {
    show(three());
    const table = host.querySelector('table')!;
    expect(text(table.querySelector('caption'))).toBe('Key figures for each scenario');
    expect(headers()).toEqual(['Scenario', 'Lowest cash', 'Ending cash', 'Ending total', 'Emergency fund']);
    expect([...host.querySelectorAll('thead th')].every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    const rowHeaders = [...host.querySelectorAll('tbody th')];
    expect(rowHeaders.map(text)).toEqual(['dips twice', 'only grows', 'spends down']);
    expect(rowHeaders.every((th) => th.getAttribute('scope') === 'row')).toBe(true);
  });

  it('keeps its table roles when the stylesheet lays it out as stacked blocks', () => {
    show(three());
    expect(host.querySelector('table')!.getAttribute('role')).toBe('table');
    expect([...host.querySelectorAll('tr')].every((tr) => tr.getAttribute('role') === 'row')).toBe(true);
    expect([...host.querySelectorAll('thead th')].every((th) => th.getAttribute('role') === 'columnheader')).toBe(true);
    expect([...host.querySelectorAll('tbody th')].every((th) => th.getAttribute('role') === 'rowheader')).toBe(true);
    expect([...host.querySelectorAll('td')].every((td) => td.getAttribute('role') === 'cell')).toBe(true);
  });

  it('shows the figures the engine reported, a row per scenario in the plan’s order', () => {
    show(three());
    expect(body()).toEqual([
      ['dips twice', '$3,000.00 in 2025-02', '$5,500.00', '$16,115.20', '$1,000.00 surplus'],
      ['only grows', '$5,000.00 in 2025-01', '$8,000.00', '$18,615.20', 'On target'],
      ['spends down', '-$1,000.00 in 2025-07', '-$1,000.00', '$9,615.20', '$1,000.00 short'],
    ]);
  });

  it('repeats each column’s name beside its value for sighted readers of the stacked layout only', () => {
    show(three());
    const cells = [...host.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')];
    const labels = cells.map((cell) => cell.querySelector('.figures-table__label'));
    expect(labels.map(text)).toEqual(['Lowest cash', 'Ending cash', 'Ending total', 'Emergency fund']);
    expect(labels.every((label) => label?.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('marks money below zero and an emergency-fund shortfall', () => {
    show(three());
    const row = (index: number) => [...host.querySelectorAll('tbody tr')[index]!.querySelectorAll('td')];
    expect(row(0).map((cell) => cell.classList.contains('is-negative'))).toEqual([false, false, false, false]);
    expect(row(2).map((cell) => cell.classList.contains('is-negative'))).toEqual([true, true, false, true]);
  });

  it('leaves the emergency-fund column out when the recommendation is disabled', () => {
    show(
      results({
        a: { keyFigures: figures(100, '2026-01', 200, 300) },
        b: { keyFigures: figures(50, '2026-02', 60, 70), emergencyFund: null },
      }),
    );
    expect(headers()).toEqual(['Scenario', 'Lowest cash', 'Ending cash', 'Ending total']);
    expect(body()).toEqual([
      ['a', '$100.00 in 2026-01', '$200.00', '$300.00'],
      ['b', '$50.00 in 2026-02', '$60.00', '$70.00'],
    ]);
    expect(host.textContent).not.toContain('$0.00');
  });

  it('shows dashes, not zeros, for a scenario the engine reported no figures for', () => {
    show(results({ a: { keyFigures: figures(100, '2026-01', 200, 300) }, b: {} }));
    expect(body()[1]).toEqual(['b', '—', '—', '—']);
  });

  it('opens a scenario from its name, saying whether a pointer or the keyboard chose it', () => {
    const open = vi.fn();
    show(three(), open);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('tbody th button')];
    expect(buttons.map(text)).toEqual(['dips twice', 'only grows', 'spends down']);
    // A keyboard activation is a click that no pointer press counted.
    act(() => {
      buttons[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    });
    expect(open.mock.calls).toEqual([[1, false]]);
    act(() => {
      buttons[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(open.mock.calls).toEqual([[1, false], [2, true]]);
  });

  it('opens a scenario from anywhere on its row', () => {
    const open = vi.fn();
    show(three(), open);
    const cell = host.querySelectorAll('tbody tr')[0]!.querySelector('td')!;
    act(() => {
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(open.mock.calls).toEqual([[0, true]]);
  });

  it('keeps scenarios that share a name apart', () => {
    const data = three();
    data.scenarios = ['same', 'same', 'same'];
    const open = vi.fn();
    show(data, open);
    expect(body().map((row) => row[1])).toEqual(['$3,000.00 in 2025-02', '$5,000.00 in 2025-01', '-$1,000.00 in 2025-07']);
    act(() => host.querySelectorAll<HTMLButtonElement>('tbody th button')[2]!.click());
    expect(open.mock.calls[0]?.[0]).toBe(2);
  });
});
