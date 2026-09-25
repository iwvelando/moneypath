import { describe, expect, it } from 'vitest';
import { sanitizeNumberInput } from './number';

describe('sanitizeNumberInput', () => {
  it('strips currency symbols, commas and spaces from pasted values', () => {
    expect(sanitizeNumberInput('$1,234.56')).toBe('1234.56');
    expect(sanitizeNumberInput('1 000 000')).toBe('1000000');
    expect(sanitizeNumberInput('€2500.75')).toBe('2500.75');
  });

  it('keeps a leading minus so spending amounts survive', () => {
    expect(sanitizeNumberInput('-$500.00')).toBe('-500.00');
    expect(sanitizeNumberInput('- 1,250')).toBe('-1250');
  });

  it('passes plain numbers and partial drafts through unchanged', () => {
    expect(sanitizeNumberInput('123.45')).toBe('123.45');
    expect(sanitizeNumberInput('-')).toBe('-');
    expect(sanitizeNumberInput('1.')).toBe('1.');
    expect(sanitizeNumberInput('')).toBe('');
  });
});
