import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tiered, type Help } from '../config/help';
import { HelpTip } from './HelpTip';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

const TIERED = tiered('What the field does.', 'Every limit the simulation applies to it.');

function mount(help: Help): void {
  act(() => {
    render(
      <>
        <input aria-describedby="tip" />
        <HelpTip id="tip" label="Amount" help={help} />
        <button type="button">elsewhere</button>
      </>,
      host,
    );
  });
}

const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-label="Help: Amount"]')!;
const panel = () => host.querySelector<HTMLElement>(`#${toggle().getAttribute('aria-controls')}`)!;
const showMore = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => /^Show (more|less)$/.test(b.textContent ?? '')) ??
  null;
const more = () => host.querySelector<HTMLElement>(`#${showMore()!.getAttribute('aria-controls')}`)!;
const isOpen = () => !panel().classList.contains('is-collapsed');

function click(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    element.focus();
    element.click();
  });
}

function press(key: string): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('a help on one line', () => {
  it('shows all of itself when opened, with nothing to show more of', () => {
    mount('Optional. The first month the simulation reports.');
    click(toggle());
    expect(isOpen()).toBe(true);
    expect(panel().textContent).toBe('Optional. The first month the simulation reports.');
    expect(showMore()).toBeNull();
  });

  it('describes its control in full', () => {
    mount('Optional. The first month the simulation reports.');
    expect(document.getElementById('tip')!.textContent).toBe('Optional. The first month the simulation reports.');
  });
});

describe('a help in two tiers', () => {
  it('opens on its brief, with the more one press away', () => {
    mount(TIERED);
    click(toggle());
    expect(isOpen()).toBe(true);
    expect(panel().textContent).toContain('What the field does.');
    expect(showMore()!.textContent).toBe('Show more');
    expect(showMore()!.getAttribute('aria-expanded')).toBe('false');
    expect(more().hidden).toBe(true);
  });

  it('shows the rest on Show more, and folds it away on Show less', () => {
    mount(TIERED);
    click(toggle());
    click(showMore()!);
    expect(isOpen()).toBe(true);
    expect(more().hidden).toBe(false);
    expect(more().textContent).toBe('Every limit the simulation applies to it.');
    expect(showMore()!.textContent).toBe('Show less');
    expect(showMore()!.getAttribute('aria-expanded')).toBe('true');
    click(showMore()!);
    expect(more().hidden).toBe(true);
    expect(showMore()!.textContent).toBe('Show more');
  });

  it('starts again at the brief when closed and reopened', () => {
    mount(TIERED);
    click(toggle());
    click(showMore()!);
    click(toggle());
    expect(isOpen()).toBe(false);
    click(toggle());
    expect(isOpen()).toBe(true);
    expect(more().hidden).toBe(true);
    expect(showMore()!.textContent).toBe('Show more');
  });

  it('starts again at the brief after a press outside it closes it', () => {
    mount(TIERED);
    click(toggle());
    click(showMore()!);
    click(host.querySelector<HTMLButtonElement>('button:last-of-type')!);
    expect(isOpen()).toBe(false);
    click(toggle());
    expect(more().hidden).toBe(true);
  });

  it('describes its control with the brief alone', () => {
    mount(TIERED);
    expect(document.getElementById('tip')!.textContent).toBe('What the field does.');
  });

  it('offers Show more only while it is open, so a closed help adds nothing to the tab order', () => {
    mount(TIERED);
    expect(showMore()).toBeNull();
    click(toggle());
    expect(showMore()).not.toBeNull();
  });

  it('closes on Escape from Show more and gives focus back to its button', () => {
    mount(TIERED);
    click(toggle());
    click(showMore()!);
    expect(document.activeElement).toBe(showMore());
    press('Escape');
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle());
  });

  it('leaves focus where it is on Escape from anywhere else', () => {
    mount(TIERED);
    click(toggle());
    const input = host.querySelector('input')!;
    act(() => input.focus());
    press('Escape');
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(input);
  });
});
