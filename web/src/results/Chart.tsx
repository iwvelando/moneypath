import { useId, useMemo } from 'preact/hooks';
import { EmptyChartSketch } from '../components/icons';
import { HALF_CENT, formatMoney, formatMoneyShort } from '../util/format';
import { CHART_HEIGHT, ChartAxes, plotOf, useChartWidth, useMonthCursor } from './chartParts';
import {
  areaPolygon,
  extentOf,
  negativeSpans,
  segments,
  spreadLabels,
  valueScale,
  type Series,
} from './chartScale';

// The right pad leaves room for the end-of-line value labels.
const PAD = { top: 18, right: 64, bottom: 34, left: 72 };
const HEIGHT = CHART_HEIGHT;
const LABEL_GAP = 15;

interface ChartProps {
  dates: string[];
  liquid: Series;
  total: Series;
  /** A third line, when given. Unlike the others, it is not tinted below zero. */
  netWorth?: Series;
  scenarioName: string;
  /** What the two lines show, for the chart's title; a scenario's net worth unless given. */
  subject?: string;
}

/**
 * Inline SVG line chart: Liquid and Total series, and Net worth when given,
 * legend, hover/focus tooltip, both axes ticked, tinted regions where liquid
 * or total is negative, responsive, with an empty state. No charting library.
 */
export function Chart({ dates, liquid, total, netWorth, scenarioName, subject }: ChartProps) {
  const { containerRef, width } = useChartWidth();
  const titleId = useId();

  const count = dates.length;
  const extent = useMemo(
    () => extentOf(netWorth ? [liquid, total, netWorth] : [liquid, total]),
    [liquid, total, netWorth],
  );
  const scale = useMemo(() => (extent ? valueScale(extent) : null), [extent]);
  const plot = plotOf(width, PAD, count, scale);
  const { plotHeight, x, y } = plot;
  const { active, handlers } = useMonthCursor(count, plot);

  if (count === 0 || !scale) {
    return (
      <div class="chart chart--empty" ref={containerRef}>
        <EmptyChartSketch />
        <p class="empty">No data to chart for this scenario yet.</p>
      </div>
    );
  }

  // Net worth leaves out what a loan bought, so being below zero is no alarm
  // for it: it gets neither the tint nor an area of its own.
  const seriesSpec = [
    { key: 'liquid', label: 'Liquid', values: liquid, className: 'chart__line--liquid', tinted: true },
    { key: 'total', label: 'Total', values: total, className: 'chart__line--total', tinted: true },
    ...(netWorth
      ? [{ key: 'networth', label: 'Net worth', values: netWorth, className: 'chart__line--networth', tinted: false }]
      : []),
  ];
  const tinted = seriesSpec.filter((series) => series.tinted);

  const activeDate = active !== null ? (dates[active] ?? '') : '';
  const at = (values: Series): number | null => (active !== null ? (values[active] ?? null) : null);
  const readout = seriesSpec.map((series) => ({ ...series, value: at(series.values) }));

  // Last present value of each series, labeled at the line's right end. The
  // two labels are nudged apart when the lines finish close together.
  const endLabels = (() => {
    const ends = seriesSpec
      .map((series) => {
        for (let i = series.values.length - 1; i >= 0; i -= 1) {
          const value = series.values[i];
          if (value !== null && value !== undefined && Number.isFinite(value)) {
            return { key: series.key, index: i, value };
          }
        }
        return null;
      })
      .filter((end) => end !== null)
      .sort((a, b) => y(a.value) - y(b.value));
    const laidOut = spreadLabels(
      ends.map((end) => y(end.value)),
      LABEL_GAP,
      PAD.top + 6,
      PAD.top + plotHeight - 2,
    );
    return ends.map((end, i) => ({ ...end, labelY: laidOut[i] ?? y(end.value) }));
  })();

  return (
    <div class="chart" ref={containerRef}>
      <ul class="chart__legend">
        {seriesSpec.map((series) => (
          <li key={series.key}>
            <span class={`chart__swatch chart__swatch--${series.key}`} aria-hidden="true" />
            {series.label}
          </li>
        ))}
        <li>
          <span class="chart__swatch chart__swatch--danger" aria-hidden="true" />
          Below zero
        </li>
      </ul>

      <div class="chart__frame">
        <svg
          class="chart__svg"
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width={width}
          height={HEIGHT}
          role="img"
          aria-labelledby={titleId}
          {...handlers}
        >
          <title id={titleId}>
            {`${netWorth ? 'Liquid, total and net worth' : 'Liquid and total net worth'} ${subject ?? `for ${scenarioName}`}, ${dates[0]} to ${dates[count - 1]}. Use the arrow keys to read individual months.`}
          </title>

          <defs>
            {tinted.map((series) => (
              <linearGradient
                key={series.key}
                id={`${titleId}-grad-${series.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop class={`chart__grad--${series.key}`} offset="0" stop-opacity="0.22" />
                <stop class={`chart__grad--${series.key}`} offset="1" stop-opacity="0.02" />
              </linearGradient>
            ))}
          </defs>

          <g aria-hidden="true">
            {tinted.map((series) =>
              negativeSpans(series.values, HALF_CENT).map((span, index) => (
                <rect
                  key={`${series.key}-danger-${index}`}
                  class="chart__danger"
                  x={x(span.start)}
                  y={PAD.top}
                  width={Math.max(1.5, x(span.end) - x(span.start))}
                  height={plotHeight}
                />
              )),
            )}
          </g>

          <ChartAxes plot={plot} scale={scale} dates={dates} />

          <g aria-hidden="true">
            {tinted.map((series) =>
              segments(series.values).map((segment, index) => (
                <polygon
                  key={`${series.key}-area-${index}`}
                  class="chart__area"
                  fill={`url(#${titleId}-grad-${series.key})`}
                  points={areaPolygon(
                    segment.map((point) => ({ x: x(point.index), y: y(point.value) })),
                    y(Math.max(scale.domain.min, Math.min(scale.domain.max, 0))),
                  )}
                />
              )),
            )}
          </g>

          {seriesSpec.map((series) =>
            segments(series.values).map((segment, index) => (
              <polyline
                key={`${series.key}-${index}`}
                class={`chart__line ${series.className}`}
                points={segment.map((point) => `${x(point.index)},${y(point.value)}`).join(' ')}
              />
            )),
          )}

          <g aria-hidden="true">
            {endLabels.map((end) => (
              <g key={`${end.key}-end`}>
                <circle
                  class={`chart__dot chart__dot--${end.key}`}
                  cx={x(end.index)}
                  cy={y(end.value)}
                  r={3.2}
                />
                <text
                  class={`chart__endlabel chart__endlabel--${end.key}`}
                  x={x(end.index) + 8}
                  y={end.labelY}
                  dy="0.32em"
                >
                  {formatMoneyShort(end.value)}
                </text>
              </g>
            ))}
          </g>

          {active !== null ? (
            <g class="chart__cursor" aria-hidden="true">
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotHeight} />
              {readout.map((series) =>
                series.value !== null ? (
                  <circle
                    key={series.key}
                    class={`chart__dot chart__dot--${series.key}`}
                    cx={x(active)}
                    cy={y(series.value)}
                    r={4}
                  />
                ) : null,
              )}
            </g>
          ) : null}
        </svg>

        {active !== null ? (
          <div
            class="chart__tooltip"
            style={{
              left: `${(x(active) / width) * 100}%`,
              transform: x(active) > width * 0.6 ? 'translateX(-100%) translateX(-12px)' : 'translateX(12px)',
            }}
          >
            <p class="chart__tooltip-date">{activeDate}</p>
            {readout.map((series) => (
              <p key={series.key}>
                <span class={`chart__swatch chart__swatch--${series.key}`} aria-hidden="true" /> {series.label}{' '}
                <strong>{series.value === null ? '—' : formatMoney(series.value)}</strong>
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <p class="visually-hidden" role="status" aria-live="polite">
        {active === null
          ? ''
          : `${activeDate}: ${readout
              .map((series) => `${series.label.toLowerCase()} ${series.value === null ? 'no value' : formatMoney(series.value)}`)
              .join(', ')}`}
      </p>
    </div>
  );
}
