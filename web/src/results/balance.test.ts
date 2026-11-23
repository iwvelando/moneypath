import { describe, expect, it } from 'vitest';
import type { ForecastResults, ScenarioValue } from '../engine/types';
import { pathHasBalance, pathHolds, runHasBalance, runHolds, seriesDiffer } from './balance';

function value(liabilities?: number, assets?: number): ScenarioValue {
  const netWorth = liabilities === undefined ? undefined : 2 + (assets ?? 0) - liabilities;
  return { liquid: 1, total: 2, liabilities, netWorth, assets, equity: assets, notes: [] };
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

describe('whether a path has a balance sheet beyond its total', () => {
  it('is true when some month owes at least a cent', () => {
    const data = results([[value(0), value(0.004)], [value(0), value(250)]]);
    expect(pathHasBalance(data.rows, 0)).toBe(false);
    expect(pathHasBalance(data.rows, 1)).toBe(true);
    expect(runHasBalance(data)).toBe(true);
  });

  it('is true when some month holds an asset, with nothing owed', () => {
    const data = results([[value(0, 0), value(0, 0)], [value(0, 0), value(0, 15000)]]);
    expect(pathHasBalance(data.rows, 0)).toBe(false);
    expect(pathHasBalance(data.rows, 1)).toBe(true);
    expect(pathHolds(data.rows, 0)).toBe(false);
    expect(pathHolds(data.rows, 1)).toBe(true);
    expect(runHasBalance(data)).toBe(true);
    expect(runHolds(data)).toBe(true);
  });

  it('is false for results that carry no liabilities or assets', () => {
    const data = results([[value(), value()]]);
    expect(pathHasBalance(data.rows, 0)).toBe(false);
    expect(pathHolds(data.rows, 0)).toBe(false);
    expect(runHasBalance(data)).toBe(false);
    expect(runHolds(data)).toBe(false);
  });
});

describe('whether two series differ', () => {
  it('compares in whole cents', () => {
    expect(seriesDiffer([1, 2.001], [1, 2])).toBe(false);
    expect(seriesDiffer([1, 2.01], [1, 2])).toBe(true);
    expect(seriesDiffer(undefined, [1, 2])).toBe(false);
  });
});
