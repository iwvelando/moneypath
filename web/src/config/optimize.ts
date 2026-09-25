/**
 * Defaults for the on-demand `optimize` sub-form. Bounds are required by
 * spec/03, so the form prefills a plausible pair the user can adjust rather
 * than showing empty required inputs; `tolerance` and `maxIterations` are
 * prefilled with the documented defaults (0.01 for amount, 1 otherwise; 50).
 */

import { addMonths } from './month';
import type { EventModel, OptimizeField, OptimizeModel, SimulationModel } from './types';

export const OPTIMIZE_FIELDS: readonly OptimizeField[] = [
  'amount',
  'frequency',
  'startDate',
  'endDate',
];

export const OPTIMIZE_FIELD_LABEL: Record<OptimizeField, string> = {
  amount: 'Amount',
  frequency: 'Frequency',
  startDate: 'Start month',
  endDate: 'End month',
};

export function defaultTolerance(field: OptimizeField): number {
  return field === 'amount' ? 0.01 : 1;
}

export function defaultOptimize(
  field: OptimizeField,
  event: EventModel,
  simulation: SimulationModel,
): OptimizeModel {
  const base: OptimizeModel = {
    field,
    min: null,
    max: null,
    minDate: '',
    maxDate: '',
    tolerance: defaultTolerance(field),
    maxIterations: 50,
  };

  if (field === 'amount') {
    const magnitude = Math.abs(event.amount ?? 1000);
    const span = Math.max(magnitude * 2, 100);
    base.min = event.amount !== null && event.amount < 0 ? -Math.ceil(span) : 0;
    base.max = event.amount !== null && event.amount < 0 ? 0 : Math.ceil(span);
    return base;
  }

  if (field === 'frequency') {
    base.min = 1;
    base.max = Math.max(12, (event.frequency ?? 1) * 2);
    return base;
  }

  const anchor =
    (field === 'startDate' ? event.startDate : event.endDate) ||
    (field === 'startDate' ? simulation.startDate : simulation.endDate) ||
    '';
  base.minDate = anchor ? (addMonths(anchor, -6) ?? anchor) : '';
  base.maxDate = anchor ? (addMonths(anchor, 6) ?? anchor) : '';
  return base;
}

/**
 * Switching the picked field keeps the shared knobs and re-seeds the bounds
 * that belong to the new field.
 */
export function retargetOptimize(
  current: OptimizeModel,
  field: OptimizeField,
  event: EventModel,
  simulation: SimulationModel,
): OptimizeModel {
  const seeded = defaultOptimize(field, event, simulation);
  return {
    ...seeded,
    tolerance: current.tolerance === defaultTolerance(current.field) ? seeded.tolerance : current.tolerance,
    maxIterations: current.maxIterations ?? seeded.maxIterations,
  };
}
