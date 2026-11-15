import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NumberField } from './fields';

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
