import { describe, expect, it } from 'vitest';
import { decodeForecast } from './bridge';

const base = { version: 'v', scenarios: ['a', 'b'], rows: [], csv: '', metrics: [{}, {}], warnings: [], configYaml: '' };

describe('decoding a forecast', () => {
  it('keeps the comparisons the engine reported', () => {
    const comparisons = [
      { scenario: 0, against: 1, cash: { difference: [1], breakEven: [] }, total: { difference: [2], breakEven: [] } },
    ];
    expect(decodeForecast(JSON.stringify({ ...base, comparisons })).comparisons).toEqual(comparisons);
  });

  it('reads a result without comparisons as having none', () => {
    expect(decodeForecast(JSON.stringify(base)).comparisons).toEqual([]);
  });

  it('keeps the flip the engine reported, and reads a result without one as having none', () => {
    const flip = {
      scenario: 0,
      choice: 'Home',
      option: 'Move',
      name: 'a (Home: Move)',
      cash: { difference: [1], breakEven: [{ date: '2026-01', flipped: true }] },
      total: { difference: [2], breakEven: [] },
    };
    expect(decodeForecast(JSON.stringify({ ...base, flip })).flip).toEqual(flip);
    expect(decodeForecast(JSON.stringify(base)).flip).toBeNull();
  });
});
