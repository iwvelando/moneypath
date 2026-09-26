import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { EmptyChartSketch } from '../components/icons';
import { formatMoney, formatMoneyShort } from '../util/format';
import {
  areaPolygon,
  extentOf,
  indexFromPosition,
  dateTickLimit,
  indexTicks,
  negativeSpans,
  normalize,
  segments,
  spreadLabels,
  valueScale,
  type Series,
} from './chartScale';

// The right pad leaves room for the end-of-line value labels.
const PAD = { top: 18, right: 64, bottom: 34, left: 72 };
const HEIGHT = 340;
const LABEL_GAP = 15;

interface ChartProps {
  dates: string[];
  liquid: Series;
  total: Series;
  scenarioName: string;
}

/**
 * Inline SVG line chart: Liquid and Total series, legend, hover/focus
 * tooltip, both axes ticked, tinted regions where a series is negative,
 * responsive, with an empty state. No charting library.
 */
export function Chart({ dates, liquid, total, scenarioName }: ChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const titleId = useId();

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const measure = () => setWidth(Math.max(320, element.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const count = dates.length;
  const extent = useMemo(() => extentOf([liquid, total]), [liquid, total]);
  const scale = useMemo(() => (extent ? valueScale(extent) : null), [extent]);

  const plotWidth = Math.max(1, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);
  const y = (value: number) =>
    scale ? PAD.top + (1 - normalize(value, scale.domain)) * plotHeight : PAD.top;

  const active = hovered ?? focused;

  if (count === 0 || !scale) {
    return (
      <div class="chart chart--empty" ref={containerRef}>
        <EmptyChartSketch />
        <p class="empty">No data to chart for this scenario yet.</p>
      </div>
    );
  }

  const seriesSpec = [
    { key: 'liquid' as const, label: 'Liquid', values: liquid, className: 'chart__line--liquid' },
    { key: 'total' as const, label: 'Total', values: total, className: 'chart__line--total' },
  ];

  const activeDate = active !== null ? (dates[active] ?? '') : '';
  const activeLiquid = active !== null ? (liquid[active] ?? null) : null;
  const activeTotal = active !== null ? (total[active] ?? null) : null;

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

  const move = (delta: number) => {
    setFocused((current) => {
      const base = current ?? 0;
      return Math.min(count - 1, Math.max(0, base + delta));
    });
  };

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
          tabIndex={0}
          onFocus={() => setFocused((current) => current ?? 0)}
          onBlur={() => setFocused(null)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              move(1);
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              move(-1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              setFocused(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setFocused(count - 1);
            } else if (event.key === 'Escape') {
              setFocused(null);
            }
          }}
          onPointerMove={(event) => {
            const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
            const scaleX = rect.width === 0 ? 1 : width / rect.width;
            const localX = (event.clientX - rect.left) * scaleX - PAD.left;
            setHovered(indexFromPosition(localX, plotWidth, count));
          }}
          onPointerLeave={() => setHovered(null)}
        >
          <title id={titleId}>
            {`Liquid and total net worth for ${scenarioName}, ${dates[0]} to ${dates[count - 1]}. Use the arrow keys to read individual months.`}
          </title>

          <defs>
            {seriesSpec.map((series) => (
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
            {seriesSpec.map((series) =>
              negativeSpans(series.values).map((span, index) => (
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

          <g class="chart__grid" aria-hidden="true">
            {scale.ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
                <text class="chart__tick" x={PAD.left - 10} y={y(tick)} text-anchor="end" dy="0.32em">
                  {formatMoneyShort(tick)}
                </text>
              </g>
            ))}
            {scale.domain.min < 0 && scale.domain.max > 0 ? (
              <line class="chart__zero" x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} />
            ) : null}
          </g>

          <g class="chart__axis" aria-hidden="true">
            {indexTicks(count, dateTickLimit(plotWidth)).map((index) => (
              <text key={index} class="chart__tick" x={x(index)} y={HEIGHT - 12} text-anchor="middle">
                {dates[index]}
              </text>
            ))}
          </g>

          <g aria-hidden="true">
            {seriesSpec.map((series) =>
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
              {activeLiquid !== null ? (
                <circle class="chart__dot chart__dot--liquid" cx={x(active)} cy={y(activeLiquid)} r={4} />
              ) : null}
              {activeTotal !== null ? (
                <circle class="chart__dot chart__dot--total" cx={x(active)} cy={y(activeTotal)} r={4} />
              ) : null}
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
            <p>
              <span class="chart__swatch chart__swatch--liquid" aria-hidden="true" /> Liquid{' '}
              <strong>{activeLiquid === null ? '—' : formatMoney(activeLiquid)}</strong>
            </p>
            <p>
              <span class="chart__swatch chart__swatch--total" aria-hidden="true" /> Total{' '}
              <strong>{activeTotal === null ? '—' : formatMoney(activeTotal)}</strong>
            </p>
          </div>
        ) : null}
      </div>

      <p class="visually-hidden" role="status" aria-live="polite">
        {active === null
          ? ''
          : `${activeDate}: liquid ${activeLiquid === null ? 'no value' : formatMoney(activeLiquid)}, total ${
              activeTotal === null ? 'no value' : formatMoney(activeTotal)
            }`}
      </p>
    </div>
  );
}
