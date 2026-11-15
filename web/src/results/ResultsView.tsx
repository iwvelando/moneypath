import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Adjustment, AdjustmentStatus } from '../config/adjustments';
import type { ForecastResults, ScenarioMetrics } from '../engine/types';
import { formatDuration, formatMoney, formatMonths } from '../util/format';
import { Chart } from './Chart';
import { Comparison } from './Comparison';
import { MonthlyTable, type MonthlyRow } from './MonthlyTable';
import { EmergencyFundGauge } from './Gauge';
import { OverlaySparkline, Sparkline } from './Sparkline';

interface ResultsViewProps {
  results: ForecastResults;
  durationMs: number;
  optimizerRan: boolean;
  onDownloadCsv: () => void;
  /** Whether the plan already carries each reported adjustment. */
  statusOf: (adjustment: Adjustment) => AdjustmentStatus;
  onApply: (adjustments: Adjustment[]) => void;
}

interface SummaryPanelProps {
  metrics: ScenarioMetrics | undefined;
  scenarioName: string;
  statusOf: (adjustment: Adjustment) => AdjustmentStatus;
  onApply: (adjustments: Adjustment[]) => void;
}

function SummaryPanel({ metrics, scenarioName, statusOf, onApply }: SummaryPanelProps) {
  const fund = metrics?.emergencyFund ?? null;
  const optimizations = metrics?.optimizations ?? [];

  // A target the optimizer could not improve has nothing to apply.
  const pending = optimizations
    .map((summary, ordinal): Adjustment => ({ scenarioName, ordinal, summary }))
    .filter(
      (adjustment) => adjustment.summary.converged && statusOf(adjustment) === 'pending',
    );

  return (
    <div class="summary">
      <div class="summary__card">
        <h4>Emergency fund</h4>
        {fund && fund.targetMonths > 0 ? (
          <div class="summary__fund">
            <EmergencyFundGauge fundedMonths={fund.fundedMonths} targetMonths={fund.targetMonths} />
            <dl class="stat-list">
            <div>
              <dt>Target ({fund.targetMonths.toFixed(1)} months)</dt>
              <dd>{formatMoney(fund.targetAmount)}</dd>
            </div>
            <div>
              <dt>Average monthly expenses</dt>
              <dd>{formatMoney(fund.averageMonthlyExpenses)}</dd>
            </div>
            <div>
              <dt>Starting liquid</dt>
              <dd>{formatMoney(fund.initialLiquid)}</dd>
            </div>
            <div>
              <dt>Starting coverage</dt>
              <dd>{fund.fundedMonths > 0 ? formatMonths(fund.fundedMonths) : '—'}</dd>
            </div>
            {fund.shortfall > 0 ? (
              <div>
                <dt>Shortfall</dt>
                <dd class="is-negative">{formatMoney(fund.shortfall)}</dd>
              </div>
            ) : null}
            {fund.surplus > 0 ? (
              <div>
                <dt>Surplus</dt>
                <dd class="is-positive">{formatMoney(fund.surplus)}</dd>
              </div>
            ) : null}
            </dl>
          </div>
        ) : (
          <p class="empty">The emergency-fund recommendation is disabled for this run.</p>
        )}
      </div>

      {optimizations.length > 0 ? (
        <div class="summary__card">
          <h4>Optimizer adjustments</h4>
          <ul class="adjustments">
            {optimizations.map((summary, index) => {
              const adjustment: Adjustment = { scenarioName, ordinal: index, summary };
              const status = summary.converged ? statusOf(adjustment) : 'missing';
              return (
              <li key={`${summary.targetName}-${summary.field}-${index}`}>
                <p class="adjustments__head">
                  <strong>{summary.targetName}</strong> <span class="tag">{summary.field}</span>
                </p>
                <p class="adjustments__change">
                  {status === 'unchanged' ? (
                    <>
                      <strong>{summary.valueDisplay}</strong> — your configured value already works,
                      so there is nothing to change.
                    </>
                  ) : (
                    <>
                      {summary.originalDisplay} <span aria-hidden="true">→</span>{' '}
                      <span class="visually-hidden">changed to</span>{' '}
                      <strong>{summary.valueDisplay}</strong>
                    </>
                  )}
                </p>
                <p class="adjustments__meta">
                  floor {formatMoney(summary.floor)} · min cash {formatMoney(summary.minimumCash)} ·
                  headroom {formatMoney(summary.headroom)} · {summary.iterations} iteration
                  {summary.iterations === 1 ? '' : 's'} ·{' '}
                  <span class={summary.converged ? 'is-positive' : 'is-negative'}>
                    {summary.converged ? 'converged' : 'not converged'}
                  </span>
                </p>
                {(summary.notes ?? []).length > 0 ? (
                  <ul class="adjustments__notes">
                    {(summary.notes ?? []).map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
                {status === 'pending' ? (
                  <p class="adjustments__apply">
                    <button type="button" class="btn btn--small" onClick={() => onApply([adjustment])}>
                      Apply to plan
                    </button>
                  </p>
                ) : null}
                {status === 'applied' ? (
                  <p class="adjustments__applied">Applied to your plan.</p>
                ) : null}
              </li>
              );
            })}
          </ul>
          {/* With one adjustment, its own button already does this. */}
          {pending.length > 1 ? (
            <p class="adjustments__all">
              <button type="button" class="btn btn--small" onClick={() => onApply(pending)}>
                Apply all {pending.length} to plan
              </button>
            </p>
          ) : null}
          <p class="adjustments__note">
            {pending.length > 0
              ? `Your plan keeps the values you configured until you apply ${pending.length === 1 ? 'it' : 'them'}.`
              : 'Running the forecast never changes your plan on its own.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function ResultsView({
  results,
  durationMs,
  optimizerRan,
  onDownloadCsv,
  statusOf,
  onApply,
}: ResultsViewProps) {
  // A scenario's position, or the comparison of all of them.
  const [selected, setSelected] = useState<number | 'compare'>(0);
  const canCompare = results.scenarios.length > 1;
  const comparing = selected === 'compare' && canCompare;
  const index = typeof selected === 'number' && selected < results.scenarios.length ? selected : 0;

  useEffect(() => {
    if (!comparing && selected !== index) setSelected(0);
  }, [comparing, selected, index]);

  const tabKeys: (number | 'compare')[] = [
    ...results.scenarios.map((_, i) => i),
    ...(canCompare ? ['compare' as const] : []),
  ];
  const current = comparing ? 'compare' : index;
  const tabId = (key: number | 'compare') => `scenario-tab-${key}`;

  // Arrow keys take the focus along, so a second press continues from the new tab.
  const stepTab = (event: KeyboardEvent, from: number | 'compare') => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = tabKeys[(tabKeys.indexOf(from) + delta + tabKeys.length) % tabKeys.length] ?? 0;
    setSelected(next);
    const tab = document.getElementById(tabId(next));
    tab?.focus();
    // Focus alone leaves a tab where it is when a sliver of it already shows.
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  // A tab that is only partly showing in the scrolling row comes fully into it.
  const choose = (event: MouseEvent, key: number | 'compare') => {
    setSelected(key);
    (event.currentTarget as HTMLElement).scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const scenarioName = results.scenarios[index] ?? '';

  // One Total series per scenario, for the sparkline in each tab.
  const scenarioTotals = useMemo(
    () =>
      results.scenarios.map((_, i) =>
        results.rows.map((row) => row.values[i]?.total ?? null),
      ),
    [results.scenarios, results.rows],
  );

  const { dates, liquid, total, rows } = useMemo(() => {
    const d: string[] = [];
    const l: (number | null)[] = [];
    const t: (number | null)[] = [];
    const r: MonthlyRow[] = [];
    for (const row of results.rows) {
      const value = row.values[index] ?? null;
      d.push(row.date);
      l.push(value?.liquid ?? null);
      t.push(value?.total ?? null);
      r.push({
        date: row.date,
        liquid: value?.liquid ?? null,
        total: value?.total ?? null,
        notes: value?.notes ?? [],
      });
    }
    return { dates: d, liquid: l, total: t, rows: r };
  }, [results.rows, index]);

  return (
    <div class="results">
      <div class="results__head">
        <div class="tablist" role="tablist" aria-label="Scenarios">
          {results.scenarios.map((name, i) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={tabId(i)}
              aria-selected={i === current}
              aria-controls="scenario-panel"
              tabIndex={i === current ? 0 : -1}
              class={i === current ? 'tablist__tab is-active' : 'tablist__tab'}
              onClick={(event) => choose(event, i)}
              onKeyDown={(event) => stepTab(event, i)}
            >
              {name}
              <Sparkline series={scenarioTotals[i] ?? []} />
            </button>
          ))}
          {canCompare ? (
            <button
              type="button"
              role="tab"
              id={tabId('compare')}
              aria-selected={comparing}
              aria-controls="scenario-panel"
              tabIndex={comparing ? 0 : -1}
              class={comparing ? 'tablist__tab tablist__tab--compare is-active' : 'tablist__tab tablist__tab--compare'}
              onClick={(event) => choose(event, 'compare')}
              onKeyDown={(event) => stepTab(event, 'compare')}
            >
              Compare
              <OverlaySparkline series={scenarioTotals} />
            </button>
          ) : null}
        </div>
        <div class="results__actions">
          <span class="results__meta">
            Ran in {formatDuration(durationMs)}
            {optimizerRan ? ' · optimizer on' : ''}
          </span>
          <button type="button" class="btn btn--primary" onClick={onDownloadCsv}>
            Download CSV
          </button>
        </div>
      </div>

      <div id="scenario-panel" role="tabpanel" aria-labelledby={tabId(current)} tabIndex={0}>
        {comparing ? (
          <div class="results__projection results__comparison">
            <Comparison results={results} />
          </div>
        ) : (
          <>
        <div class="results__overview">
          <div class="results__projection">
            <div class="results__section-heading">
              <h3>Net worth over time</h3>
            </div>
            <Chart dates={dates} liquid={liquid} total={total} scenarioName={scenarioName} />
          </div>
          <SummaryPanel
            metrics={results.metrics[index]}
            scenarioName={scenarioName}
            statusOf={statusOf}
            onApply={onApply}
          />
        </div>

        <div class="results__section-heading">
          <h3>Month by month</h3>
          <p>The numbers behind your path.</p>
        </div>
        <MonthlyTable key={scenarioName} rows={rows} scenarioName={scenarioName} />
          </>
        )}
      </div>
    </div>
  );
}
