import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Problem } from '../engine/types';
import { MonthField, NumberField } from './fields';
import { At, Problems, problemSet } from './problems';

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

describe('what the engine says about a field', () => {
  const error: Problem = {
    level: 'error',
    path: 'common.investments.0.withdrawalTaxRate',
    where: 'Baseline, investment “Brokerage”',
    message: 'The withdrawal tax rate must be at least 0 and less than 100.',
  };
  const warning: Problem = {
    level: 'warning',
    path: 'common.investments.0.withdrawalTaxRate',
    where: 'Baseline, investment “Brokerage”',
    message: 'This is unusually high.',
  };

  function mount(problems: Problem[], reported: [string, string | null][] = []): HTMLInputElement {
    act(() => {
      render(
        <Problems.Provider value={problemSet(problems, (path, message) => reported.push([path, message]))}>
          <At path="common">
            <At sub="investments.0">
              <NumberField label="Withdrawal tax rate" help="" field="withdrawalTaxRate" value={-1} onChange={() => {}} />
            </At>
          </At>
        </Problems.Provider>,
        host,
      );
    });
    return host.querySelector('input')!;
  }

  it('shows an error under the field it is about and marks the field invalid', () => {
    const input = mount([error]);
    const message = host.querySelector('.field__message.is-error');
    expect(message?.textContent).toBe(error.message);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(message!.parentElement!.id);
    expect(host.querySelector('[data-path="common.investments.0.withdrawalTaxRate"]')).not.toBeNull();
  });

  it('shows a warning in its own softer style, led by the word, and leaves the field valid', () => {
    const input = mount([warning]);
    const message = host.querySelector('.field__message.is-warning');
    expect(message?.textContent).toBe('Warning: This is unusually high.');
    expect(host.querySelector('.field__message.is-error')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('says nothing about a problem with another field', () => {
    mount([{ ...error, path: 'common.investments.1.withdrawalTaxRate' }]);
    expect(host.querySelector('.field__message')).toBeNull();
  });

  it('keeps text that is not a number in the box after the field is left, and reports it', () => {
    const reported: [string, string | null][] = [];
    const input = mount([], reported);
    act(() => {
      input.dispatchEvent(new Event('focus'));
      input.value = '.';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new Event('blur'));
    });
    expect(input.value).toBe('.');
    expect(host.querySelector('.field__message.is-error')?.textContent).toBe('Enter a number.');
    expect(reported.at(-1)).toEqual(['common.investments.0.withdrawalTaxRate', 'Enter a number.']);
  });
});
