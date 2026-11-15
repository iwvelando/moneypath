import { describe, expect, it } from 'vitest';
import { formatMoney, isNegativeMoney } from './format';

describe('formatMoney', () => {
  it('groups thousands and keeps two decimals', () => {
    expect(formatMoney(1234.56)).toBe('$1,234.56');
    expect(formatMoney(-1234.56)).toBe('-$1,234.56');
    expect(formatMoney(12345678.9)).toBe('$12,345,678.90');
  });

  it('never shows a negative zero', () => {
    // 0.3 − 0.1 − 0.1 − 0.1 is −2.8e-17 in floating point, not a debt.
    expect(formatMoney(0.3 - 0.1 - 0.1 - 0.1)).toBe('$0.00');
    expect(formatMoney(-0.004)).toBe('$0.00');
    expect(formatMoney(-0)).toBe('$0.00');
    expect(formatMoney(-0.006)).toBe('-$0.01');
  });
});

describe('isNegativeMoney', () => {
  it('is true only for amounts that display as negative', () => {
    expect(isNegativeMoney(-125)).toBe(true);
    expect(isNegativeMoney(-0.006)).toBe(true);
    expect(isNegativeMoney(0.3 - 0.1 - 0.1 - 0.1)).toBe(false);
    expect(isNegativeMoney(-0.004)).toBe(false);
    expect(isNegativeMoney(0)).toBe(false);
    expect(isNegativeMoney(10)).toBe(false);
  });
});
