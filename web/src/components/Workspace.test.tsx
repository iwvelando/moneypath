import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultOptimize } from '../config/optimize';
import {
  emptyChoice,
  emptyEvent,
  emptyGuardrail,
  emptyInvestment,
  emptyLoan,
  emptyOption,
  emptyScenario,
  type ConfigModel,
  type EventModel,
  type OptimizeField,
  type ScenarioModel,
} from '../config/types';
import type { Problem } from '../engine/types';
import { Problems, problemSet } from './problems';
import { Workspace } from './Workspace';

function event(name: string): EventModel {
  return { ...emptyEvent(), name, amount: 100 };
}

function makeConfig(commonEvents: EventModel[], scenarios: ScenarioModel[]): ConfigModel {
  return {
    simulation: { startDate: '', endDate: '2030-12', startingCash: 0, cashInterestRate: null, emergencyFundMonths: null },
    guardrails: [],
    common: { events: commonEvents, loans: [], investments: [] },
    choices: [],
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
  blocked?: boolean;
  runError?: string | null;
}

function Harness({
  initial,
  optimizerEnabled = false,
  running = false,
  canRun = true,
  blocked = false,
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
      blocked={blocked}
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

describe('Move to baseline', () => {
  it('moves a scenario event straight to common when no same-named events exist elsewhere', async () => {
    const moved = event('Bonus');
    const scenario = { ...emptyScenario('plan a'), events: [moved] };
    await mount(makeConfig([], [scenario]));

    await click('Move to baseline');
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

    await click('Move to baseline', 0);
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

    await click('Move to baseline', 0);
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

describe('the cash interest rate field', () => {
  function cashInterestInput(): HTMLInputElement {
    const label = Array.from(container.querySelectorAll('label')).find(
      (element) => element.textContent?.trim() === 'Cash interest rate',
    );
    if (!label) throw new Error('no "Cash interest rate" field in the Simulation section');
    return container.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`)!;
  }

  it('sits in the Simulation section, blank by default, with help', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));

    const input = cashInterestInput();
    expect(input.value).toBe('');
    expect(input.closest('#section-simulation')).not.toBeNull();
    expect(input.placeholder).toBe('0');
    expect(container.querySelector('button[aria-label="Help: Cash interest rate"]')).not.toBeNull();
  });

  it('writes what is typed into the simulation settings, and clears back to blank', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));

    const input = cashInterestInput();
    await act(async () => {
      input.value = '4.5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(latest.simulation.cashInterestRate).toBe(4.5);

    await act(async () => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(latest.simulation.cashInterestRate).toBeNull();
  });
});

describe('the Guardrails section', () => {
  function field(label: string, scope: ParentNode = container): HTMLInputElement | HTMLSelectElement {
    const found = Array.from(scope.querySelectorAll('label')).find((element) => element.textContent?.trim() === label);
    if (!found) throw new Error(`no "${label}" field`);
    return container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${CSS.escape(found.htmlFor)}`)!;
  }

  async function type(input: HTMLInputElement, text: string): Promise<void> {
    await act(async () => {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('says there are none yet, and is in the section navigation after Simulation', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));
    const section = container.querySelector('#section-guardrails')!;
    expect(section.previousElementSibling?.id).toBe('section-simulation');
    expect(section.textContent).toContain('No guardrails yet.');
  });

  it('adds a cash floor, opens it on its name, and writes what is typed', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));
    await click('Add guardrail');
    expect(latest.guardrails).toHaveLength(1);
    expect(latest.guardrails[0]).toMatchObject({ name: '', kind: 'cashFloor', amount: null, startDate: '', endDate: '' });

    const section = container.querySelector<HTMLElement>('#section-guardrails')!;
    const name = field('Name', section) as HTMLInputElement;
    expect(document.activeElement).toBe(name);
    const kind = field('Kind', section) as HTMLSelectElement;
    expect(kind.value).toBe('cashFloor');
    expect(Array.from(kind.options, (option) => option.textContent)).toEqual(['Cash floor', 'Debt-free', 'Investments last']);

    await type(name, 'Cushion');
    await type(field('Floor', section) as HTMLInputElement, '-250');
    await type(field('Start month', section) as HTMLInputElement, '202701');
    expect(latest.guardrails[0]).toMatchObject({ name: 'Cushion', amount: -250, startDate: '2027-01' });
    expect(section.querySelector('.editor-card__title')?.textContent).toBe('Cushion');
    expect(section.querySelector('.editor-card__summary')?.textContent).toBe('Cash never below -$250.00');
    expect(section.querySelector('.editor-card__detail')?.textContent).toBe('From 2027-01');
    expect(container.querySelector('button[aria-label="Help: Start month"]')).not.toBeNull();
  });

  it('removes and duplicates a guardrail', async () => {
    const config = makeConfig([], [emptyScenario('plan a')]);
    config.guardrails = [{ ...emptyGuardrail(), name: 'Cushion', amount: 100 }];
    await mount(config);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Duplicate Cushion"]')!.click();
    });
    expect(latest.guardrails.map((g) => g.name)).toEqual(['Cushion', 'Cushion']);
    expect(latest.guardrails[0]!.id).not.toBe(latest.guardrails[1]!.id);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Remove Cushion"]')!.click();
    });
    expect(latest.guardrails).toHaveLength(1);
  });

  it('shows what the engine says under the field it concerns', async () => {
    const config = makeConfig([], [emptyScenario('plan a')]);
    config.guardrails = [{ ...emptyGuardrail(), name: 'Cushion' }];
    const problems: Problem[] = [
      { level: 'error', path: 'guardrails.0.amount', where: 'Guardrail “Cushion”', message: 'The floor amount is required.' },
    ];
    await act(async () => {
      render(
        <Problems.Provider value={problemSet(problems)}>
          <Harness initial={config} />
        </Problems.Provider>,
        container,
      );
    });
    const floor = container.querySelector('[data-path="guardrails.0.amount"]')!;
    expect(floor.textContent).toContain('The floor amount is required.');
    expect(container.querySelector('#section-guardrails .editor-card__notice')?.textContent).toBe('Check details');
  });

  it('keeps a kind it cannot check, as written, for its error to explain', async () => {
    const config = makeConfig([], [emptyScenario('plan a')]);
    config.guardrails = [{ ...emptyGuardrail(), name: 'Typo', kind: 'cashfloor' }];
    await mount(config);
    const kind = field('Kind', container.querySelector('#section-guardrails')!) as HTMLSelectElement;
    expect(kind.value).toBe('cashfloor');
    expect(kind.closest('[data-path]')?.getAttribute('data-path')).toBe('guardrails.0.kind');
  });

  /** A plan with a loan and an investment in the baseline, an option and a scenario each. */
  function planWithEntries(): ConfigModel {
    const config = makeConfig([], [emptyScenario('plan a'), emptyScenario('plan b')]);
    config.common.loans = [{ ...emptyLoan(), name: 'Mortgage' }];
    config.common.investments = [{ ...emptyInvestment(), name: 'Brokerage' }];
    const car = emptyOption('Car');
    car.loans = [{ ...emptyLoan(), name: 'Car loan' }];
    car.investments = [{ ...emptyInvestment(), name: 'HSA' }];
    config.choices = [{ ...emptyChoice('Ride'), options: [car, emptyOption('Walk')] }];
    config.scenarios[0]!.loans = [{ ...emptyLoan(), name: 'Boat' }, { ...emptyLoan(), name: 'Mortgage' }];
    config.scenarios[1]!.investments = [{ ...emptyInvestment(), name: 'IRA' }, { ...emptyInvestment(), name: '' }];
    return config;
  }

  function checklist(field: string): HTMLElement {
    return container.querySelector<HTMLElement>(`#section-guardrails [data-path="guardrails.0.${field}"]`)!;
  }

  function boxes(scope: HTMLElement): [string, boolean][] {
    return Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'), (box) => [
      scope.querySelector(`label[for="${CSS.escape(box.id)}"]`)?.textContent ?? '',
      box.checked,
    ]);
  }

  async function toggle(scope: HTMLElement, name: string): Promise<void> {
    const label = Array.from(scope.querySelectorAll('label')).find((element) => element.textContent === name)!;
    await act(async () => {
      container.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`)!.click();
    });
  }

  it('makes a debt-free from a month, on the loans ticked or on every loan', async () => {
    const config = planWithEntries();
    config.guardrails = [{ ...emptyGuardrail(), name: 'Debt gone' }];
    await mount(config);
    const section = container.querySelector<HTMLElement>('#section-guardrails')!;
    const kind = field('Kind', section) as HTMLSelectElement;
    await act(async () => {
      kind.value = 'debtFree';
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(latest.guardrails[0]!.kind).toBe('debtFree');
    expect(section.querySelector('.editor-card__detail')?.textContent).toBe('Debt-free month not set');
    expect(Array.from(section.querySelectorAll('label'), (label) => label.textContent?.trim())).not.toContain('Floor');

    const loans = checklist('loans');
    // The group is named by its label, not by its help text.
    expect(container.querySelector(`#${CSS.escape(loans.getAttribute('aria-labelledby')!)}`)?.textContent).toBe('Loans');
    expect(boxes(loans)).toEqual([
      ['Mortgage', false],
      ['Car loan', false],
      ['Boat', false],
    ]);
    expect(loans.textContent).toContain('Leave every box unticked to check every loan.');
    await toggle(loans, 'Boat');
    await toggle(loans, 'Mortgage');
    expect(latest.guardrails[0]!.loans).toEqual(['Boat', 'Mortgage']);
    await toggle(loans, 'Boat');
    await toggle(loans, 'Mortgage');
    expect(latest.guardrails[0]!.loans).toBeNull();

    await type(field('Debt-free from', section) as HTMLInputElement, '203001');
    expect(latest.guardrails[0]!.startDate).toBe('2030-01');
    expect(section.querySelector('.editor-card__summary')?.textContent).toBe('Nothing owed on any loan');
    expect(section.querySelector('.editor-card__detail')?.textContent).toBe('From 2030-01');
  });

  it('makes an investments-last on the investments ticked, with an optional amount', async () => {
    const config = planWithEntries();
    config.guardrails = [{ ...emptyGuardrail(), name: 'Savings last', kind: 'lasts' }];
    await mount(config);
    const section = container.querySelector<HTMLElement>('#section-guardrails')!;
    const investments = checklist('investments');
    expect(boxes(investments)).toEqual([
      ['Brokerage', false],
      ['HSA', false],
      ['IRA', false],
    ]);
    expect(section.querySelector('.editor-card__summary')?.textContent).toBe('Investments not picked');
    await toggle(investments, 'IRA');
    await toggle(investments, 'Brokerage');
    expect(latest.guardrails[0]!.investments).toEqual(['IRA', 'Brokerage']);
    expect(section.querySelector('.editor-card__summary')?.textContent).toBe('IRA, Brokerage never emptied');
    await type(field('Never below', section) as HTMLInputElement, '50000');
    expect(latest.guardrails[0]!.amount).toBe(50000);
    expect(section.querySelector('.editor-card__summary')?.textContent).toBe('IRA, Brokerage never below $50,000.00');
    expect(field('Start month', section)).toBeDefined();
  });

  it('lets an explicitly empty loan list become every loan even when the plan has no loans', async () => {
    const config = makeConfig([], [emptyScenario('plan')]);
    config.guardrails = [{ ...emptyGuardrail(), name: 'Debt gone', kind: 'debtFree', startDate: '2030-01', loans: [] }];
    await mount(config);
    const loans = checklist('loans');
    expect(boxes(loans)).toEqual([]);
    // Preserve the uploaded input until the reader explicitly removes the list.
    expect(latest.guardrails[0]!.loans).toEqual([]);
    const everyLoan = Array.from(loans.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Use every loan');
    expect(everyLoan).toBeDefined();
    await act(async () => everyLoan!.click());
    expect(latest.guardrails[0]!.loans).toBeNull();
    expect(loans.textContent).not.toContain('Use every loan');
    expect(latest.guardrails[0]!.name).toBe('Debt gone');
    expect(latest.guardrails[0]!.startDate).toBe('2030-01');
  });

  it('keeps a listed name the plan does not have, ticked, with its error, until it is unticked', async () => {
    const config = planWithEntries();
    config.guardrails = [{ ...emptyGuardrail(), name: 'Debt gone', kind: 'debtFree', startDate: '2030-01', loans: ['Mortgage', 'Yacht'] }];
    const problems: Problem[] = [
      {
        level: 'error',
        path: 'guardrails.0.loans.1',
        where: 'Guardrail “Debt gone”, loan “Yacht”',
        message: 'No loan in the plan is named “Yacht”.',
      },
    ];
    await act(async () => {
      render(
        <Problems.Provider value={problemSet(problems)}>
          <Harness initial={config} />
        </Problems.Provider>,
        container,
      );
    });
    const loans = checklist('loans');
    expect(boxes(loans)).toEqual([
      ['Mortgage', true],
      ['Car loan', false],
      ['Boat', false],
      ['Yacht', true],
    ]);
    expect(loans.querySelector('[data-path="guardrails.0.loans.1"]')?.textContent).toBe('No loan in the plan is named “Yacht”.');
    await toggle(loans, 'Yacht');
    expect(latest.guardrails[0]!.loans).toEqual(['Mortgage']);
  });

  it('shows an amount a debt-free does not use, with its warning and a way to take it away', async () => {
    const config = planWithEntries();
    config.guardrails = [{ ...emptyGuardrail(), name: 'Debt gone', kind: 'debtFree', startDate: '2030-01', amount: 15000 }];
    const problems: Problem[] = [
      {
        level: 'warning',
        path: 'guardrails.0.amount',
        where: 'Guardrail “Debt gone”',
        message: 'A debt-free guardrail does not use an amount, so this has no effect.',
      },
    ];
    await act(async () => {
      render(
        <Problems.Provider value={problemSet(problems)}>
          <Harness initial={config} />
        </Problems.Provider>,
        container,
      );
    });
    const unused = container.querySelector('#section-guardrails [data-path="guardrails.0.amount"]')!;
    expect(unused.textContent).toContain('$15,000.00');
    expect(unused.textContent).toContain('Warning: A debt-free guardrail does not use an amount, so this has no effect.');
    await act(async () => {
      Array.from(unused.querySelectorAll('button')).find((b) => b.textContent === 'Take away')!.click();
    });
    expect(latest.guardrails[0]!.amount).toBeNull();
  });

  it('shows the names a cash floor does not use, with their warning and a way to take them away', async () => {
    const config = makeConfig([], [emptyScenario('plan a')]);
    config.guardrails = [{ ...emptyGuardrail(), name: 'Cushion', amount: 1, loans: ['Mortgage', 'Car'] }];
    const problems: Problem[] = [
      { level: 'warning', path: 'guardrails.0.loans', where: 'Guardrail “Cushion”', message: 'A cash floor does not use loans, so this has no effect.' },
    ];
    await act(async () => {
      render(
        <Problems.Provider value={problemSet(problems)}>
          <Harness initial={config} />
        </Problems.Provider>,
        container,
      );
    });
    const unused = container.querySelector('[data-path="guardrails.0.loans"]')!;
    expect(unused.textContent).toContain('Mortgage, Car');
    expect(unused.textContent).toContain('Warning: A cash floor does not use loans, so this has no effect.');
    await act(async () => {
      Array.from(unused.querySelectorAll('button')).find((b) => b.textContent === 'Take away')!.click();
    });
    expect(latest.guardrails[0]!.loans).toBeNull();
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
    expect(links).toEqual(['Simulation', 'Guardrails', 'Baseline', 'Choices', 'Scenarios', 'plan a', 'plan b']);
    expect(container.querySelector('.sectionnav__children')?.closest('li')?.textContent)
      .toBe('Scenariosplan aplan b');
  });

  it('jumps directly to the baseline, focuses the section, and closes', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));
    await click('Jump to section');
    await click('Baseline');
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
      buttons('Baseline')[0]!.focus();
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
    await click('Baseline');
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

  it('spells out, in the bar, an error that has no field of its own on the page', async () => {
    const problems: Problem[] = [
      { level: 'error', path: 'scenarios.0.select', where: 'Scenario “plan a”', message: 'The selections name a choice, “Car”, that this plan does not have.' },
      { level: 'error', path: 'scenarios.0.name', where: 'Scenario 1', message: 'The scenario needs a name.' },
      { level: 'warning', path: 'colour', where: '', message: '“colour” is not a setting moneypath knows, so it is ignored.' },
    ];
    await act(async () => {
      render(
        <Problems.Provider value={problemSet(problems)}>
          <Harness initial={makeConfig([], [emptyScenario('plan a')])} blocked />
        </Problems.Provider>,
        container,
      );
    });
    const bar = container.querySelector('.workbar__error')!;
    expect(bar.textContent).toContain('2 things in your plan need fixing before the forecast can run.');
    // Only the one with nowhere else to appear is written out; a warning never is.
    expect(Array.from(bar.querySelectorAll('li'), (item) => item.textContent)).toEqual([
      'Scenario “plan a”: The selections name a choice, “Car”, that this plan does not have.',
    ]);
    expect(buttons('Show the first')).toHaveLength(1);
  });

  it('says nothing about errors until a run is asked for', async () => {
    await act(async () => {
      render(
        <Problems.Provider value={problemSet([{ level: 'error', path: 'scenarios.0.name', where: 'Scenario 1', message: 'The scenario needs a name.' }])}>
          <Harness initial={makeConfig([], [emptyScenario('plan a')])} />
        </Problems.Provider>,
        container,
      );
    });
    expect(container.querySelector('.workbar__error')).toBeNull();
  });

  it('shows nothing when the last run was fine', async () => {
    await mount(makeConfig([], [emptyScenario('plan a')]));
    expect(container.querySelector('.workbar__error')).toBeNull();
  });
});

