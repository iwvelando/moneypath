import { describe, expect, it } from 'vitest';
import type { ForecastResults, ScenarioValue } from '../engine/types';
import { pathOwes, runOwes, seriesDiffer } from './balance';

function value(liabilities?: number): ScenarioValue {
  return { liquid: 1, total: 2, liabilities, netWorth: liabilities === undefined ? undefined : 2 - liabilities, notes: [] };
}

function results(columns: ScenarioValue[][]): ForecastResults {
  return {
    version: 'test',
    scenarios: columns.map((_, i) => `s${i}`),
    rows: ['2026-01', '2026-02'].map((date, row) => ({ date, values: columns.map((column) => column[row] ?? null) })),
    csv: '',
    metrics: columns.map(() => ({})),
    warnings: [],
    configYaml: '',
  };
}

describe('whether a path owes anything', () => {
  it('is true when some month owes at least a cent', () => {
    const data = results([[value(0), value(0.004)], [value(0), value(250)]]);
    expect(pathOwes(data.rows, 0)).toBe(false);
    expect(pathOwes(data.rows, 1)).toBe(true);
    expect(runOwes(data)).toBe(true);
  });

  it('is false for results that carry no liabilities', () => {
    const data = results([[value(), value()]]);
    expect(pathOwes(data.rows, 0)).toBe(false);
    expect(runOwes(data)).toBe(false);
  });
});

describe('whether two series differ', () => {
  it('compares in whole cents', () => {
    expect(seriesDiffer([1, 2.001], [1, 2])).toBe(false);
    expect(seriesDiffer([1, 2.01], [1, 2])).toBe(true);
    expect(seriesDiffer(undefined, [1, 2])).toBe(false);
  });
});
