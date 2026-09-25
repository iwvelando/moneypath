import { describe, expect, it } from 'vitest';
import { adjustmentStatus, adjustmentsOf, applyAdjustment, applyAdjustments } from './adjustments';
import type { ConfigModel, EventModel, OptimizeField, ScenarioModel } from './types';
import type { ForecastResults, OptimizationSummary } from '../engine/types';

function event(id: string, extra: Partial<EventModel> = {}): EventModel {
  return {
    id,
    name: id,
    amount: null,
    percentage: null,
    frequency: null,
    startDate: '',
    endDate: '',
    optimize: null,
    ...extra,
  };
}

function optimizedEvent(id: string, field: OptimizeField, extra: Partial<EventModel> = {}): EventModel {
  return event(id, {
    optimize: {
      field,
      min: -500,
      max: 0,
      minDate: '',
      maxDate: '',
      tolerance: null,
      maxIterations: null,
    },
    ...extra,
  });
}

function scenario(name: string, events: EventModel[], active = true): ScenarioModel {
  return { id: `sc-${name}`, name, active, events, loans: [], investments: [] };
}

function config(scenarios: ScenarioModel[]): ConfigModel {
  return {
    simulation: { startDate: '2025-01', endDate: '2026-12', startingCash: 5000, emergencyFundMonths: 3 },
    common: { events: [], loans: [], investments: [] },
    scenarios,
  };
}

function summary(extra: Partial<OptimizationSummary> = {}): OptimizationSummary {
  return {
    targetName: 'New expense',
    field: 'amount',
    original: -500,
    value: -184.72,
    originalDisplay: '-$500.00',
    valueDisplay: '-$184.72',
    floor: 6275,
    minimumCash: 6275.04,
    headroom: 0.04,
    iterations: 16,
    converged: true,
    notes: [],
    ...extra,
  };
}

function results(scenarios: string[], optimizations: OptimizationSummary[][]): ForecastResults {
  return {
    version: 'test',
    scenarios,
    rows: [],
    csv: '',
    metrics: optimizations.map((list) => ({ optimizations: list })),
    warnings: [],
    configYaml: '',
  };
}

describe('adjustmentsOf', () => {
  it('pairs each adjustment with its scenario and its position in that scenario', () => {
    const list = adjustmentsOf(results(['a', 'b'], [[summary()], [summary(), summary()]]));
    expect(list.map((a) => [a.scenarioName, a.ordinal])).toEqual([
      ['a', 0],
      ['b', 0],
      ['b', 1],
    ]);
  });

  it('is empty when the run had no optimizer', () => {
    expect(adjustmentsOf(results(['a'], [[]]))).toEqual([]);
  });
});

describe('applyAdjustment', () => {
  it('writes a chosen amount into the target event', () => {
    const before = config([scenario('plan', [event('income'), optimizedEvent('expense', 'amount')])]);
    const [adjustment] = adjustmentsOf(results(['plan'], [[summary()]]));
    const after = applyAdjustment(before, adjustment!);
    expect(after.scenarios[0]!.events[1]!.amount).toBe(-184.72);
    // Untouched events keep their identity.
    expect(after.scenarios[0]!.events[0]).toBe(before.scenarios[0]!.events[0]);
  });

  it('does not mutate the config it is given', () => {
    const before = config([scenario('plan', [optimizedEvent('expense', 'amount')])]);
    const [adjustment] = adjustmentsOf(results(['plan'], [[summary()]]));
    applyAdjustment(before, adjustment!);
    expect(before.scenarios[0]!.events[0]!.amount).toBeNull();
  });

  it('uses position, not name, to pick between events that share a name', () => {
    const before = config([
      scenario('plan', [
        optimizedEvent('first', 'amount', { name: 'New expense' }),
        optimizedEvent('second', 'amount', { name: 'New expense' }),
      ]),
    ]);
    const list = adjustmentsOf(results(['plan'], [[summary(), summary({ value: -42 })]]));
    const after = applyAdjustments(before, list);
    expect(after.scenarios[0]!.events[0]!.amount).toBe(-184.72);
    expect(after.scenarios[0]!.events[1]!.amount).toBe(-42);
  });

  it('writes the display form for date fields, which the raw value cannot express', () => {
    const before = config([scenario('plan', [optimizedEvent('income', 'endDate')])]);
    const [adjustment] = adjustmentsOf(
      results(['plan'], [[summary({ field: 'endDate', value: 24317, valueDisplay: '2026-06' })]]),
    );
    const after = applyAdjustment(before, adjustment!);
    expect(after.scenarios[0]!.events[0]!.endDate).toBe('2026-06');
  });

  it('rounds a chosen frequency to a whole number of months', () => {
    const before = config([scenario('plan', [optimizedEvent('income', 'frequency')])]);
    const [adjustment] = adjustmentsOf(
      results(['plan'], [[summary({ field: 'frequency', value: 3, valueDisplay: '3' })]]),
    );
    const after = applyAdjustment(before, adjustment!);
    expect(after.scenarios[0]!.events[0]!.frequency).toBe(3);
  });

  it('skips inactive scenarios, which the optimizer never reports on', () => {
    const before = config([
      scenario('skipped', [optimizedEvent('ghost', 'amount')], false),
      scenario('plan', [optimizedEvent('expense', 'amount')]),
    ]);
    const [adjustment] = adjustmentsOf(results(['plan'], [[summary()]]));
    const after = applyAdjustment(before, adjustment!);
    expect(after.scenarios[0]!.events[0]!.amount).toBeNull();
    expect(after.scenarios[1]!.events[0]!.amount).toBe(-184.72);
  });

  it('leaves the plan alone when the target is gone', () => {
    const before = config([scenario('plan', [event('expense')])]);
    const [adjustment] = adjustmentsOf(results(['plan'], [[summary()]]));
    expect(applyAdjustment(before, adjustment!)).toBe(before);
  });

  it('leaves the plan alone when the optimize block now targets another field', () => {
    const before = config([scenario('plan', [optimizedEvent('expense', 'frequency')])]);
    const [adjustment] = adjustmentsOf(results(['plan'], [[summary()]]));
    expect(applyAdjustment(before, adjustment!)).toBe(before);
  });
});

describe('adjustmentStatus', () => {
  it('is pending before applying and applied after', () => {
    const before = config([scenario('plan', [optimizedEvent('expense', 'amount')])]);
    const [adjustment] = adjustmentsOf(results(['plan'], [[summary()]]));
    expect(adjustmentStatus(before, adjustment!)).toBe('pending');
    expect(adjustmentStatus(applyAdjustment(before, adjustment!), adjustment!)).toBe('applied');
  });

  it('is unchanged when the optimizer kept the configured value', () => {
    // A rerun after applying: the plan holds the value, but this run chose
    // nothing, so there is no application to report.
    const before = config([scenario('plan', [optimizedEvent('expense', 'amount', { amount: -184.72 })])]);
    const [adjustment] = adjustmentsOf(
      results(['plan'], [[summary({ original: -184.72, originalDisplay: '-$184.72', iterations: 0 })]]),
    );
    expect(adjustmentStatus(before, adjustment!)).toBe('unchanged');
  });

  it('is missing when the event it referred to is gone', () => {
    const before = config([scenario('plan', [event('expense')])]);
    const [adjustment] = adjustmentsOf(results(['plan'], [[summary()]]));
    expect(adjustmentStatus(before, adjustment!)).toBe('missing');
  });

  it('is missing when the optimize block now targets another field', () => {
    const before = config([scenario('plan', [optimizedEvent('expense', 'frequency')])]);
    const [adjustment] = adjustmentsOf(results(['plan'], [[summary()]]));
    expect(adjustmentStatus(before, adjustment!)).toBe('missing');
  });
});
