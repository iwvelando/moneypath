/**
 * Moving the optimizer's chosen values into the plan.
 *
 * A forecast never edits the plan by itself: the optimizer reports what it
 * would change, and the plan keeps the user's own numbers until they say
 * otherwise. This module is the "say otherwise" — the CLI's `--write-config`
 * is the same step by another route.
 *
 * Matching a reported adjustment back to an event is positional. The engine
 * walks active scenarios in order and, inside each, the events carrying an
 * optimize block in order, so the nth adjustment reported for a scenario is
 * that scenario's nth optimize-carrying event. Names cannot do this job:
 * scenario names are unique but event names are not.
 */

import type { ForecastResults, OptimizationSummary } from '../engine/types';
import type { ConfigModel, EventModel, ScenarioModel } from './types';

export interface Adjustment {
  /** The scenario the engine reported this under; scenario names are unique. */
  scenarioName: string;
  /** Position among that scenario's adjustments, in the engine's own order. */
  ordinal: number;
  summary: OptimizationSummary;
}

export function adjustmentsOf(results: ForecastResults): Adjustment[] {
  const out: Adjustment[] = [];
  results.scenarios.forEach((scenarioName, index) => {
    const summaries = results.metrics[index]?.optimizations ?? [];
    summaries.forEach((summary, ordinal) => {
      out.push({ scenarioName, ordinal, summary });
    });
  });
  return out;
}

/** The plan event an adjustment refers to, or null if the plan has moved on. */
function targetOf(config: ConfigModel, adjustment: Adjustment): EventModel | null {
  const scenario = config.scenarios.find(
    (candidate) => candidate.active && candidate.name === adjustment.scenarioName,
  );
  if (!scenario) return null;
  const targets = scenario.events.filter((event) => event.optimize !== null);
  const event = targets[adjustment.ordinal];
  if (!event || !event.optimize) return null;
  // The optimize block may have been retargeted since the run; writing the
  // chosen value into a field nobody asked about would be worse than nothing.
  return event.optimize.field === adjustment.summary.field ? event : null;
}

/** The event with the adjustment's chosen value written into its field. */
function adjusted(event: EventModel, summary: OptimizationSummary): EventModel {
  switch (summary.field) {
    case 'amount':
      return { ...event, amount: summary.value };
    case 'frequency':
      return { ...event, frequency: Math.round(summary.value) };
    case 'startDate':
      // Dates travel as a month index; only the display form is a date.
      return { ...event, startDate: summary.valueDisplay };
    default:
      return { ...event, endDate: summary.valueDisplay };
  }
}

/**
 * `unchanged` — the optimizer kept the configured value, so there was never
 *   anything to apply. Checked first: after applying and running again, the
 *   plan holds the value, but this run chose nothing.
 * `pending` — the plan still holds the user's value.
 * `applied` — the plan already carries the chosen one.
 * `missing` — the event it referred to is gone or now optimizes another field,
 *   so there is nothing to write it into.
 */
export type AdjustmentStatus = 'unchanged' | 'pending' | 'applied' | 'missing';

export function adjustmentStatus(config: ConfigModel, adjustment: Adjustment): AdjustmentStatus {
  if (adjustment.summary.value === adjustment.summary.original) return 'unchanged';
  const event = targetOf(config, adjustment);
  if (!event) return 'missing';
  const next = adjusted(event, adjustment.summary);
  const same =
    next.amount === event.amount &&
    next.frequency === event.frequency &&
    next.startDate === event.startDate &&
    next.endDate === event.endDate;
  return same ? 'applied' : 'pending';
}

export function applyAdjustment(config: ConfigModel, adjustment: Adjustment): ConfigModel {
  const event = targetOf(config, adjustment);
  if (!event) return config;
  const next = adjusted(event, adjustment.summary);
  return {
    ...config,
    scenarios: config.scenarios.map((scenario): ScenarioModel => {
      if (!scenario.events.includes(event)) return scenario;
      return {
        ...scenario,
        events: scenario.events.map((candidate) => (candidate === event ? next : candidate)),
      };
    }),
  };
}

export function applyAdjustments(config: ConfigModel, adjustments: Adjustment[]): ConfigModel {
  return adjustments.reduce(applyAdjustment, config);
}
