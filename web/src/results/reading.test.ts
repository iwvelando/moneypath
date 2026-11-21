import { describe, expect, it } from 'vitest';
import type { ForecastResults, TodaysDollars } from '../engine/types';
import { inReading, pick, readingLabel } from './reading';

const nominal: ForecastResults = {
  version: 'test',
  scenarios: ['plan', 'other'],
  rows: [{ date: '2026-01', values: [{ liquid: 100, total: 200, notes: ['n'] }, null] }],
  csv: 'csv',
  metrics: [{ keyFigures: { lowestCash: 100, lowestCashDate: '2026-01', endingCash: 100, endingTotal: 200 } }, {}],
  comparisons: [],
  warnings: ['w'],
  configYaml: 'yaml',
};

const today: TodaysDollars = {
  today: '2026-01',
  rows: [{ date: '2026-01', values: [{ liquid: 90, total: 180, notes: ['n'] }, null] }],
  metrics: [{ keyFigures: { lowestCash: 90, lowestCashDate: '2026-01', endingCash: 90, endingTotal: 180 } }, {}],
  comparisons: [],
};

describe('reading results', () => {
  it('reads the nominal results as they are', () => {
    expect(inReading(nominal, 'nominal')).toBe(nominal);
    expect(inReading({ ...nominal, todaysDollars: today }, 'nominal').rows).toBe(nominal.rows);
  });

  it('reads today’s dollars from the engine’s second set, keeping everything else', () => {
    const shown = inReading({ ...nominal, todaysDollars: today }, 'today');
    expect(shown.rows).toBe(today.rows);
    expect(shown.metrics).toBe(today.metrics);
    expect(shown.comparisons).toBe(today.comparisons);
    expect(shown.scenarios).toBe(nominal.scenarios);
    expect(shown.csv).toBe('csv');
    expect(shown.warnings).toEqual(['w']);
  });

  it('falls back to nominal when the results have no today’s dollars', () => {
    expect(inReading(nominal, 'today')).toBe(nominal);
  });

  it('picks one answer of two, or the nominal one when there is no other', () => {
    expect(pick({ nominal: 1, today: 2 }, 'today')).toBe(2);
    expect(pick({ nominal: 1, today: 2 }, 'nominal')).toBe(1);
    expect(pick({ nominal: 1, today: null }, 'today')).toBe(1);
  });

  it('names the month whose prices it uses when that is not the current month', () => {
    expect(readingLabel('2026-06', '2026-06')).toBe('Today’s dollars');
    expect(readingLabel('2026-06', '2026-11')).toBe('Today’s dollars (June 2026)');
    expect(readingLabel('2027-01', '')).toBe('Today’s dollars (January 2027)');
  });
});
