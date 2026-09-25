import { describe, expect, it } from 'vitest';
import { findReplicates, moveEventToCommon, moveEventToScenarios } from './move';
import {
  emptyEvent,
  emptyScenario,
  type ConfigModel,
  type EventModel,
  type ScenarioModel,
} from './types';

function event(name: string, overrides: Partial<EventModel> = {}): EventModel {
  return { ...emptyEvent(), name, amount: 100, ...overrides };
}

function scenario(name: string, events: EventModel[]): ScenarioModel {
  return { ...emptyScenario(name), events };
}

function config(commonEvents: EventModel[], scenarios: ScenarioModel[]): ConfigModel {
  return {
    simulation: { startDate: '', endDate: '2030-12', startingCash: 0, emergencyFundMonths: null },
    common: { events: commonEvents, loans: [], investments: [] },
    scenarios,
  };
}

describe('findReplicates', () => {
  it('finds same-named events in every scenario, excluding the moved event itself', () => {
    const moved = event('Bonus');
    const twinSameScenario = event('Bonus');
    const twinOther = event('  Bonus '); // matching is on trimmed names
    const unrelated = event('Rent');
    const cfg = config(
      [],
      [scenario('a', [moved, twinSameScenario]), scenario('b', [twinOther, unrelated])],
    );

    const found = findReplicates(cfg, cfg.scenarios[0]!.id, moved.id);
    expect(found.map((r) => r.eventId).sort()).toEqual([twinSameScenario.id, twinOther.id].sort());
    expect(found.find((r) => r.eventId === twinOther.id)?.scenarioName).toBe('b');
  });

  it('never matches events with blank names', () => {
    const moved = event('');
    const alsoBlank = event('   ');
    const cfg = config([], [scenario('a', [moved]), scenario('b', [alsoBlank])]);
    expect(findReplicates(cfg, cfg.scenarios[0]!.id, moved.id)).toEqual([]);
  });
});

describe('moveEventToCommon', () => {
  it('removes the event from its scenario and prepends it to common events', () => {
    const existingCommon = event('Rent');
    const moved = event('Bonus');
    const stays = event('Groceries');
    const cfg = config([existingCommon], [scenario('a', [stays, moved])]);

    const next = moveEventToCommon(cfg, cfg.scenarios[0]!.id, moved.id, []);
    expect(next.common.events.map((e) => e.id)).toEqual([moved.id, existingCommon.id]);
    expect(next.scenarios[0]!.events.map((e) => e.id)).toEqual([stays.id]);
  });

  it('strips the optimizer, which is not allowed on common events', () => {
    const moved = event('Bonus', {
      optimize: {
        field: 'amount',
        min: 0,
        max: 100,
        minDate: '',
        maxDate: '',
        tolerance: null,
        maxIterations: null,
      },
    });
    const cfg = config([], [scenario('a', [moved])]);
    const next = moveEventToCommon(cfg, cfg.scenarios[0]!.id, moved.id, []);
    expect(next.common.events[0]!.optimize).toBeNull();
  });

  it('also removes the requested replicates from other scenarios', () => {
    const moved = event('Bonus');
    const twin = event('Bonus');
    const keeper = event('Rent');
    const cfg = config([], [scenario('a', [moved]), scenario('b', [twin, keeper])]);

    const next = moveEventToCommon(cfg, cfg.scenarios[0]!.id, moved.id, [
      { scenarioId: cfg.scenarios[1]!.id, scenarioName: 'b', eventId: twin.id },
    ]);
    expect(next.scenarios[1]!.events.map((e) => e.id)).toEqual([keeper.id]);
    expect(next.common.events.map((e) => e.id)).toEqual([moved.id]);
  });
});

describe('moveEventToScenarios', () => {
  it('copy mode clones the event (fresh ids) into each selected scenario and keeps it in common', () => {
    const source = event('Bonus');
    const cfg = config([source], [scenario('a', []), scenario('b', []), scenario('c', [])]);

    const next = moveEventToScenarios(
      cfg,
      source.id,
      [cfg.scenarios[0]!.id, cfg.scenarios[2]!.id],
      'copy',
    );
    expect(next.common.events.map((e) => e.id)).toEqual([source.id]);
    expect(next.scenarios[0]!.events).toHaveLength(1);
    expect(next.scenarios[1]!.events).toHaveLength(0);
    expect(next.scenarios[2]!.events).toHaveLength(1);
    expect(next.scenarios[0]!.events[0]!.name).toBe('Bonus');
    // Fresh ids everywhere, or Preact keys would collide.
    const ids = [source.id, next.scenarios[0]!.events[0]!.id, next.scenarios[2]!.events[0]!.id];
    expect(new Set(ids).size).toBe(3);
  });

  it('move mode also removes the event from common', () => {
    const source = event('Bonus');
    const other = event('Rent');
    const cfg = config([source, other], [scenario('a', [])]);

    const next = moveEventToScenarios(cfg, source.id, [cfg.scenarios[0]!.id], 'move');
    expect(next.common.events.map((e) => e.id)).toEqual([other.id]);
    expect(next.scenarios[0]!.events.map((e) => e.name)).toEqual(['Bonus']);
  });

  it('prepends into the target scenario so the moved event is visible at the top', () => {
    const source = event('Bonus');
    const existing = event('Rent');
    const cfg = config([source], [scenario('a', [existing])]);

    const next = moveEventToScenarios(cfg, source.id, [cfg.scenarios[0]!.id], 'move');
    expect(next.scenarios[0]!.events.map((e) => e.name)).toEqual(['Bonus', 'Rent']);
  });
});
