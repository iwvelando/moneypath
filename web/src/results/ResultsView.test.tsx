import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Adjustment, AdjustmentStatus } from '../config/adjustments';
import { fromConfigDocument } from '../config/serialize';
import type { ConfigModel } from '../config/types';
import type { ForecastResults, OptimizationSummary } from '../engine/types';
import { ResultsView } from './ResultsView';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function summary(extra: Partial<OptimizationSummary> = {}): OptimizationSummary {
  return {
    targetName: 'New expense',
    field: 'amount',
    original: -500,
    value: -184.72,
    originalDisplay: '-$500.00',
    valueDisplay: '-$184.72',
    floor: 6275,
    minimumCash: 6275.04,
    headroom: 0.04,
    iterations: 16,
    converged: true,
    notes: [],
    ...extra,
  };
}

function show(optimizations: OptimizationSummary[], status: AdjustmentStatus): void {
  const results: ForecastResults = {
    version: 'test',
    scenarios: ['plan'],
    rows: [],
    csv: '',
    metrics: [{ optimizations }],
    warnings: [],
    configYaml: '',
  };
  render(
    <ResultsView
      results={results}
      durationMs={1}
      optimizerRan
      onDownloadCsv={() => {}}
      statusOf={(_: Adjustment) => status}
      onApply={() => {}}
    />,
    host,
  );
}

function buttonLabels(): string[] {
  return Array.from(host.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

describe('the optimizer adjustments card', () => {
  it('offers only the per-adjustment button when there is one adjustment to apply', () => {
    show([summary()], 'pending');
    expect(buttonLabels()).toContain('Apply to plan');
    expect(buttonLabels().some((label) => label.startsWith('Apply all'))).toBe(false);
  });

  it('offers to apply them all when there are several', () => {
    show([summary(), summary({ targetName: 'Other' })], 'pending');
    expect(buttonLabels()).toContain('Apply all 2 to plan');
  });

  it('claims no application when the optimizer kept the configured value', () => {
    show([summary({ original: -184.72, originalDisplay: '-$184.72', iterations: 0 })], 'unchanged');
    expect(host.textContent).not.toContain('Applied to your plan');
    expect(host.textContent).toContain('already');
    expect(buttonLabels().some((label) => label.startsWith('Apply'))).toBe(false);
  });
});

function showScenarios(names: string[], plan?: ConfigModel): void {
  const results: ForecastResults = {
    version: 'test',
    scenarios: names,
    rows: ['2026-01', '2026-02'].map((date, row) => ({
      date,
      values: names.map((_, i) => ({ liquid: 100 * (i + 1) + row, total: 1000 * (i + 1) + row, notes: [] })),
    })),
    csv: '',
    metrics: names.map(() => ({ optimizations: [] })),
    warnings: [],
    configYaml: '',
  };
  act(() => {
    render(
      <ResultsView
        results={results}
        durationMs={1}
        optimizerRan={false}
        onDownloadCsv={() => {}}
        statusOf={(_: Adjustment) => 'missing'}
        onApply={() => {}}
        flip={plan ? { plan, run: () => new Promise(() => {}), onKeep: () => true } : undefined}
      />,
      host,
    );
  });
}

function tabs(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]'));
}

function tabNames(): string[] {
  return tabs().map((tab) => tab.textContent?.trim() ?? '');
}

function press(tab: HTMLButtonElement, key: string): void {
  act(() => {
    tab.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('the comparison entry', () => {
  it('is absent when the plan has one scenario', () => {
    showScenarios(['only']);
    expect(tabNames()).toEqual(['only']);
    expect(host.querySelector('.comparison')).toBeNull();
    expect(host.querySelector('.results-table')).not.toBeNull();
  });

  it('follows the scenario tabs and leaves the first scenario selected', () => {
    showScenarios(['a', 'b']);
    expect(tabNames()).toEqual(['a', 'b', 'Compare']);
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(host.querySelector('.comparison')).toBeNull();
  });

  it('shows every scenario on one chart in place of a single scenario', () => {
    showScenarios(['a', 'b']);
    const compare = tabs()[2]!;
    act(() => compare.click());
    expect(compare.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('.comparison')).not.toBeNull();
    expect(host.querySelectorAll('.comparison .chart__line')).toHaveLength(2);
    // The per-scenario parts belong to one scenario and step aside.
    expect(host.querySelector('.results-table')).toBeNull();
    expect(host.querySelector('.summary')).toBeNull();
    const panel = host.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(compare.id);
    expect(compare.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('adds the difference between two scenarios when the engine reports one', () => {
    const results: ForecastResults = {
      version: 'test',
      scenarios: ['a', 'b'],
      rows: [{ date: '2026-01', values: [{ liquid: 1, total: 2 }, { liquid: 1, total: 2 }] }],
      csv: '',
      metrics: [{}, {}],
      comparisons: [
        { scenario: 0, against: 1, cash: { difference: [5], breakEven: [] }, total: { difference: [7], breakEven: [] } },
        { scenario: 1, against: 0, cash: { difference: [-5], breakEven: [] }, total: { difference: [-7], breakEven: [] } },
      ],
      warnings: [],
      configYaml: '',
    };
    act(() => {
      render(
        <ResultsView
          results={results}
          durationMs={1}
          optimizerRan={false}
          onDownloadCsv={() => {}}
          statusOf={(_: Adjustment) => 'missing'}
          onApply={() => {}}
        />,
        host,
      );
    });
    // It belongs to the comparison, not to any one scenario.
    expect(host.querySelector('.difference')).toBeNull();
    act(() => tabs()[2]!.click());
    expect(host.querySelector('[role="tabpanel"] .difference')).not.toBeNull();
    act(() => tabs()[0]!.click());
    expect(host.querySelector('.difference')).toBeNull();
  });

  it('returns to a scenario from the comparison', () => {
    showScenarios(['a', 'b']);
    act(() => tabs()[2]!.click());
    act(() => tabs()[1]!.click());
    expect(host.querySelector('.comparison')).toBeNull();
    expect(host.querySelector('.results-table')).not.toBeNull();
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
  });

  it('moves focus with the selection when the arrow keys walk the tabs', () => {
    showScenarios(['a', 'b']);
    tabs()[0]!.focus();
    press(tabs()[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(tabs()[1]);
    press(tabs()[1]!, 'ArrowRight');
    expect(document.activeElement).toBe(tabs()[2]);
    expect(tabs()[2]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
    press(tabs()[2]!, 'ArrowRight');
    expect(document.activeElement).toBe(tabs()[0]);
    press(tabs()[0]!, 'ArrowLeft');
    expect(document.activeElement).toBe(tabs()[2]);
  });

  it('opens a scenario from its row in the key figures, taking focus to its tab', () => {
    showScenarios(['a', 'b', 'c']);
    act(() => tabs()[3]!.click());
    const open = host.querySelectorAll<HTMLButtonElement>('.comparison tbody th button')[1]!;
    // A click no pointer press counted: the keyboard.
    act(() => {
      open.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    });
    expect(host.querySelector('.comparison')).toBeNull();
    expect(host.querySelector('.results-table')).not.toBeNull();
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false']);
    expect(document.activeElement).toBe(tabs()[1]);
    // Reached from the keyboard, the tab shows its focus ring as usual.
    expect(tabs()[1]!.classList.contains('is-focus-quiet')).toBe(false);
  });

  it('draws no focus ring on the tab when a tap or click opened the scenario', () => {
    showScenarios(['a', 'b']);
    act(() => tabs()[2]!.click());
    const open = host.querySelectorAll<HTMLButtonElement>('.comparison tbody th button')[1]!;
    act(() => {
      open.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs()[1]!.classList.contains('is-focus-quiet')).toBe(true);
    // The ring comes back once focus has left and returned.
    act(() => tabs()[1]!.blur());
    act(() => tabs()[1]!.focus());
    expect(tabs()[1]!.classList.contains('is-focus-quiet')).toBe(false);
  });

  it('falls back to the first scenario when a new run has only one', () => {
    showScenarios(['a', 'b']);
    act(() => tabs()[2]!.click());
    showScenarios(['a']);
    expect(tabNames()).toEqual(['a']);
    expect(host.querySelector('.comparison')).toBeNull();
    expect(host.querySelector('.results-table')).not.toBeNull();
  });
});

describe('flipping one choice from a scenario', () => {
  const plan = (scenarios: Record<string, unknown>[], options = ['Stay', 'Move']) =>
    fromConfigDocument({
      version: 2,
      simulation: { endDate: '2030-01' },
      choices: [{ name: 'Home', options: options.map((name) => ({ name })) }],
      scenarios,
    });
  const flipHeading = () =>
    [...host.querySelectorAll('h3')].find((h) => h.textContent?.trim() === 'Flip one choice') ?? null;

  it('is offered on the scenario’s own tab, even for a plan with one scenario', () => {
    showScenarios(['only'], plan([{ name: 'only', select: { Home: 'Stay' } }]));
    expect(tabNames()).toEqual(['only']);
    expect(flipHeading()).not.toBeNull();
    expect(host.querySelector('.flip')?.textContent).toContain('Instead of Stay');
  });

  it('follows the scenario whose tab is open, and stays out of the comparison', () => {
    showScenarios(
      ['a', 'b'],
      plan([
        { name: 'a', select: { Home: 'Stay' } },
        { name: 'parked', active: false, select: { Home: 'Stay' } },
        { name: 'b', select: { Home: 'Move' } },
      ]),
    );
    expect(host.querySelector('.flip')?.textContent).toContain('Instead of Stay');
    act(() => tabs()[1]!.click());
    expect(host.querySelector('.flip')?.textContent).toContain('Instead of Move');
    act(() => tabs()[2]!.click());
    expect(flipHeading()).toBeNull();
  });

  it('is absent when no choice has another option, and when the plan has no choices', () => {
    showScenarios(['only'], plan([{ name: 'only', select: { Home: 'Stay' } }], ['Stay']));
    expect(flipHeading()).toBeNull();
    showScenarios(['only'], fromConfigDocument({ version: 2, simulation: { endDate: '2030-01' }, scenarios: [{ name: 'only' }] }));
    expect(flipHeading()).toBeNull();
    showScenarios(['only']);
    expect(flipHeading()).toBeNull();
  });
});
