import { describe, expect, it } from 'vitest';
import {
  addMonths,
  currentMonth,
  isMonth,
  monthFromIndex,
  monthIndex,
  monthIsError,
  monthMessage,
  monthStatus,
} from './month';

describe('YYYY-MM validation', () => {
  it('accepts well-formed months', () => {
    for (const value of ['2025-06', '1999-01', '2090-12', '0001-01']) {
      expect(isMonth(value)).toBe(true);
      expect(monthStatus(value)).toBe('valid');
    }
  });

  it('rejects out-of-range and malformed months', () => {
    for (const value of ['2025-00', '2025-13', '2025-6', '25-06', '2025/06', '2025-06-01', 'abcd-ef']) {
      expect(isMonth(value)).toBe(false);
      expect(monthStatus(value)).toBe('invalid');
    }
  });

  it('treats a half-typed value as incomplete, not wrong', () => {
    for (const value of ['2', '20', '202', '2025', '2025-', '2025-0', '2025-1']) {
      expect(monthStatus(value)).toBe('incomplete');
      expect(monthMessage(value)).toMatch(/YYYY-MM/);
    }
  });

  it('reports empty separately and only errors when required', () => {
    expect(monthStatus('')).toBe('empty');
    expect(monthIsError('')).toBe(false);
    expect(monthIsError('', { required: true })).toBe(true);
    expect(monthMessage('')).toBeNull();
    expect(monthMessage('', { required: true })).toMatch(/Required/);
  });

  it('has no message for a valid month', () => {
    expect(monthMessage('2025-06')).toBeNull();
    expect(monthIsError('2025-06', { required: true })).toBe(false);
  });
});

describe('month arithmetic', () => {
  it('round-trips index conversion', () => {
    expect(monthIndex('2025-06')).toBe(2025 * 12 + 5);
    expect(monthFromIndex(2025 * 12 + 5)).toBe('2025-06');
    expect(monthIndex('nope')).toBeNull();
  });

  it('steps across year boundaries', () => {
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(addMonths('2025-01', -1)).toBe('2024-12');
    expect(addMonths('2025-06', 24)).toBe('2027-06');
    expect(addMonths('bad', 1)).toBeNull();
  });

  it('formats the current month zero-padded', () => {
    expect(currentMonth(new Date(2025, 5, 17))).toBe('2025-06');
    expect(currentMonth(new Date(2025, 10, 3))).toBe('2025-11');
  });
});
