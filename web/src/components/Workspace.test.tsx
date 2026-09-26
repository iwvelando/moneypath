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
    expect(finderButton().textContent).toBe('Optimizer: Off');
    expect(finderButton().disabled).toBe(false);
    await click('Optimizer: Off');
    expect(container.querySelector('.optctl__panel')?.textContent).toContain('No events are set up');
    expect(container.querySelector('.optctl__panel')?.textContent).toContain('Add optimizer');
  });

  it('lists all optimized events on demand', async () => {
    const savings = optimized('Savings', 'amount');
    const trip = optimized('Trip', 'startDate');
    const a = { ...emptyScenario('plan a'), events: [event('Rent'), savings] };
    const b = { ...emptyScenario('plan b'), events: [trip] };
    await mount(makeConfig([], [a, b]), { optimizerEnabled: true });

    expect(finderButton().textContent).toBe('Optimizer: On');
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
  it('opens a complete table of contents with scenarios nested beneath Scenarios', async () => {
    await mount(makeConfig([], [emptyScenario('plan a'), emptyScenario('plan b')]));
    expect(container.querySelector('.sectionnav__panel')).toBeNull();
    await click('Jump to section');
    const links = Array.from(container.querySelectorAll('.sectionnav__link')).map((el) => el.textContent);
    expect(links).toEqual(['Simulation', 'Common settings', 'Scenarios', 'plan a', 'plan b']);
    expect(container.querySelector('.sectionnav__children')?.closest('li')?.textContent)
      .toBe('Scenariosplan aplan b');
  });

  it('jumps directly to common settings, focuses the section, and closes', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));
    await click('Jump to section');
    await click('Common settings');
    expect(document.activeElement).toBe(container.querySelector('#section-common'));
    expect(container.querySelector('.sectionnav__panel')).toBeNull();
  });

  it('includes inactive and unnamed scenarios and jumps by identity', async () => {
    const scenario = { ...emptyScenario(''), active: false };
    await mount(makeConfig([], [scenario]));
    await click('Jump to section');
    await click('Scenario 1');
    expect(document.activeElement).toBe(container.querySelector(`#section-scenario-${scenario.id}`));
  });

  it('dismisses with Escape and returns focus to the trigger', async () => {
    await mount(makeConfig([], []));
    await click('Jump to section');
    await act(async () => {
      buttons('Common settings')[0]!.focus();
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('.sectionnav__panel')).toBeNull();
    expect(document.activeElement).toBe(buttons('Jump to section')[0]);
  });

  it('handles Escape when pointer activation leaves focus outside the trigger', async () => {
    await mount(makeConfig([], []));
    await click('Jump to section');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('.sectionnav__panel')).toBeNull();
    expect(document.activeElement).toBe(buttons('Jump to section')[0]);
  });

  it('dismisses on outside pointer interaction and when focus leaves', async () => {
    await mount(makeConfig([], []));
    await click('Jump to section');
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(container.querySelector('.sectionnav__panel')).toBeNull();
    await click('Jump to section');
    await act(async () => { buttons('Simulation')[0]!.focus(); });
    await act(async () => { buttons('Run Forecast')[0]!.focus(); });
    expect(container.querySelector('.sectionnav__panel')).toBeNull();
  });

  it('does not interrupt a click when the browser briefly clears focus', async () => {
    await mount(makeConfig([], []));
    await click('Jump to section');
    await act(async () => {
      buttons('Jump to section')[0]!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    });
    await click('Common settings');
    expect(document.activeElement).toBe(container.querySelector('#section-common'));
    expect(container.querySelector('.sectionnav__panel')).toBeNull();
  });

  it('shows only one workbar panel at a time', async () => {
    await mount(makeConfig([], []));
    await click('Jump to section');
    await click('Optimizer: Off');
    expect(container.querySelector('.sectionnav__panel')).toBeNull();
    expect(container.querySelector('.optctl__panel')).not.toBeNull();
    await click('Jump to section');
    expect(container.querySelector('.optctl__panel')).toBeNull();
    expect(container.querySelector('.sectionnav__panel')).not.toBeNull();
  });
});

describe('the optimizer panel', () => {
  function toggle(): HTMLInputElement {
    return container.querySelector<HTMLInputElement>('.optctl__switch input')!;
  }

  it('shows only the state in its trigger, with the switch and events inside its panel', async () => {
    const a = { ...emptyScenario('plan a'), events: [optimized('Savings', 'amount')] };
    await mount(makeConfig([], [a]), { optimizerEnabled: true });
    expect(toggle()).toBeNull();
    await click('Optimizer: On');
    expect(toggle().checked).toBe(true);
    expect(toggle().closest('.optctl__panel')).not.toBeNull();
  });

  it('changes the existing preference without changing the plan or starting a run', async () => {
    const config = makeConfig([], [{ ...emptyScenario('plan a'), events: [optimized('Savings', 'amount')] }]);
    await mount(config);
    await click('Optimizer: Off');
    await act(async () => { toggle().click(); });
    expect(optimizerToggles).toEqual([true]);
    expect(toggle().checked).toBe(true);
    expect(buttons('Optimizer: On')).toHaveLength(1);
    await act(async () => { toggle().click(); });
    expect(optimizerToggles).toEqual([true, false]);
    expect(latest).toEqual(config);
    expect(runs).toBe(0);
  });

  it('allows setting the preference before any event is configured', async () => {
    await mount(makeConfig([], []));
    await click('Optimizer: Off');
    expect(toggle().disabled).toBe(false);
    await act(async () => { toggle().click(); });
    expect(buttons('Optimizer: On')).toHaveLength(1);
    expect(container.querySelector('.optctl__panel')?.textContent).toContain('No events are set up');
  });

  it('disables the preference while running, but still allows inspecting events', async () => {
    await mount(makeConfig([], [{ ...emptyScenario('plan a'), events: [optimized('Savings', 'amount')] }]), { running: true });
    await click('Optimizer: Off');
    expect(toggle().disabled).toBe(true);
    expect(container.querySelector('.optctl__entry')).not.toBeNull();
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

