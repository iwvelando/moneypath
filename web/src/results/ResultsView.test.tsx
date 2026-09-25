import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Adjustment, AdjustmentStatus } from '../config/adjustments';
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
