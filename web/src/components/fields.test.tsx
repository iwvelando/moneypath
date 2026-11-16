import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MonthField, NumberField } from './fields';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function keyboardOf(signed: boolean): string | null {
  act(() => {
    render(<NumberField label="Amount" help="" value={600} onChange={() => {}} signed={signed} />, host);
  });
  return host.querySelector('input')!.getAttribute('inputmode');
}

describe('the keyboard a number field asks a phone for', () => {
  // An iPhone's decimal keypad has no minus key, so a value that can be
  // negative could not be typed on it.
  it('is the full keyboard when the value can be negative', () => {
    expect(keyboardOf(true)).toBe('text');
  });

  it('is the decimal keypad otherwise', () => {
    expect(keyboardOf(false)).toBe('decimal');
  });
});

describe('a month field on a phone', () => {
  function mountMonth(): { input: HTMLInputElement; seen: string[] } {
    const seen: string[] = [];
    act(() => {
      render(<MonthField label="Start month" help="" value="" onChange={(value) => seen.push(value)} />, host);
    });
    return { input: host.querySelector('input')!, seen };
  }

  function typeInto(input: HTMLInputElement, value: string): void {
    act(() => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('asks for the number pad, which has no dash', () => {
    expect(mountMonth().input.getAttribute('inputmode')).toBe('numeric');
  });

  it('puts the dash in itself, in the box and in the value it reports', () => {
    const { input, seen } = mountMonth();
    typeInto(input, '20270');
    expect(input.value).toBe('2027-0');
    typeInto(input, '202706');
    expect(input.value).toBe('2027-06');
    expect(seen).toEqual(['2027-0', '2027-06']);
  });
});
