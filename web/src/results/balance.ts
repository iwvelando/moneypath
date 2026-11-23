import type { ForecastResults, ResultRow } from '../engine/types';
import { HALF_CENT } from '../util/format';

/** Whether the scenario at `index` owes at least a cent in some month. */
export function pathOwes(rows: ResultRow[], index: number): boolean {
  return rows.some((row) => Math.abs(row.values[index]?.liabilities ?? 0) >= HALF_CENT);
}

/**
 * Whether any scenario of a run owes something. Until one does, net worth is
 * the total in every month, so the views that compare scenarios leave it out.
 */
export function runOwes(results: ForecastResults): boolean {
  return results.scenarios.some((_, i) => pathOwes(results.rows, i));
}

/** Whether two series differ by half a cent or more in some month; never when one is missing. */
export function seriesDiffer(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (!a || !b) return false;
  return a.some((value, i) => Math.abs(value - (b[i] ?? 0)) >= HALF_CENT);
}
