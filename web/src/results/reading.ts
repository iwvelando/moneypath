import type { ForecastResults, Reading, Readings } from '../engine/types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The results to show in a reading: the engine's today's-dollars set laid
 * over the nominal results, or the nominal results when there is none.
 */
export function inReading(results: ForecastResults, reading: Reading): ForecastResults {
  const today = results.todaysDollars;
  if (reading !== 'today' || !today) return results;
  return {
    ...results,
    rows: today.rows,
    metrics: today.metrics,
    comparisons: today.comparisons ?? [],
  };
}

/** The answer for a reading, or the nominal one when there is no other. */
export function pick<T>(answer: Readings<T>, reading: Reading): T {
  return reading === 'today' && answer.today !== null ? answer.today : answer.nominal;
}

/**
 * The name of the today's-dollars reading. It names the month whose prices
 * it uses, the plan's start, unless that is the current month.
 */
export function readingLabel(today: string, now: string): string {
  if (today === now) return 'Today’s dollars';
  const [year, month] = today.split('-');
  return `Today’s dollars (${MONTHS[Number(month) - 1] ?? month} ${year})`;
}
