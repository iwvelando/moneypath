/**
 * `YYYY-MM` month handling (spec/03: "Dates are strings in YYYY-MM form
 * (calendar month precision). Anything else is a validation error.").
 *
 * The editor validates as you type, so a half-typed value must be
 * distinguishable from a wrong one.
 */

const COMPLETE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Prefixes that could still become a complete `YYYY-MM` value. */
const PARTIALS: RegExp[] = [
  /^\d{0,4}$/,
  /^\d{4}-$/,
  /^\d{4}-[01]$/,
  /^\d{4}-0[1-9]$/,
  /^\d{4}-1[0-2]$/,
];

export type MonthStatus = 'empty' | 'valid' | 'incomplete' | 'invalid';

export function isMonth(value: string): boolean {
  return COMPLETE.test(value);
}

export function monthStatus(value: string): MonthStatus {
  if (value === '') return 'empty';
  if (COMPLETE.test(value)) return 'valid';
  if (PARTIALS.some((re) => re.test(value))) return 'incomplete';
  return 'invalid';
}

/**
 * The message shown under a month field. `null` means "nothing to say yet" —
 * a partially typed value is not an error until the user leaves it that way.
 */
export function monthMessage(value: string, opts: { required?: boolean } = {}): string | null {
  const status = monthStatus(value);
  if (status === 'empty') return opts.required ? 'Required — use YYYY-MM (e.g. 2025-06).' : null;
  if (status === 'valid') return null;
  if (status === 'incomplete') return 'Keep going — months use YYYY-MM (e.g. 2025-06).';
  return 'Not a valid month. Use YYYY-MM with a month between 01 and 12.';
}

/** True when the value would be rejected by the engine. */
export function monthIsError(value: string, opts: { required?: boolean } = {}): boolean {
  const status = monthStatus(value);
  if (status === 'empty') return Boolean(opts.required);
  return status !== 'valid';
}

/** Month index used for ordering and axis math: year*12 + month - 1. */
export function monthIndex(value: string): number | null {
  if (!COMPLETE.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return year * 12 + month - 1;
}

export function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function addMonths(value: string, delta: number): string | null {
  const index = monthIndex(value);
  if (index === null) return null;
  return monthFromIndex(index + delta);
}

/** The current calendar month, used to pin the engine's "now". */
export function currentMonth(now: Date = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
