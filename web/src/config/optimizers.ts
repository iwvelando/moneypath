/**
 * Locating the events an optimizer run will act on.
 *
 * Optimize blocks are legal on scenario cash-flow events only (spec/03), so
 * that is the whole search space. The editor uses this to answer "what will
 * the optimizer actually change?" without the user hunting through scenarios.
 */

import type { ConfigModel, OptimizeField } from './types';

export interface OptimizerRef {
  scenarioId: string;
  /** Display name, falling back to the scenario's position. */
  scenarioLabel: string;
  /** Optimizers in an inactive scenario are never run. */
  scenarioActive: boolean;
  eventId: string;
  /** Display name, falling back to the event's position in its list. */
  eventLabel: string;
  field: OptimizeField;
}

export function findOptimizers(config: ConfigModel): OptimizerRef[] {
  const refs: OptimizerRef[] = [];
  config.scenarios.forEach((scenario, scenarioIndex) => {
    scenario.events.forEach((event, eventIndex) => {
      if (!event.optimize) return;
      refs.push({
        scenarioId: scenario.id,
        scenarioLabel: scenario.name.trim() || `Scenario ${scenarioIndex + 1}`,
        scenarioActive: scenario.active,
        eventId: event.id,
        eventLabel: event.name.trim() || `Event ${eventIndex + 1}`,
        field: event.optimize.field,
      });
    });
  });
  return refs;
}
