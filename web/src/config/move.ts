/**
 * Moving cash-flow events between the common block and scenarios.
 *
 * "Move to common" promotes a scenario event so every scenario inherits it;
 * same-named events left in other scenarios would then apply twice, so the
 * caller can ask for those replicates and remove them in the same step.
 * "Move to scenario" is the inverse: place a common event into one or more
 * chosen scenarios, either moving it out of common or copying it.
 */

import { cloneEvent, type ConfigModel, type EventModel } from './types';

export interface ReplicateRef {
  scenarioId: string;
  scenarioName: string;
  eventId: string;
}

function eventName(event: EventModel): string {
  return event.name.trim();
}

function findEvent(config: ConfigModel, scenarioId: string, eventId: string): EventModel | null {
  const scenario = config.scenarios.find((s) => s.id === scenarioId);
  return scenario?.events.find((e) => e.id === eventId) ?? null;
}

/**
 * Events in any scenario sharing the moved event's (trimmed, non-blank) name,
 * excluding the moved event itself.
 */
export function findReplicates(
  config: ConfigModel,
  scenarioId: string,
  eventId: string,
): ReplicateRef[] {
  const moved = findEvent(config, scenarioId, eventId);
  if (!moved) return [];
  const name = eventName(moved);
  if (name === '') return [];

  const found: ReplicateRef[] = [];
  for (const scenario of config.scenarios) {
    for (const event of scenario.events) {
      if (event.id === eventId) continue;
      if (eventName(event) !== name) continue;
      found.push({ scenarioId: scenario.id, scenarioName: scenario.name, eventId: event.id });
    }
  }
  return found;
}

/**
 * Remove the event from its scenario and prepend it to common events, dropping
 * any optimizer (common events cannot carry one). `removeReplicates` lists
 * additional scenario events to delete in the same update.
 */
export function moveEventToCommon(
  config: ConfigModel,
  scenarioId: string,
  eventId: string,
  removeReplicates: ReplicateRef[],
): ConfigModel {
  const moved = findEvent(config, scenarioId, eventId);
  if (!moved) return config;

  const removedIds = new Set([eventId, ...removeReplicates.map((r) => r.eventId)]);
  return {
    ...config,
    common: {
      ...config.common,
      events: [{ ...moved, optimize: null }, ...config.common.events],
    },
    scenarios: config.scenarios.map((scenario) => ({
      ...scenario,
      events: scenario.events.filter((event) => !removedIds.has(event.id)),
    })),
  };
}

/**
 * Place a common event into each selected scenario (as a fresh-id clone, at
 * the top of the scenario's list). Mode 'move' removes it from common;
 * 'copy' leaves it there too.
 */
export function moveEventToScenarios(
  config: ConfigModel,
  eventId: string,
  scenarioIds: string[],
  mode: 'move' | 'copy',
): ConfigModel {
  const source = config.common.events.find((e) => e.id === eventId);
  if (!source || scenarioIds.length === 0) return config;

  const targets = new Set(scenarioIds);
  return {
    ...config,
    common: {
      ...config.common,
      events:
        mode === 'move'
          ? config.common.events.filter((event) => event.id !== eventId)
          : config.common.events,
    },
    scenarios: config.scenarios.map((scenario) =>
      targets.has(scenario.id)
        ? { ...scenario, events: [cloneEvent(source), ...scenario.events] }
        : scenario,
    ),
  };
}
