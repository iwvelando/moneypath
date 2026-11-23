import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { addMonths } from './config/month';
import { fromConfigDocument } from './config/serialize';
import { starterConfig } from './config/starter';
import {
  emptyChoice,
  emptyEvent,
  emptyGuardrail,
  emptyInvestment,
  emptyLoan,
  emptyAsset,
  emptyOption,
  newId,
  type ConfigModel,
} from './config/types';
import { EDITOR_STATE_VERSION, KEYS } from './state/persistence';
import { storageKeys } from './test/setup';

/**
 * A DOM smoke test of the whole app against the real engine: the wasm build,
 * which `src/test/setup.ts` serves from disk. It exercises the paths that only
 * break at runtime: first render, autosave, running a forecast, and switching
 * to Results.
 */

let container: HTMLDivElement;

async function settle(ms = 250): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled "${label}"`);
  return found;
}

/** Save a plan as the draft the app restores when it starts. */
function seedPlan(config: ConfigModel): void {
  window.localStorage.setItem(
    KEYS.editorState,
    JSON.stringify({ version: EDITOR_STATE_VERSION, config }),
  );
}

/**
 * The starter plan with one decision, Home, that every scenario answers Stay.
 * Move costs money up front and saves some every month after, so flipping to
 * it falls behind at first and moves ahead later.
 */
function planWithAChoice(): ConfigModel {
  const config = starterConfig();
  const stay = emptyOption('Stay');
  const move = emptyOption('Move');
  // The start month reports the opening balances, so the cost lands a month in.
  const moveMonth = addMonths(config.simulation.startDate, 1)!;
  move.events = [
    { ...emptyEvent(), name: 'Moving costs', amount: -10000, startDate: moveMonth, endDate: moveMonth },
    { ...emptyEvent(), name: 'Lower rent', amount: 500 },
  ];
  const home = { ...emptyChoice('Home'), options: [stay, move] };
  config.choices = [home];
  for (const scenario of config.scenarios) scenario.select = { [home.id]: stay.id };
  return config;
}

/**
 * Seed a saved plan whose first scenario carries an optimize block, with the
 * optimizer toggle already on. The event is spending, so the optimizer looks
 * for the most the plan can afford, which is far more than the configured
 * amount.
 */
function seedPlanWithOptimizer(): void {
  const config = starterConfig();
  const scenario = config.scenarios[0]!;
  scenario.events = [
    {
      id: 'optimized-event',
      name: 'Sabbatical spending',
      amount: -100,
      growth: { mode: 'fixed', rate: null },
      percentage: null,
      frequency: null,
      startDate: '',
      endDate: '',
      optimize: {
        field: 'amount',
        min: -5000,
        max: 0,
        minDate: '',
        maxDate: '',
        tolerance: null,
        maxIterations: null,
        guardrail: '',
      },
    },
  ];
  seedPlan(config);
  window.localStorage.setItem(KEYS.optimize, 'true');
}

/** The optimized event's amount as the editor last autosaved it. */
function savedAmount(): number | null {
  const raw = window.localStorage.getItem(KEYS.editorState);
  if (raw === null) throw new Error('no saved editor state');
  const parsed = JSON.parse(raw) as { config: { scenarios: { events: { amount: number }[] }[] } };
  return parsed.config.scenarios[0]?.events[0]?.amount ?? null;
}

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('the app', () => {
  it('renders the workspace with the starter config and a disabled Results tab', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    expect(container.querySelector('h1')?.textContent).toBe('moneypath');
    expect(container.querySelector('#section-simulation')).not.toBeNull();
    expect(container.querySelector('#section-common')).not.toBeNull();
    expect(container.querySelectorAll('[id^="section-scenario-"]').length).toBeGreaterThan(0);

    const resultsTab = container.querySelector<HTMLButtonElement>('#tab-results');
    expect(resultsTab?.disabled).toBe(true);
  });

  it('links to the public source repository from the footer', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    const link = Array.from(container.querySelectorAll<HTMLAnchorElement>('footer a')).find(
      (element) => element.textContent?.trim() === 'About this site',
    );
    expect(link?.getAttribute('href')).toBe('https://github.com/iwvelando/moneypath');
  });

  it('marks the document once the engine answers, so browser tests can wait on it', async () => {
    delete document.documentElement.dataset.engine;
    await act(async () => {
      render(<App />, container);
    });
    await settle();
    expect(document.documentElement.dataset.engine).toBe('ready');
  });

  it('autosaves editor state to a versioned localStorage key', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle(600);
    const keys = storageKeys(window.localStorage).filter((key) => key.startsWith('moneypath.editor.'));
    expect(keys).toHaveLength(1);
  });

  it('runs a forecast and shows chart, summary and table on the Results tab', async () => {
    // Mortgage insurance with no cutoff runs for the whole loan, which the
    // engine warns about.
    const config = starterConfig();
    config.common.loans[0]!.mortgageInsurance = 50;
    seedPlan(config);
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(500);

    const resultsTab = container.querySelector<HTMLButtonElement>('#tab-results');
    expect(resultsTab?.disabled).toBe(false);
    expect(resultsTab?.getAttribute('aria-selected')).toBe('true');

    expect(container.querySelector('.chart__svg')).not.toBeNull();
    expect(container.querySelectorAll('.chart__line').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('.results-table tbody tr').length).toBeGreaterThan(10);
    expect(container.querySelector('.summary__card')?.textContent).toContain('Emergency fund');
    // Engine warnings never block the run. They come with its results, and
    // each stays under the field it is about.
    expect(container.querySelector('#panel-results .run-warnings')?.textContent).toContain(
      'Baseline, loan “Car loan”: With no cutoff',
    );
    expect(container.querySelector('#panel-workspace .run-warnings')).toBeNull();
    const cutoff = container.querySelector('[data-path="common.loans.0.mortgageInsuranceCutoff"]');
    expect(cutoff?.querySelector('.field__message.is-warning')?.textContent).toMatch(/^Warning: With no cutoff/);
    expect(cutoff?.querySelector('.field__message.is-error')).toBeNull();

    const scenarioTabs = container.querySelectorAll('[role="tablist"][aria-label="Scenarios"] [role="tab"]');
    expect(scenarioTabs.length).toBeGreaterThan(1);
  });

  it('runs a forecast from a Ctrl+Enter anywhere on the page', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    // The kind of element the user is actually in when they finish a tweak.
    const field = container.querySelector<HTMLInputElement>('#panel-workspace input');
    expect(field).not.toBeNull();
    await act(async () => {
      field!.focus();
      field!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      );
    });
    await settle(500);

    const resultsTab = container.querySelector<HTMLButtonElement>('#tab-results');
    expect(resultsTab?.disabled).toBe(false);
    expect(resultsTab?.getAttribute('aria-selected')).toBe('true');
  });

  it('runs a forecast from the control pinned to the workspace', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    const pinned = container.querySelector<HTMLButtonElement>('.workbar .btn--primary');
    expect(pinned).not.toBeNull();
    expect(pinned?.disabled).toBe(false);
    await act(async () => {
      pinned!.click();
    });
    await settle(500);

    expect(container.querySelector<HTMLButtonElement>('#tab-results')?.disabled).toBe(false);
  });

  it('offers exactly one Run Forecast control, pinned to the workspace', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    const runs = Array.from(container.querySelectorAll('button')).filter(
      (element) => element.textContent?.trim() === 'Run Forecast',
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.closest('.workbar')).not.toBeNull();
    expect(container.querySelector('.toolbar .btn--primary')).toBeNull();
  });

  it('leaves the toolbar to config actions and the theme alone', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    const toolbar = container.querySelector('.toolbar')!;
    // Everything that shapes or starts a run lives in the pinned bar.
    expect(toolbar.querySelector('.optctl')).toBeNull();
    expect(toolbar.querySelector('.switch')).toBeNull();
    expect(toolbar.querySelector('.toolbar__error')).toBeNull();
    expect(container.querySelector('.workbar .optctl__list')).not.toBeNull();
  });

  it('marks the Results tab outdated once the config changes, without locking it', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();
    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(500);

    const resultsTab = () => container.querySelector<HTMLButtonElement>('#tab-results')!;
    expect(resultsTab().classList.contains('is-outdated')).toBe(false);

    // Any edit at all invalidates what is on the Results tab.
    const field = container.querySelector<HTMLInputElement>('#section-simulation input')!;
    await act(async () => {
      field.value = '2027-01';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();

    expect(resultsTab().classList.contains('is-outdated')).toBe(true);
    // Still readable: the previous numbers are the baseline for the edit.
    expect(resultsTab().disabled).toBe(false);
    expect(container.querySelector('.results-stale')).not.toBeNull();

    // The comparison is the same earlier run, so it carries the same notice.
    const compare = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[aria-label="Scenarios"] [role="tab"]'),
    ).find((tab) => tab.textContent?.trim() === 'Compare')!;
    await act(async () => {
      compare.click();
    });
    expect(container.querySelector('.comparison')).not.toBeNull();
    expect(container.querySelector('.results-stale')).not.toBeNull();
  });

  it('does not run from the read-only Results tab', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();
    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(500);

    const field = container.querySelector<HTMLInputElement>('#section-simulation input')!;
    await act(async () => {
      field.value = '2027-01';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    expect(container.querySelector('#tab-results')?.classList.contains('is-outdated')).toBe(true);

    // On Results the shortcut is inert, so the stale marker survives.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    });
    await settle(500);
    expect(container.querySelector('#tab-results')?.classList.contains('is-outdated')).toBe(true);
  });

  it('surfaces engine errors inline without losing editor state', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    // Blank the required end month so the engine rejects the config.
    const endLabel = Array.from(container.querySelectorAll('label')).find(
      (label) => label.textContent === 'End month',
    );
    const endInput = document.getElementById(
      endLabel?.getAttribute('for') ?? '',
    ) as HTMLInputElement | null;
    expect(endInput).not.toBeNull();

    await act(async () => {
      if (endInput) {
        endInput.value = '';
        endInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await settle(50);

    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(500);

    // The run is refused where it was started, the pinned bar, which counts
    // what is wrong and leads to it. The error itself is under its field.
    expect(container.querySelector('.workbar__error')?.textContent).toContain(
      'One thing in your plan needs fixing before the forecast can run.',
    );
    expect(container.querySelector('[data-path="simulation.endDate"] .field__message.is-error')).not.toBeNull();
    expect(container.querySelector('.toolbar__error')).toBeNull();
    await act(async () => {
      button('Show it').click();
    });
    await settle(50);
    expect(document.activeElement).toBe(endInput);

    // Fixing it clears the bar without another run.
    await act(async () => {
      endInput!.value = '2060-01';
      endInput!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(50);
    expect(container.querySelector('.workbar__error')).toBeNull();
    await act(async () => {
      endInput!.value = '';
      endInput!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(50);
    // The editor is still on screen with its content intact.
    expect(container.querySelector('#section-simulation')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('#tab-results')?.disabled).toBe(true);
  });

  it('leaves the plan on the optimizer’s original value until the adjustment is applied', async () => {
    seedPlanWithOptimizer();
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(600);

    // Running does not touch the plan, and the card says so rather than
    // leaving the editor and the results quietly disagreeing.
    expect(savedAmount()).toBe(-100);
    expect(container.textContent).toContain('Your plan keeps the values you configured');
    expect(container.querySelector('.toolbar__hint')).not.toBeNull();

    await act(async () => {
      button('Apply to plan').click();
    });
    await settle(600);

    expect(savedAmount()).toBeLessThan(-100);
    expect(savedAmount()).toBeGreaterThanOrEqual(-5000);
    expect(container.querySelector('.adjustments__applied')?.textContent).toContain(
      'Applied to your plan.',
    );
    // Nothing left to warn about: the download and the plan now agree.
    expect(container.querySelector('.toolbar__hint')).toBeNull();
  });

  it('requires a fresh forecast before keeping a flip after the plan changes', async () => {
    const config = planWithAChoice();
    seedPlan(config);

    await act(async () => render(<App />, container));
    await settle();
    await act(async () => button('Run Forecast').click());
    await settle(500);

    // Change the simulation after running; even an unchanged source scenario
    // would now produce a different path under these shared settings.
    await act(async () => button('Planning Workspace').click());
    const field = container.querySelector<HTMLInputElement>('#section-simulation input')!;
    await act(async () => {
      field.value = '2027-01';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Results').click());

    const pickMove = async () => {
      await act(async () => {
        const option = container.querySelectorAll<HTMLSelectElement>('.flip select')[1]!;
        option.value = [...option.options].find((o) => o.textContent?.trim() === 'Move')!.value;
        option.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await settle(500);
    };
    // Old results remain useful for reading a comparison, but cannot be kept.
    await pickMove();
    expect(container.querySelector('.flip .chart')).not.toBeNull();
    await act(async () => button('Keep as a scenario').click());
    await settle(500);
    expect(container.querySelector('.flip__keep [role="alert"]')?.textContent).toContain(
      'Your plan has changed. Run the forecast again before keeping this path.',
    );
    const savedScenarios = () =>
      (JSON.parse(window.localStorage.getItem(KEYS.editorState)!) as { config: ConfigModel }).config.scenarios;
    expect(savedScenarios()).toHaveLength(config.scenarios.length);

    await act(async () => button('Planning Workspace').click());
    await act(async () => button('Run Forecast').click());
    await settle(500);
    await pickMove();
    await act(async () => button('Keep as a scenario').click());
    await settle(500);
    expect(savedScenarios()).toHaveLength(config.scenarios.length + 1);
    expect(container.querySelector('.flip')?.textContent).toContain('Added to your plan.');
  });

  it('answers the earliest month an entry can take, through the engine, and changes nothing', async () => {
    // A one-off roof against a cushion: the plan the earliest-event fixture
    // pins, without its choice.
    const config = fromConfigDocument({
      version: 2,
      simulation: { startDate: '2026-01', endDate: '2027-12', startingCash: 5000 },
      recommendations: { emergencyFundMonths: 0 },
      guardrails: [
        { name: 'Cushion', kind: 'cashFloor', amount: 4000 },
        { name: 'Never overdrawn', kind: 'cashFloor', amount: 0 },
      ],
      common: {
        events: [
          { name: 'Salary', amount: 3000, endDate: '2027-12' },
          { name: 'Living', amount: -2500 },
        ],
      },
      scenarios: [
        { name: 'full time', events: [{ name: 'New roof', amount: -6000, startDate: '2026-06', endDate: '2026-06' }] },
      ],
    });
    seedPlan(config);
    await act(async () => {
      render(<App />, container);
    });
    await settle();
    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(500);

    const panel = () => container.querySelector<HTMLElement>('.earliest')!;
    expect(panel()).not.toBeNull();
    const before = window.localStorage.getItem(KEYS.editorState);
    await act(async () => {
      button('Find the earliest month').click();
    });
    await settle(500);
    const said = panel().textContent!.replace(/\s+/g, ' ');
    expect(said).toContain('Earliest month: 2026-10.');
    expect(said).toContain('Your plan has 2026-06.');
    expect(said).toContain('A month earlier, in 2026-09:');
    expect(said).toContain('Cushion Breaks in 2026-09');
    expect(window.localStorage.getItem(KEYS.editorState)).toBe(before);
  });

  it('flips one choice from the results and keeps the path as a scenario when asked', async () => {
    const config = planWithAChoice();
    const first = config.scenarios[0]!.name;
    const count = config.scenarios.length;
    seedPlan(config);

    await act(async () => {
      render(<App />, container);
    });
    await settle();
    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(500);

    const panel = () => container.querySelector<HTMLElement>('.flip')!;
    expect(panel().textContent).toContain('Instead of Stay');
    const option = panel().querySelectorAll('select')[1]!;
    await act(async () => {
      option.value = [...option.options].find((o) => o.textContent?.trim() === 'Move')!.value;
      option.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(500);
    expect(panel().textContent).toContain(`${first} (Home: Move) moves ahead`);

    // Reading the flip changed nothing.
    const savedPlan = () =>
      (JSON.parse(window.localStorage.getItem(KEYS.editorState)!) as { config: ConfigModel }).config;
    const saved = () => savedPlan().scenarios;
    await settle(500);
    expect(saved()).toHaveLength(count);
    expect(container.querySelector('#tab-results')!.classList.contains('is-outdated')).toBe(false);

    await act(async () => {
      button('Keep as a scenario').click();
    });
    await settle(600);
    expect(saved().map((s) => s.name)).toEqual([
      first,
      `${first} (Home: Move)`,
      ...config.scenarios.slice(1).map((s) => s.name),
    ]);
    // Restoring a draft gives its rows new ids, so read the pick by name.
    const savedHome = savedPlan().choices[0]!;
    const picked = (scenario: number) =>
      savedHome.options.find((o) => o.id === saved()[scenario]!.select[savedHome.id])?.name;
    expect([picked(0), picked(1)]).toEqual(['Stay', 'Move']);
    // Said once, beside the button that did it.
    expect(container.querySelector('.notices')).toBeNull();
    // The results are of the plan before the path was kept.
    expect(container.querySelector('#tab-results')!.classList.contains('is-outdated')).toBe(true);
    expect(panel().textContent).toContain('Added to your plan.');
  });
  /** The input of a field, found by its place in the plan. */
  function fieldInput(path: string): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>(`[data-path="${path}"] input`);
    if (!input) throw new Error(`no field at ${path}`);
    return input;
  }

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      input.dispatchEvent(new Event('focus'));
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('blur'));
    });
    await settle(50);
  }

  it('shows what the engine refuses under the field as it is typed, and on the collapsed entry', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    const path = 'common.investments.0.withdrawalTaxRate';
    const field = () => container.querySelector(`[data-path="${path}"]`)!;
    expect(field().querySelector('.field__message')).toBeNull();
    const card = field().closest('.editor-card')!;
    expect(card.querySelector('.editor-card__notice')).toBeNull();

    await type(fieldInput(path), '-1');
    expect(field().querySelector('.field__message.is-error')?.textContent).toBe(
      'The withdrawal tax rate must be at least 0 and less than 100.',
    );
    expect(fieldInput(path).getAttribute('aria-invalid')).toBe('true');
    // The entry was never opened; its summary says to look inside.
    expect(card.querySelector('.editor-card__notice')?.textContent).toBe('Check details');
    // Nothing is said anywhere else until a run is asked for.
    expect(container.querySelector('.workbar__error')).toBeNull();

    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(300);
    expect(container.querySelector<HTMLButtonElement>('#tab-results')?.disabled).toBe(true);
    expect(container.querySelector('.workbar__error')?.textContent).toContain('One thing in your plan');
    // Going to it opens the entry that holds it.
    await act(async () => {
      button('Show it').click();
    });
    await settle(50);
    expect(card.classList.contains('is-open')).toBe(true);
    expect(document.activeElement).toBe(fieldInput(path));

    await type(fieldInput(path), '15');
    expect(field().querySelector('.field__message')).toBeNull();
    expect(card.querySelector('.editor-card__notice')).toBeNull();
    expect(container.querySelector('.workbar__error')).toBeNull();
  });

  it('will not run on a number other than the one on screen', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    const path = 'common.investments.0.taxRate';
    await type(fieldInput(path), '.');
    // Leaving the field keeps what was typed, with its error.
    expect(fieldInput(path).value).toBe('.');
    expect(container.querySelector(`[data-path="${path}"] .field__message.is-error`)?.textContent).toBe(
      'Enter a number.',
    );

    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(300);
    expect(container.querySelector<HTMLButtonElement>('#tab-results')?.disabled).toBe(true);
    expect(container.querySelector('.workbar__error')?.textContent).toContain('One thing in your plan');

    await type(fieldInput(path), '12');
    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(500);
    expect(container.querySelector('#tab-results')?.getAttribute('aria-selected')).toBe('true');
  });

  // The count in the run bar is of what is on screen: one field with one
  // message is one thing, whatever the plan held before the text went wrong.
  it('counts a field once, however it came to be wrong', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    const path = 'common.events.2.frequency';
    const shown = () =>
      Array.from(container.querySelectorAll(`[data-path="${path}"] .field__message.is-error`), (m) => m.textContent);
    const counted = async () => {
      await act(async () => {
        button('Run Forecast').click();
      });
      await settle(100);
      return container.querySelector('.workbar__error strong')?.textContent;
    };

    for (const [text, message] of [
      ['-1', 'The frequency must be a whole number of months, 1 or more.'],
      ['.', 'Enter a number.'],
      ['.3', 'This must be a whole number.'],
      ['-', 'Enter a number.'],
    ] as const) {
      await type(fieldInput(path), text);
      expect(shown(), text).toEqual([message]);
      expect(await counted(), text).toBe('One thing in your plan needs fixing before the forecast can run.');
    }
  });

  // Adding a row moves every field after it to a new place in the plan. A
  // field's own error has to move with the field, not be dropped on the way.
  it('keeps refusing to run after rows move while two fields hold text that is not a number', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    await type(fieldInput('common.events.1.amount'), '-');
    await type(fieldInput('common.events.2.amount'), '-');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Duplicate Take-home pay"]')!.click();
    });
    await settle(50);
    expect(fieldInput('common.events.2.amount').value).toBe('-');
    expect(fieldInput('common.events.3.amount').value).toBe('-');

    // Whichever of the two is put right, the other still stops the run.
    for (const [fixed, restored] of [
      ['common.events.3.amount', '-1200'],
      ['common.events.2.amount', '-3400'],
    ] as const) {
      await type(fieldInput(fixed), restored);
      await act(async () => {
        button('Run Forecast').click();
      });
      await settle(300);
      expect(container.querySelector<HTMLButtonElement>('#tab-results')?.disabled, fixed).toBe(true);
      expect(container.querySelector('.workbar__error strong')?.textContent, fixed).toBe(
        'One thing in your plan needs fixing before the forecast can run.',
      );
      await type(fieldInput(fixed), '-');
    }
  });

  it('will not download a plan other than the one on screen, even right after a run', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();
    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(500);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('#tab-workspace')!.click();
    });
    await type(fieldInput('simulation.startingCash'), '-');

    const created = URL.createObjectURL;
    let downloads = 0;
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      downloads += 1;
      return created ? created.call(URL, blob) : 'blob:test';
    };
    try {
      await act(async () => {
        button('Download Config').click();
      });
      await settle(300);
    } finally {
      URL.createObjectURL = created;
    }
    expect(downloads).toBe(0);
    expect(container.querySelector('.toolbar__error')?.textContent).toBe(
      'One thing in your plan needs fixing before it can be downloaded.',
    );
  });

  it('says why a file was not loaded beside the upload control, once', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle();

    const upload = async (text: string) => {
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'plan.yaml')] });
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await settle(100);
    };

    await upload('');
    await upload('');
    const errors = container.querySelectorAll('.toolbar .toolbar__error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.getAttribute('role')).toBe('alert');
    expect(errors[0]!.textContent).toBe('plan.yaml was not loaded. That file is empty.');

    // A file that loads replaces the complaint with what happened.
    await upload('version: 2\nsimulation: {startDate: 2025-01, endDate: 2030-01, startingCash: 5}\nscenarios: [{name: only}]\n');
    expect(container.querySelector('.toolbar__error')).toBeNull();
    expect(container.querySelector('.toolbar__status')?.textContent).toBe('Loaded plan.yaml into the editor.');
    expect(container.querySelector('.notices')).toBeNull();
  });

  it('says so when the browser will not save the plan', async () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    try {
      await act(async () => {
        render(<App />, container);
      });
      await settle(600);
      expect(container.querySelector('.banner--warn')?.textContent).toContain('This browser is not saving your plan');
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
  // The guard for "every error has a field": whatever the editor can build,
  // the engine's complaint about it lands on a control. An error with nowhere
  // to appear is written out in the run bar, and this plan must leave none.
  it('places every error the editor can produce under a control', async () => {
    const config = starterConfig();
    config.simulation.cashInterestRate = -1;
    config.simulation.emergencyFundMonths = -1;
    config.simulation.inflationRate = -100;
    const car = config.common.loans[0]!;
    car.extraPrincipalPayments = [{ ...emptyEvent(), amount: -5, frequency: 0, growth: { mode: 'rate', rate: -100 } }];
    car.escrowGrowth = { mode: 'nope', rate: null };
    car.mortgageInsuranceCutoff = 101;
    config.common.loans.push({ ...emptyLoan(), downPayment: -1, escrow: -1, earlyPayoffDate: 'soon' });
    const fund = config.common.investments[0]!;
    fund.taxRate = 100;
    fund.withdrawalTaxRate = -1;
    fund.startingValue = -1;
    fund.contributions = [{ ...emptyEvent(), amount: 0, growth: { mode: 'quickly', rate: null } }];
    fund.withdrawals = [{ ...emptyEvent() }, { ...emptyEvent(), amount: 5, growth: { mode: 'rate', rate: -200 } }];
    config.common.investments.push({ ...emptyInvestment(), name: fund.name });
    config.common.events.push({ ...emptyEvent(), frequency: 1.5, startDate: '2030-01', endDate: '2029-01' });
    config.common.events.push({ ...emptyEvent(), name: 'Grows', amount: -1, growth: { mode: 'rate', rate: -150 } });
    config.common.events.push({ ...emptyEvent(), name: 'Blank rate', amount: -1, growth: { mode: 'rate', rate: null } });
    // Assets: every rule about one, and the loans secured on them.
    config.common.assets = [
      { ...emptyAsset(), name: 'House', value: 300000, sellDate: '2027-06' },
      { ...emptyAsset(), value: 0, appreciation: { mode: 'rate', rate: -100 }, sellCosts: 100, startDate: 'soon' },
      { ...emptyAsset(), name: 'House', value: 1, sellDate: '2020-01', appreciation: { mode: 'odd', rate: null } },
      { ...emptyAsset(), name: 'Shed', value: 1 },
    ];
    config.common.loans.push({ ...emptyLoan(), name: 'Secured', asset: 'House', principal: 10, interestRate: 1, term: 12, startDate: '2027-06', sellProperty: true, sellPrice: 5, sellCostsNet: 1 });
    config.common.loans.push({ ...emptyLoan(), name: 'Unsecured', asset: 'Yacht', principal: 10, interestRate: 1, term: 12, startDate: '2026-01' });
    config.common.loans.push({ ...emptyLoan(), name: 'On the shed', asset: 'Shed', principal: 10, interestRate: 1, term: 12, startDate: '2026-01' });
    config.guardrails = [
      { ...emptyGuardrail(), amount: 100 },
      { ...emptyGuardrail(), name: 'Twice', amount: 100 },
      { ...emptyGuardrail(), name: 'Twice', kind: '' },
      { ...emptyGuardrail(), name: 'Debt', kind: 'debtFree' },
      { ...emptyGuardrail(), name: 'No loans', kind: 'debtFree', startDate: '2030-01', loans: [] },
      { ...emptyGuardrail(), name: 'Unknown loans', kind: 'debtFree', startDate: '2030-01', loans: ['Yacht', 'Yacht'] },
      { ...emptyGuardrail(), name: 'No accounts', kind: 'lasts' },
      { ...emptyGuardrail(), name: 'Unknown accounts', kind: 'lasts', investments: ['Nowhere', 'Nowhere'], amount: 0 },
      { ...emptyGuardrail(), name: 'Typo', kind: 'cashfloor', amount: 1 },
      { ...emptyGuardrail(), name: 'Floorless' },
      { ...emptyGuardrail(), name: 'Dates', amount: 1, startDate: 'soon', endDate: '2030-13' },
      { ...emptyGuardrail(), name: 'Backwards', amount: 1, startDate: '2040-01', endDate: '2039-01' },
      { ...emptyGuardrail(), name: 'Grows oddly', amount: 1, growth: { mode: 'inflaton', rate: null } },
      { ...emptyGuardrail(), name: 'Shrinks away', kind: 'lasts', investments: [fund.name], amount: 1, growth: { mode: 'rate', rate: -100 } },
    ];

    const stay = emptyOption('Same');
    const move = emptyOption('Same');
    move.events = [{ ...emptyEvent(), name: 'Costs' }];
    move.change.loans = [{ id: newId('cg'), targetId: car.id, targetName: car.name, set: { term: 0, escrowGrowth: { mode: 'rate', rate: -100 } } }];
    const grows = config.common.events.find((e) => e.name === 'Grows')!;
    move.change.events = [{ id: newId('cg'), targetId: grows.id, targetName: grows.name, set: { growth: { mode: 'odd', rate: null } } }];
    const house = config.common.assets[0]!;
    const shed = config.common.assets[3]!;
    move.change.assets = [{ id: newId('cg'), targetId: house.id, targetName: house.name, set: { value: -1, sellCosts: -1 } }];
    move.remove.assets = [{ id: newId('rm'), targetId: shed.id, targetName: shed.name }];
    move.assets = [{ ...emptyAsset(), value: 1 }];
    const home = { ...emptyChoice(''), options: [stay, move] };
    config.choices = [home];

    const [first, second] = config.scenarios;
    second!.name = first!.name;
    first!.select = { [home.id]: move.id };
    second!.assets = [{ ...emptyAsset(), name: 'Boat', value: -1 }];
    first!.events = [
      {
        ...emptyEvent(),
        amount: -100,
        optimize: { field: 'amount', min: 5, max: 1, minDate: '', maxDate: '', tolerance: 0, maxIterations: 0, guardrail: '' },
      },
      {
        ...emptyEvent(),
        amount: -100,
        optimize: { field: 'endDate', min: null, max: null, minDate: '', maxDate: 'x', tolerance: null, maxIterations: null, guardrail: '' },
      },
      {
        ...emptyEvent(),
        amount: -100,
        optimize: { field: 'amount', min: -100, max: 0, minDate: '', maxDate: '', tolerance: null, maxIterations: null, guardrail: 'Nowhere' },
      },
    ];
    seedPlan(config);

    await act(async () => {
      render(<App />, container);
    });
    await settle();
    await act(async () => {
      button('Run Forecast').click();
    });
    await settle(300);

    const bar = container.querySelector('.workbar__error')!;
    const count = Number(/^(\d+) things/.exec(bar.textContent ?? '')?.[1]);
    expect(count).toBeGreaterThanOrEqual(25);
    expect(Array.from(bar.querySelectorAll('li'), (item) => item.textContent)).toEqual([]);
  });
});
