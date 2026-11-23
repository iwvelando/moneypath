import { useId, useMemo, useState } from 'preact/hooks';
import { HELP } from '../config/help';
import { EmptyChartSketch } from '../components/icons';
import type { ForecastResults } from '../engine/types';
import { formatMoney, isNegativeMoney } from '../util/format';
import { ChartAxes, plotOf, useChartWidth, useMonthCursor } from './chartParts';
import { extentOf, segments, valueScale, type Series } from './chartScale';
import { GuardrailTable } from './Guardrails';
import { runHasBalance } from './balance';
import { KeyFigures } from './KeyFigures';
import { SCENARIO_COLORS, ScenarioSample, styleOf } from './scenarioStyle';

// No end-of-line labels here: the legend carries each scenario's value. The
// right pad only has to hold half of the last date label.
const PAD = { top: 18, right: 28, bottom: 34, left: 72 };

type SeriesKey = 'total' | 'liquid' | 'netWorth';

const SERIES: { key: SeriesKey; label: string }[] = [
  { key: 'total', label: 'Total' },
  { key: 'liquid', label: 'Liquid' },
  { key: 'netWorth', label: 'Net worth' },
];

interface ComparisonProps {
  results: ForecastResults;
  /** `byPointer` is false when the keyboard chose the scenario. */
  onOpenScenario: (index: number, byPointer: boolean) => void;
}

/**
 * Every scenario of a run on one chart, for one series at a time, above a
 * table of each scenario's key figures. The legend doubles as the readout: it
 * shows each scenario's value for the month under the pointer or keyboard
 * cursor, and for the final month otherwise.
 */
export function Comparison({ results, onOpenScenario }: ComparisonProps) {
  const [chosenKey, setSeriesKey] = useState<SeriesKey>('total');
  // Net worth is offered once something is owed; until then it is the total.
  const owes = useMemo(() => runHasBalance(results), [results]);
  const offered = owes ? SERIES : SERIES.filter((series) => series.key !== 'netWorth');
  const seriesKey = offered.some((series) => series.key === chosenKey) ? chosenKey : 'total';
  const seriesLabel = SERIES.find((series) => series.key === seriesKey)?.label ?? '';

  const dates = useMemo(() => results.rows.map((row) => row.date), [results.rows]);
  const lines = useMemo(
    () =>
      results.scenarios.map((name, i) => ({
        name,
        values: results.rows.map((row) => row.values[i]?.[seriesKey] ?? null) as Series,
      })),
    [results.scenarios, results.rows, seriesKey],
  );

  return (
    <div class="comparison">
      <div class="results__projection results__comparison">
      <div class="results__section-heading comparison__heading">
        <h3>Scenarios side by side</h3>
        <div class="comparison__series" role="group" aria-label="Series to compare">
          {offered.map((series) => (
            <button
              key={series.key}
              type="button"
              class={series.key === seriesKey ? 'comparison__choice is-active' : 'comparison__choice'}
              aria-pressed={series.key === seriesKey}
              onClick={() => setSeriesKey(series.key)}
            >
              {series.label}
            </button>
          ))}
        </div>
      </div>
      {seriesKey === 'netWorth' ? <p class="comparison__about">{HELP.netWorth}</p> : null}
      <ComparisonChart dates={dates} lines={lines} seriesLabel={seriesLabel} />
      </div>
      <KeyFigures results={results} onOpenScenario={onOpenScenario} />
      <GuardrailTable
        title="Guardrails"
        intro="Whether each scenario keeps every guardrail of the plan, the month it first breaks, and the month it comes closest."
        pathLabel="Scenario"
        paths={results.scenarios.map((name, i) => ({ name, scenario: i, guardrails: results.metrics[i]?.guardrails }))}
      />
    </div>
  );
}

interface ComparisonChartProps {
  dates: string[];
  lines: { name: string; values: Series }[];
  seriesLabel: string;
}

function ComparisonChart({ dates, lines, seriesLabel }: ComparisonChartProps) {
  const { containerRef, width } = useChartWidth();
  const titleId = useId();

  const count = dates.length;
  const extent = useMemo(() => extentOf(lines.map((line) => line.values)), [lines]);
  const scale = useMemo(() => (extent ? valueScale(extent) : null), [extent]);
  const plot = plotOf(width, PAD, count, scale);
  const { active, handlers } = useMonthCursor(count, plot);

  if (count === 0 || !scale) {
    return (
      <div class="chart chart--empty" ref={containerRef}>
        <EmptyChartSketch />
        <p class="empty">No data to compare yet.</p>
      </div>
    );
  }

  const { x, y } = plot;
  const shown = active ?? count - 1;
  const shownDate = dates[shown] ?? '';
  const valueAt = (values: Series): number | null => {
    const value = values[shown];
    return value === null || value === undefined || !Number.isFinite(value) ? null : value;
  };

  return (
    <div class="chart" ref={containerRef}>
      <p class="comparison__month">
        {seriesLabel} in <strong>{shownDate}</strong>
        {active === null ? <span class="comparison__hint"> · the final month</span> : null}
      </p>
      <ul class="comparison__legend">
        {lines.map((line, i) => {
          const value = valueAt(line.values);
          return (
            <li key={i}>
              <ScenarioSample index={i} />
              <span class="comparison__name">{line.name}</span>
              <span
                class={
                  value !== null && isNegativeMoney(value)
                    ? 'comparison__value is-negative'
                    : 'comparison__value'
                }
              >
                {value === null ? '—' : formatMoney(value)}
              </span>
            </li>
          );
        })}
      </ul>

      <div class="chart__frame">
        <svg
          class="chart__svg"
          viewBox={`0 0 ${width} ${plot.height}`}
          width={width}
          height={plot.height}
          role="img"
          aria-labelledby={titleId}
          {...handlers}
        >
          <title id={titleId}>
            {`${seriesLabel === 'Net worth' ? seriesLabel : `${seriesLabel} net worth`} for every scenario (${lines
              .map((line) => line.name)
              .join(', ')}), ${dates[0]} to ${dates[count - 1]}. Use the arrow keys to read individual months.`}
          </title>

          <ChartAxes plot={plot} scale={scale} dates={dates} />

          {lines.map((line, i) =>
            segments(line.values).map((segment, part) => segment.length === 1 ? (
              <circle
                key={`${i}-${part}`}
                class={`comparison__point chart__scenario-dot--${i % SCENARIO_COLORS}`}
                cx={x(segment[0]!.index)}
                cy={y(segment[0]!.value)}
                r={3.2}
              />
            ) : (
              <polyline
                key={`${i}-${part}`}
                class={`chart__line ${styleOf(i)}`}
                points={segment.map((point) => `${x(point.index)},${y(point.value)}`).join(' ')}
              />
            )),
          )}

          {active !== null ? (
            <g class="chart__cursor" aria-hidden="true">
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plot.plotHeight} />
              {lines.map((line, i) => {
                const value = valueAt(line.values);
                return value === null ? null : (
                  <circle
                    key={i}
                    class={`chart__dot chart__scenario-dot--${i % SCENARIO_COLORS}`}
                    cx={x(active)}
                    cy={y(value)}
                    r={4}
                  />
                );
              })}
            </g>
          ) : null}
        </svg>
      </div>

      <p class="visually-hidden" role="status" aria-live="polite">
        {active === null
          ? ''
          : `${shownDate}, ${seriesLabel.toLowerCase()}: ${lines
              .map((line) => {
                const value = valueAt(line.values);
                return `${line.name} ${value === null ? 'no value' : formatMoney(value)}`;
              })
              .join(', ')}`}
      </p>
    </div>
  );
}
