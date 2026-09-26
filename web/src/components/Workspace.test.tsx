import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultOptimize } from '../config/optimize';
import {
  emptyEvent,
  emptyScenario,
  type ConfigModel,
  type EventModel,
  type OptimizeField,
  type ScenarioModel,
} from '../config/types';
import { Workspace } from './Workspace';

function event(name: string): EventModel {
  return { ...emptyEvent(), name, amount: 100 };
}

function makeConfig(commonEvents: EventModel[], scenarios: ScenarioModel[]): ConfigModel {
  return {
    simulation: { startDate: '', endDate: '2030-12', startingCash: 0, emergencyFundMonths: null },
    common: { events: commonEvents, loans: [], investments: [] },
    scenarios,
  };
}

let container: HTMLDivElement;
let latest: ConfigModel;
let runs: number;
let optimizerToggles: boolean[];

interface HarnessProps {
  initial: ConfigModel;
  optimizerEnabled?: boolean;
  running?: boolean;
  canRun?: boolean;
  runError?: string | null;
}

function Harness({
  initial,
  optimizerEnabled = false,
  running = false,
  canRun = true,
  runError = null,
}: HarnessProps) {
  const [config, setConfig] = useState(initial);
  const [enabled, setEnabled] = useState(optimizerEnabled);
  latest = config;
  return (
    <Workspace
      config={config}
      optimizerEnabled={enabled}
      onOptimizerEnabledChange={(value) => {
        optimizerToggles.push(value);
        setEnabled(value);
      }}
      running={running}
      canRun={canRun}
      runError={runError}
      onRun={() => {
        runs += 1;
      }}
      onChange={(next) => {
        latest = next;
        setConfig(next);
      }}
    />
  );
}

async function mount(config: ConfigModel, props: Omit<HarnessProps, 'initial'> = {}): Promise<void> {
  await act(async () => {
    render(<Harness initial={config} {...props} />, container);
  });
}

function optimized(name: string, field: OptimizeField): EventModel {
  const base = event(name);
  return { ...base, optimize: defaultOptimize(field, base, makeConfig([], []).simulation) };
}

function buttons(label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter(
    (element) => element.textContent?.trim() === label,
  );
}

async function click(label: string, index = 0): Promise<void> {
  const found = buttons(label)[index];
  if (!found) throw new Error(`no button labelled "${label}" at index ${index}`);
  await act(async () => {
    found.click();
  });
}

beforeEach(() => {
  runs = 0;
  optimizerToggles = [];
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('Move to common', () => {
  it('moves a scenario event straight to common when no same-named events exist elsewhere', async () => {
    const moved = event('Bonus');
    const scenario = { ...emptyScenario('plan a'), events: [moved] };
    await mount(makeConfig([], [scenario]));

    await click('Move to common');
    expect(latest.common.events.map((e) => e.id)).toEqual([moved.id]);
    expect(latest.scenarios[0]!.events).toHaveLength(0);
    // No dialog needed.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('asks about same-named events in other scenarios and removes them on request', async () => {
    const moved = event('Bonus');
    const twin = event('Bonus');
    const a = { ...emptyScenario('plan a'), events: [moved] };
    const b = { ...emptyScenario('plan b'), events: [twin] };
    await mount(makeConfig([], [a, b]));

    await click('Move to common', 0);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('plan b');

    await click('Move and remove duplicates');
    expect(latest.common.events.map((e) => e.id)).toEqual([moved.id]);
    expect(latest.scenarios[0]!.events).toHaveLength(0);
    expect(latest.scenarios[1]!.events).toHaveLength(0);
  });

  it('can keep the duplicates instead', async () => {
    const moved = event('Bonus');
    const twin = event('Bonus');
    const a = { ...emptyScenario('plan a'), events: [moved] };
    const b = { ...emptyScenario('plan b'), events: [twin] };
    await mount(makeConfig([], [a, b]));

    await click('Move to common', 0);
    await click('Move and keep duplicates');
    expect(latest.common.events.map((e) => e.id)).toEqual([moved.id]);
    expect(latest.scenarios[1]!.events.map((e) => e.id)).toEqual([twin.id]);
  });
});

describe('Move to scenario', () => {
  it('copies a common event into the selected scenarios via Select all', async () => {
    const source = event('Bonus');
    const a = emptyScenario('plan a');
    const b = emptyScenario('plan b');
    await mount(makeConfig([source], [a, b]));

    await click('Move to scenario…');
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    await click('Select all');
    await click('Copy to selected');

    expect(latest.common.events.map((e) => e.id)).toEqual([source.id]);
    expect(latest.scenarios[0]!.events.map((e) => e.name)).toEqual(['Bonus']);
    expect(latest.scenarios[1]!.events.map((e) => e.name)).toEqual(['Bonus']);
  });

  it('moves a common event into one selected scenario, removing it from common', async () => {
    const source = event('Bonus');
    const a = emptyScenario('plan a');
    const b = emptyScenario('plan b');
    await mount(makeConfig([source], [a, b]));

    await click('Move to scenario…');
    const dialog = container.querySelector('[role="dialog"]');
    const checkbox = Array.from(
      dialog?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [],
    ).find((input) => input.closest('label')?.textContent?.includes('plan b'));
    if (!checkbox) throw new Error('no checkbox for plan b');
    await act(async () => {
      checkbox.click();
    });

    await click('Move to selected');
    expect(latest.common.events).toHaveLength(0);
    expect(latest.scenarios[0]!.events).toHaveLength(0);
    expect(latest.scenarios[1]!.events.map((e) => e.name)).toEqual(['Bonus']);
  });
});

describe('the pinned workspace bar', () => {
  it('offers Run Forecast alongside the section navigation', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));

    const bar = container.querySelector('.workbar');
    expect(bar).not.toBeNull();
    expect(bar?.querySelector('nav.sectionnav')).not.toBeNull();

    const run = Array.from(bar!.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === 'Run Forecast',
    );
    expect(run).toBeDefined();

    await act(async () => {
      run!.click();
    });
    expect(runs).toBe(1);
  });

  it('disables the pinned run control while a run is in flight', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]), { running: true });
    const run = container.querySelector<HTMLButtonElement>('.workbar .btn--primary');
    expect(run?.disabled).toBe(true);
    expect(run?.textContent).toContain('Running');
  });

  it('disables the pinned run control until the engine can run', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]), { canRun: false });
    expect(container.querySelector<HTMLButtonElement>('.workbar .btn--primary')?.disabled).toBe(true);
  });
});

describe('finding optimized events', () => {
  function finderButton(): HTMLButtonElement {
    const found = container.querySelector<HTMLButtonElement>('.optctl__list');
    if (!found) throw new Error('no optimizer list button');
    return found;
  }

  it('reports that nothing uses the optimizer', async () => {
    await mount(makeConfig([], [{ ...emptyScenario('plan a'), events: [event('Rent')] }]));
    expect(finderButton().textContent).toBe('Optimizer (0)');
    expect(finderButton().disabled).toBe(true);
  });

  it('counts the optimized events and lists them on demand', async () => {
    const savings = optimized('Savings', 'amount');
    const trip = optimized('Trip', 'startDate');
    const a = { ...emptyScenario('plan a'), events: [event('Rent'), savings] };
    const b = { ...emptyScenario('plan b'), events: [trip] };
    await mount(makeConfig([], [a, b]), { optimizerEnabled: true });

    expect(finderButton().textContent).toBe('Optimizer (2)');
    expect(finderButton().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.optctl__panel')).toBeNull();

    await act(async () => {
      finderButton().click();
    });

    const panel = container.querySelector('.optctl__panel');
    expect(panel).not.toBeNull();
    expect(finderButton().getAttribute('aria-expanded')).toBe('true');

    const entries = Array.from(panel!.querySelectorAll('.optctl__entry'));
    expect(entries).toHaveLength(2);
    expect(entries[0]!.textContent).toContain('plan a');
    expect(entries[0]!.textContent).toContain('Savings');
    expect(entries[0]!.textContent).toContain('Amount');
    expect(entries[1]!.textContent).toContain('Trip');
    expect(entries[1]!.textContent).toContain('Start month');
  });

  it('jumps to the optimized event and closes the list', async () => {
    const savings = optimized('Savings', 'amount');
    const a = { ...emptyScenario('plan a'), events: [event('Rent'), savings] };
    await mount(makeConfig([], [a]), { optimizerEnabled: true });

    await act(async () => {
      finderButton().click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.optctl__entry')!.click();
    });

    expect(document.activeElement).toBe(container.querySelector(`#event-${savings.id}`));
    expect(container.querySelector('.optctl__panel')).toBeNull();
  });

  it('says so when an optimized event sits in an inactive scenario', async () => {
    const parked = { ...emptyScenario('parked'), active: false, events: [optimized('Savings', 'amount')] };
    await mount(makeConfig([], [parked]), { optimizerEnabled: true });

    await act(async () => {
      finderButton().click();
    });
    expect(container.querySelector('.optctl__entry')?.textContent).toContain('inactive');
  });

  it('warns that the optimizer switch is off', async () => {
    const a = { ...emptyScenario('plan a'), events: [optimized('Savings', 'amount')] };
    await mount(makeConfig([], [a]), { optimizerEnabled: false });

    await act(async () => {
      finderButton().click();
    });
    expect(container.querySelector('.optctl__panel')?.textContent).toMatch(/switched off/i);
  });
});

describe('the section navigation', () => {
  function step(direction: 'Previous' | 'Next'): HTMLButtonElement {
    const found = container.querySelector<HTMLButtonElement>(`[aria-label^="${direction} section"]`);
    if (!found) throw new Error(`no ${direction} step button`);
    return found;
  }

  it('links Simulation and each scenario, but spends no width on common settings', async () => {
    await mount(makeConfig([], [emptyScenario('plan a'), emptyScenario('plan b')]));

    const links = Array.from(container.querySelectorAll('.sectionnav__link')).map((element) =>
      element.textContent?.trim(),
    );
    expect(links).toEqual(['Simulation', 'Scenarios', 'plan a', 'plan b']);
    // The section itself is still there — only its nav link is gone.
    expect(container.querySelector('#section-common')).not.toBeNull();
  });

  it('still steps through common settings, which has no link of its own', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));

    expect(step('Next').getAttribute('aria-label')).toBe('Next section: Common settings');
    await act(async () => {
      step('Next').click();
    });
    // Landed on common: stepping on reaches Scenarios, and back reaches Simulation.
    expect(step('Next').getAttribute('aria-label')).toBe('Next section: Scenarios');
    expect(step('Previous').getAttribute('aria-label')).toBe('Previous section: Simulation');
  });

  it('keeps the jump links neutral before and after a jump', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));
    expect(container.querySelector('.sectionnav__link.is-current, .sectionnav__link[aria-current]')).toBeNull();
    await click('plan a');
    expect(container.querySelector('.sectionnav__link.is-current, .sectionnav__link[aria-current]')).toBeNull();
  });

  it('groups both steppers together ahead of the section links', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));

    const steps = container.querySelector('.sectionnav__steps');
    expect(steps).not.toBeNull();
    expect(steps!.querySelectorAll('.sectionnav__step')).toHaveLength(2);
    // A lone forward arrow beside a scrolling list reads as "scroll right";
    // the pair reads as a stepper.
    const list = container.querySelector('.sectionnav__list')!;
    expect(steps!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the step buttons for their target rather than spending width on text', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));

    expect(step('Next').textContent).not.toContain('Next');
    expect(step('Previous').textContent).not.toContain('Previous');
    // Nothing to go back to from the first section.
    expect(step('Previous').disabled).toBe(true);
    expect(step('Previous').getAttribute('aria-label')).toBe('Previous section');
  });
});

describe('the optimizer cluster', () => {
  function toggle(): HTMLInputElement {
    const found = container.querySelector<HTMLInputElement>('.optctl__switch input');
    if (!found) throw new Error('no optimizer switch');
    return found;
  }

  it('keeps the switch, the count and the list together in the pinned bar', async () => {
    const a = { ...emptyScenario('plan a'), events: [optimized('Savings', 'amount')] };
    await mount(makeConfig([], [a]), { optimizerEnabled: true });

    const cluster = container.querySelector('.workbar .optctl');
    expect(cluster).not.toBeNull();
    expect(cluster!.querySelector('.optctl__switch input')).not.toBeNull();
    expect(cluster!.querySelector('.optctl__list')?.textContent).toBe('Optimizer (1)');
    expect(toggle().checked).toBe(true);
  });

  it('reports switching the optimizer on and off', async () => {
    const a = { ...emptyScenario('plan a'), events: [optimized('Savings', 'amount')] };
    await mount(makeConfig([], [a]), { optimizerEnabled: false });

    expect(toggle().checked).toBe(false);
    await act(async () => {
      toggle().click();
    });
    expect(optimizerToggles).toEqual([true]);
    expect(toggle().checked).toBe(true);
  });

  it('names the switch for assistive tech, since the visible label is shared', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));
    expect(toggle().getAttribute('aria-label')).toBeTruthy();
  });

  it('leaves the switch usable when no event carries an optimizer yet', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));
    // The preference is expressible before the events exist; only the list is empty.
    expect(toggle().disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('.optctl__list')?.disabled).toBe(true);
  });

  it('no longer tells the reader to look at the top of the page', async () => {
    const a = { ...emptyScenario('plan a'), events: [optimized('Savings', 'amount')] };
    await mount(makeConfig([], [a]), { optimizerEnabled: false });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.optctl__list')!.click();
    });
    const panel = container.querySelector('.optctl__panel')!;
    expect(panel.textContent).toMatch(/switched off/i);
    expect(panel.textContent).not.toMatch(/top of the page/i);
  });
});

describe('run errors', () => {
  it('shows the error in the pinned bar, where the user already is', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]), {
      runError: 'endDate must not be before startDate',
    });

    const error = container.querySelector('.workbar__error');
    expect(error).not.toBeNull();
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('endDate must not be before startDate');
  });

  it('shows nothing when the last run was fine', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));
    expect(container.querySelector('.workbar__error')).toBeNull();
  });
});

describe('the section navigation while scrolling', () => {
  /** Lay the sections out as if scrolled, top edge by element id. */
  function layout(tops: Record<string, number>): void {
    for (const [id, top] of Object.entries(tops)) {
      const element = document.getElementById(id);
      if (!element) throw new Error(`no element #${id}`);
      element.getBoundingClientRect = () => ({ top, bottom: top + 300 }) as DOMRect;
    }
    const bar = container.querySelector('.workbar') as HTMLElement;
    bar.getBoundingClientRect = () => ({ top: 0, bottom: 56 }) as DOMRect;
  }

  async function scroll(): Promise<void> {
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
  }

  function previous(): string | null {
    return container.querySelector('[aria-label^="Previous section"]')?.getAttribute('aria-label') ?? null;
  }

  beforeEach(() => {
    // jsdom lays nothing out, so without this every page is "at the bottom".
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 10000, configurable: true });
  });

  afterEach(() => {
    delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
  });

  function tops(scenarios: ConfigModel['scenarios'], at: number): Record<string, number> {
    // Everything above the section at index `at` has scrolled past the bar.
    const ids = [
      'section-simulation',
      'section-common',
      'section-scenarios',
      ...scenarios.map((scenario) => `section-scenario-${scenario.id}`),
    ];
    return Object.fromEntries(ids.map((id, index) => [id, 70 + (index - at) * 400]));
  }

  it('keeps previous and next relative to the section on screen', async () => {
    const config = makeConfig([], [emptyScenario('plan a'), emptyScenario('plan b')]);
    await mount(config);
    expect(previous()).toBe('Previous section');

    layout(tops(config.scenarios, 4));
    await scroll();
    expect(previous()).toBe('Previous section: plan a');

    layout(tops(config.scenarios, 3));
    await scroll();
    expect(previous()).toBe('Previous section: Scenarios');
  });

  it('holds a jumped-to section while the jump scrolls past the others', async () => {
    const config = makeConfig([], [emptyScenario('plan a'), emptyScenario('plan b')]);
    await mount(config);

    await click('plan b');
    // Mid-way through a smooth scroll, plan a is passing under the bar.
    layout(tops(config.scenarios, 3));
    await scroll();
    expect(previous()).toBe('Previous section: plan a');

    // Once the jump has settled, the reader's own scrolling takes over.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    layout(tops(config.scenarios, 0));
    await scroll();
    expect(previous()).toBe('Previous section');
  });
});

