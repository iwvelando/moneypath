import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { starterConfig } from './config/starter';
import { EDITOR_STATE_VERSION, KEYS } from './state/persistence';
import { storageKeys } from './test/setup';

/**
 * A DOM smoke test of the whole app against the mock engine (forced by the
 * `?mockEngine` URL configured for the jsdom environment). It exercises the
 * paths that only break at runtime: first render, autosave, running a
 * forecast, and switching to Results.
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

/**
 * Seed a saved plan whose first scenario carries an optimize block, with the
 * optimizer toggle already on. The mock engine reports its adjustments against
 * the first scenario, so this is the shape that exercises applying them.
 */
function seedPlanWithOptimizer(): void {
  const config = starterConfig();
  const scenario = config.scenarios[0]!;
  scenario.events = [
    {
      id: 'optimized-event',
      name: 'Transition income',
      amount: 1500,
      percentage: null,
      frequency: null,
      startDate: '',
      endDate: '',
      optimize: {
        field: 'amount',
        min: 0,
        max: 5000,
        minDate: '',
        maxDate: '',
        tolerance: null,
        maxIterations: null,
      },
    },
  ];
  window.localStorage.setItem(
    KEYS.editorState,
    JSON.stringify({ version: EDITOR_STATE_VERSION, config }),
  );
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

  it('autosaves editor state to a versioned localStorage key', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await settle(600);
    const keys = storageKeys(window.localStorage).filter((key) => key.startsWith('moneypath.editor.'));
    expect(keys).toHaveLength(1);
  });

  it('runs a forecast and shows chart, summary and table on the Results tab', async () => {
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
    // Engine warnings are shown prominently but never block the run.
    expect(container.querySelector('.banner--warn')).not.toBeNull();

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
    expect(container.querySelector('.workbar .optctl__switch input')).not.toBeNull();
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

    // The error belongs where the run was started: the pinned bar.
    expect(container.querySelector('.workbar__error')?.textContent).toContain('endDate');
    expect(container.querySelector('.toolbar__error')).toBeNull();
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
    expect(savedAmount()).toBe(1500);
    expect(container.textContent).toContain('Your plan keeps the values you configured');
    expect(container.querySelector('.toolbar__hint')).not.toBeNull();

    await act(async () => {
      button('Apply to plan').click();
    });
    await settle(600);

    expect(savedAmount()).toBe(2680.5);
    expect(container.querySelector('.adjustments__applied')?.textContent).toContain(
      'Applied to your plan.',
    );
    // Nothing left to warn about: the download and the plan now agree.
    expect(container.querySelector('.toolbar__hint')).toBeNull();
  });
});
