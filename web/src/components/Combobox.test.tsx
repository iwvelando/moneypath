import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Combobox, type ComboboxOption } from './Combobox';

const OPTIONS: ComboboxOption[] = [
  { value: 'salary', label: 'Salary', detail: 'Event', unavailable: 'The choice Job already changes or removes it.' },
  { value: 'living', label: 'Living costs', detail: 'Event' },
  { value: 'auto', label: 'Auto insurance', detail: 'Event' },
  { value: 'home', label: 'Home insurance', detail: 'Event' },
  { value: 'mortgage', label: 'Mortgage', detail: 'Loan' },
];

let host: HTMLDivElement;
let picked: string[];

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Combobox
        label="Baseline entry"
        help="help"
        placeholder="Type to search"
        emptyMessage="No baseline entry matches."
        options={OPTIONS}
        value={value}
        onChange={(next) => {
          picked.push(next);
          setValue(next);
        }}
      />
      <button type="button">after</button>
    </>
  );
}

beforeEach(() => {
  picked = [];
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

async function mount(initial = ''): Promise<HTMLInputElement> {
  await act(async () => {
    render(<Harness initial={initial} />, host);
  });
  return host.querySelector('input')!;
}

const listed = () => Array.from(host.querySelectorAll('[role="option"]'));
const names = () => listed().map((o) => o.querySelector('.combobox__name')?.textContent);

async function focus(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.focus();
  });
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(input: HTMLInputElement, key: string): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('a searchable picker', () => {
  it('is a labelled combobox that lists nothing until it is used', async () => {
    const input = await mount();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('label')?.htmlFor).toBe(input.id);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('lists every option on focus, the unavailable ones with their reason', async () => {
    const input = await mount();
    await focus(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(host.querySelector('[role="listbox"]')?.id);
    expect(names()).toEqual(['Salary', 'Living costs', 'Auto insurance', 'Home insurance', 'Mortgage']);
    const salary = listed()[0]!;
    expect(salary.getAttribute('aria-disabled')).toBe('true');
    expect(salary.textContent).toContain('The choice Job already changes or removes it.');
    expect(listed()[4]!.textContent).toContain('Loan');
  });

  it('narrows the list to what the typed letters match, anywhere in the name', async () => {
    const input = await mount();
    await focus(input);
    await type(input, 'insur');
    expect(names()).toEqual(['Auto insurance', 'Home insurance']);
    await type(input, 'AUTO');
    expect(names()).toEqual(['Auto insurance']);
  });

  it('says so when nothing matches', async () => {
    const input = await mount();
    await focus(input);
    await type(input, 'zzz');
    expect(listed()).toEqual([]);
    expect(host.querySelector('[role="listbox"]')?.textContent).toBe('No baseline entry matches.');
  });

  it('picks the first match with Enter and shows its name', async () => {
    const input = await mount();
    await focus(input);
    await type(input, 'insur');
    expect(input.getAttribute('aria-activedescendant')).toBe(listed()[0]!.id);
    await press(input, 'Enter');
    expect(picked).toEqual(['auto']);
    expect(input.value).toBe('Auto insurance');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves through the options with the arrow keys, past the unavailable ones', async () => {
    const input = await mount();
    await focus(input);
    // Salary cannot be picked, so the first stop is the one after it.
    expect(input.getAttribute('aria-activedescendant')).toBe(listed()[1]!.id);
    await press(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(listed()[2]!.id);
    await press(input, 'ArrowUp');
    await press(input, 'ArrowUp');
    // Wraps to the last.
    expect(input.getAttribute('aria-activedescendant')).toBe(listed()[4]!.id);
    await press(input, 'Enter');
    expect(picked).toEqual(['mortgage']);
  });

  it('picks with a click, and never an unavailable option', async () => {
    const input = await mount();
    await focus(input);
    await act(async () => {
      (listed()[0] as HTMLElement).click();
    });
    expect(picked).toEqual([]);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      (listed()[2] as HTMLElement).click();
    });
    expect(picked).toEqual(['auto']);
    expect(input.value).toBe('Auto insurance');
  });

  it('keeps focus in the box when an option is pressed', async () => {
    const input = await mount();
    await focus(input);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    listed()[1]!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('drops the pick as soon as the name is edited', async () => {
    const input = await mount('auto');
    expect(input.value).toBe('Auto insurance');
    await focus(input);
    // Everything is offered again, not only what matches the name shown.
    expect(names()).toHaveLength(5);
    await type(input, 'Auto insuranc');
    expect(picked).toEqual(['']);
  });

  it('closes on Escape and puts back what was picked', async () => {
    const input = await mount('auto');
    await focus(input);
    await type(input, 'mort');
    await press(input, 'Escape');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.value).toBe('');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('closes when focus moves on, leaving a half-typed search behind', async () => {
    const input = await mount();
    await focus(input);
    await type(input, 'liv');
    await act(async () => {
      host.querySelector('button')!.focus();
    });
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(input.value).toBe('');
  });

  it('stays open when focus is lost to nothing, as a tap on an option does in Safari', async () => {
    const input = await mount();
    await focus(input);
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    });
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('closes on a press outside it', async () => {
    const input = await mount();
    await focus(input);
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });
});
