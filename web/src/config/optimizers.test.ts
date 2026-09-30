import { describe, expect, it } from 'vitest';
import { findOptimizers } from './optimizers';
import { defaultOptimize } from './optimize';
import {
  emptyEvent,
  emptyScenario,
  type ConfigModel,
  type EventModel,
  type OptimizeField,
  type ScenarioModel,
  type SimulationModel,
} from './types';

const simulation: SimulationModel = {
  startDate: '2025-01',
  endDate: '2030-12',
  startingCash: 0,
  cashInterestRate: null,
  emergencyFundMonths: null,
};

function event(name: string, field?: OptimizeField): EventModel {
  const base = { ...emptyEvent(), name, amount: 100 };
  return field ? { ...base, optimize: defaultOptimize(field, base, simulation) } : base;
}

function config(scenarios: ScenarioModel[], commonEvents: EventModel[] = []): ConfigModel {
  return { simulation, common: { events: commonEvents, loans: [], investments: [] }, scenarios };
}

describe('findOptimizers', () => {
  it('finds nothing in a config with no optimize blocks', () => {
    const scenario = { ...emptyScenario('plan a'), events: [event('Bonus')] };
    expect(findOptimizers(config([scenario], [event('Rent')]))).toEqual([]);
  });

  it('reports the scenario, event and adjusted field of each optimized event', () => {
    const tuned = event('Savings', 'amount');
    const scenario = { ...emptyScenario('plan a'), events: [event('Rent'), tuned] };

    expect(findOptimizers(config([scenario]))).toEqual([
      {
        scenarioId: scenario.id,
        scenarioLabel: 'plan a',
        scenarioActive: true,
        eventId: tuned.id,
        eventLabel: 'Savings',
        field: 'amount',
      },
    ]);
  });

  it('keeps scenario order, then event order within a scenario', () => {
    const first = event('First', 'amount');
    const second = event('Second', 'frequency');
    const third = event('Third', 'endDate');
    const a = { ...emptyScenario('plan a'), events: [first, second] };
    const b = { ...emptyScenario('plan b'), events: [third] };

    expect(findOptimizers(config([a, b])).map((ref) => ref.eventLabel)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  it('reports an inactive scenario as inactive', () => {
    const scenario = { ...emptyScenario('parked'), active: false, events: [event('Savings', 'amount')] };
    expect(findOptimizers(config([scenario]))[0]).toMatchObject({ scenarioActive: false });
  });

  it('falls back to positional labels for unnamed scenarios and events', () => {
    const unnamed = event('', 'startDate');
    const scenario = { ...emptyScenario(''), events: [event('Rent'), unnamed] };

    expect(findOptimizers(config([scenario]))[0]).toMatchObject({
      scenarioLabel: 'Scenario 1',
      eventLabel: 'Event 2',
    });
  });
});
