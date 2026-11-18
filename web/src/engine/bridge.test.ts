import { describe, expect, it } from 'vitest';
import { decodeForecast, decodeProblems } from './bridge';

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

  it('keeps the earliest month the engine reported, and reads a result without one as having none', () => {
    const earliest = {
      scenario: 0,
      entry: 'common.loans.0',
      name: 'Car',
      field: 'startDate',
      from: '2026-01',
      to: '2026-06',
      guardrails: ['Cushion'],
      configured: '2026-04',
      works: [],
      holds: [{ name: 'Cushion', months: [] }],
    };
    expect(decodeForecast(JSON.stringify({ ...base, earliest })).earliest).toEqual(earliest);
    expect(decodeForecast(JSON.stringify(base)).earliest).toBeNull();
  });
});

describe('decoding problems', () => {
  it('keeps each problem the engine reported', () => {
    const problems = [
      { level: 'error', path: 'common.loans.0.term', where: 'Baseline, loan “Car”', message: 'The term must be 1 month or more.' },
      { level: 'warning', path: 'simulation.startingCash', where: 'Simulation', message: 'No starting cash is given.' },
    ];
    expect(decodeProblems(JSON.stringify({ problems }))).toEqual(problems);
  });

  it('reads a reply without problems as none', () => {
    expect(decodeProblems('{"problems":[]}')).toEqual([]);
    expect(decodeProblems('{}')).toEqual([]);
  });

  it('refuses a reply it cannot read, and an engine error', () => {
    expect(() => decodeProblems('nope')).toThrow();
    expect(() => decodeProblems('{"error":"bad options"}')).toThrow('bad options');
  });
});
