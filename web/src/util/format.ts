/**
 * Display formatting. Deliberately locale-independent (manual grouping rather
 * than `toLocaleString`) so the UI matches the CLI's currency rendering from
 * spec/05: `$` + thousands separators + 2 decimals, negatives as `-$1,234.56`.
 */

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Amounts closer to zero than this display as 0.00. Sums of cent amounts pick
 * up float noise (0.3 − 0.1 − 0.1 − 0.1 is −2.8e-17), and that is not a debt.
 */
export const HALF_CENT = 0.005;

/** True when the amount displays as negative; one that rounds to zero does not. */
export function isNegativeMoney(value: number): boolean {
  return value < 0 && Math.abs(value).toFixed(2) !== '0.00';
}

export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const negative = isNegativeMoney(value);
  const fixed = Math.abs(value).toFixed(2);
  const dot = fixed.indexOf('.');
  const whole = fixed.slice(0, dot);
  const cents = fixed.slice(dot);
  return `${negative ? '-' : ''}$${group(whole)}${cents}`;
}

/** Short form for axis labels: $1.2M / $45.0k / $320. */
export function formatMoneyShort(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${group(Math.round(abs).toString())}`;
}

export function formatMonths(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} months`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Turn a number-or-null editor value into an input value. */
export function numberToInput(value: number | null): string {
  return value === null ? '' : String(value);
}
