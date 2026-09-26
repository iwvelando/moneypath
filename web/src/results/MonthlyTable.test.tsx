import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MonthlyTable, type MonthlyRow } from './MonthlyTable';

let host: HTMLDivElement;
const note = 'scenario Brokerage: growth +1485.79, tax 356.59';
const rows: MonthlyRow[] = [
  { date: '2026-01', liquid: 25000, total: 65000, notes: [] },
  { date: '2026-02', liquid: -125, total: 68000, notes: [note, 'scenario HSA: growth +65.28'] },
  { date: '2026-03', liquid: null, total: null, notes: ['common Vanguard IRA: growth +80.39'] },
];

function show(value = rows, scenarioName = 'plan') {
  act(() => render(<MonthlyTable key={scenarioName} rows={value} scenarioName={scenarioName} />, host));
}
function disclosure(date = '2026-02') {
  return host.querySelector<HTMLButtonElement>(`button[aria-label$="${date}"]`)!;
}
function details(date = '2026-02') {
  return document.getElementById(disclosure(date).getAttribute('aria-controls')!)!;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
});

describe('monthly event disclosures', () => {
  it('starts with three columns and preserves the values, negatives, and gaps', () => {
    show();
    expect([...host.querySelectorAll('thead th')].map((el) => el.textContent)).toEqual(['Date', 'Liquid', 'Total']);
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(details().hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('.is-negative')?.textContent).toBe('-$125.00');
    const missing = disclosure('2026-03').closest('tr')!;
    expect([...missing.querySelectorAll('td')].map((el) => el.textContent)).toEqual(['', '']);
    expect(host.querySelector('button[aria-label$="2026-01"]')).toBeNull();
  });

  it('opens by clicking a value and closes via the date button without toggling twice', () => {
    show();
    act(() => disclosure().closest('tr')!.querySelector('td')!.click());
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    expect(details().hasAttribute('hidden')).toBe(false);
    expect([...details().querySelectorAll('li')].map((el) => el.textContent)).toEqual(rows[1]!.notes);
    // Commas within an engine note belong to that event, not separate entries.
    expect(details().querySelector('li')!.textContent).toBe(note);
    act(() => disclosure().click());
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(details().hasAttribute('hidden')).toBe(true);
  });

  it('allows several months to stay open and does not make detail text clickable', () => {
    show();
    act(() => disclosure().click());
    act(() => disclosure('2026-03').click());
    act(() => details().querySelector('li')!.click());
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    expect(disclosure('2026-03').getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps disclosures on ordinary rerenders but resets them for new results or scenarios', () => {
    show();
    act(() => disclosure().click());
    show();
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    show([...rows]);
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    act(() => disclosure().click());
    show(rows, 'another path');
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
  });

  it('handles an empty forecast without offering disclosures', () => {
    show([]);
    expect(host.textContent).toContain('This scenario produced no rows.');
    expect(host.querySelector('button')).toBeNull();
  });
});
