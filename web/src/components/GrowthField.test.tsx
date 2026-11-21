import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Problem } from '../engine/types';
import type { GrowthModel } from '../config/types';
import { GrowthField } from './GrowthField';
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

interface Mounted {
  seen: GrowthModel[];
  reported: [string, string | null][];
}

function mount(initial: GrowthModel, problems: Problem[] = []): Mounted {
  const seen: GrowthModel[] = [];
  const reported: [string, string | null][] = [];
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <Problems.Provider value={problemSet(problems, (_field, path, message) => reported.push([path, message]))}>
        <At path="common.events.0">
          <GrowthField
            label="Growth"
            field="growth"
            value={value}
            onChange={(next) => {
              seen.push(next);
              setValue(next);
            }}
          />
        </At>
      </Problems.Provider>
    );
  }
  act(() => {
    render(<Harness />, host);
  });
  return { seen, reported };
}

const select = () => host.querySelector('select')!;
const rateInput = () => host.querySelector<HTMLInputElement>('input');

function pick(value: string) {
  act(() => {
    select().value = value;
    select().dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function type(value: string) {
  act(() => {
    const input = rateInput()!;
    input.dispatchEvent(new Event('focus'));
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the growth control', () => {
  it('offers the three kinds of growth, in words, and starts at the same amount every year', () => {
    mount({ mode: 'fixed', rate: null });
    expect(Array.from(select().options, (o) => o.textContent)).toEqual([
      'Stays the same',
      'With inflation',
      'At its own rate',
    ]);
    expect(select().value).toBe('fixed');
    expect(rateInput()).toBeNull();
  });

  it('asks for a yearly rate only when the amount grows at its own rate', () => {
    const { seen } = mount({ mode: 'fixed', rate: null });
    pick('rate');
    expect(seen.at(-1)).toEqual({ mode: 'rate', rate: null });
    expect(host.textContent).toContain('Yearly growth');
    type('4.5');
    expect(seen.at(-1)).toEqual({ mode: 'rate', rate: 4.5 });
    pick('inflation');
    expect(seen.at(-1)).toEqual({ mode: 'inflation', rate: 4.5 });
    expect(rateInput()).toBeNull();
    pick('rate');
    expect(rateInput()!.value).toBe('4.5');
  });

  it('keeps the rate field while its text is cleared, and holds the run until a rate is entered', () => {
    const { reported } = mount({ mode: 'rate', rate: 3 });
    type('');
    expect(rateInput()).not.toBeNull();
    expect(host.querySelector('.field__message.is-error')?.textContent).toBe('Enter the yearly growth.');
    expect(reported.at(-1)).toEqual(['common.events.0.growth', 'Enter the yearly growth.']);
  });

  it('shows what the engine says about the growth under the rate when there is one', () => {
    mount({ mode: 'rate', rate: -100 }, [
      { level: 'error', path: 'common.events.0.growth', where: '', message: 'The yearly growth must be more than -100.' },
    ]);
    const messages = host.querySelectorAll('.field__message.is-error');
    expect(messages).toHaveLength(1);
    expect(rateInput()!.getAttribute('aria-invalid')).toBe('true');
    expect(select().getAttribute('aria-invalid')).toBeNull();
  });

  it('shows a warning about inflation under the choice', () => {
    mount({ mode: 'inflation', rate: null }, [
      { level: 'warning', path: 'common.events.0.growth', where: '', message: 'This follows the plan’s inflation rate, which is 0, so it stays the same.' },
    ]);
    expect(host.querySelector('.field__message.is-warning')?.textContent).toMatch(/^Warning: This follows/);
    expect(host.querySelector('[data-path="common.events.0.growth"] select')).not.toBeNull();
  });

  it('keeps a growth it cannot use on screen, as written, with the engine’s error', () => {
    mount({ mode: 'inflaton', rate: null }, [
      { level: 'error', path: 'common.events.0.growth', where: '', message: 'Growth must be fixed, inflation or a yearly rate in percent, such as 3.' },
    ]);
    expect(select().value).toBe('inflaton');
    expect(select().selectedOptions[0]!.disabled).toBe(true);
    expect(select().getAttribute('aria-invalid')).toBe('true');
  });
});
