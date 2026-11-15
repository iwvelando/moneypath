import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatMoneyShort } from '../util/format';
import { dateTickLimit, indexFromPosition, indexTicks, normalize, type Scale } from './chartScale';

/** What the per-scenario chart and the comparison chart have in common. */

export const CHART_HEIGHT = 340;

export interface Pad {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Plot {
  width: number;
  height: number;
  pad: Pad;
  plotWidth: number;
  plotHeight: number;
  x: (index: number) => number;
  y: (value: number) => number;
}

/** The drawing width of a chart, following its container; never under 320. */
export function useChartWidth(): { containerRef: RefObject<HTMLDivElement | null>; width: number } {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);

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

  return { containerRef, width };
}

/** Coordinates for `count` months and a value scale inside a padded frame. */
export function plotOf(width: number, pad: Pad, count: number, scale: Scale | null): Plot {
  const plotWidth = Math.max(1, width - pad.left - pad.right);
  const plotHeight = CHART_HEIGHT - pad.top - pad.bottom;
  return {
    width,
    height: CHART_HEIGHT,
    pad,
    plotWidth,
    plotHeight,
    x: (index) => pad.left + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth),
    y: (value) => (scale ? pad.top + (1 - normalize(value, scale.domain)) * plotHeight : pad.top),
  };
}

interface CursorHandlers {
  tabindex: number;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerLeave: (event: PointerEvent) => void;
}

/**
 * The month a reader is pointing at: under the mouse, under a tap or a finger
 * dragged along the chart, or chosen with the arrow keys once the chart has
 * focus. A mouse lets go when it leaves; a touch ends as soon as the finger
 * lifts, so its month stays until the next tap outside the chart. Spread
 * `handlers` onto the chart's svg.
 */
export function useMonthCursor(
  count: number,
  plot: Plot,
): { active: number | null; handlers: CursorHandlers } {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!pinned) return undefined;
    const release = (event: Event) => {
      if (svgRef.current?.contains(event.target as Node)) return;
      setPinned(false);
      setHovered(null);
    };
    document.addEventListener('pointerdown', release);
    return () => document.removeEventListener('pointerdown', release);
  }, [pinned]);

  const move = (delta: number) => {
    setFocused((current) => Math.min(count - 1, Math.max(0, (current ?? 0) + delta)));
  };

  const point = (event: PointerEvent) => {
    const svg = event.currentTarget as SVGSVGElement;
    svgRef.current = svg;
    setPinned(event.pointerType !== 'mouse');
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width === 0 ? 1 : plot.width / rect.width;
    const localX = (event.clientX - rect.left) * scaleX - plot.pad.left;
    setHovered(indexFromPosition(localX, plot.plotWidth, count));
  };

  const active = hovered ?? focused;
  return {
    active: active !== null && active < count ? active : null,
    handlers: {
      // Lowercase on purpose: an svg keeps the attribute's case, and Safari only
      // makes the chart focusable when it is spelled this way.
      tabindex: 0,
      onFocus: () => setFocused((current) => current ?? 0),
      onBlur: () => setFocused(null),
      onKeyDown: (event: KeyboardEvent) => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Escape'].includes(event.key)) return;
        // The latest input owns the readout, even while a mouse stays over the chart.
        setHovered(null);
        setPinned(false);
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
      },
      onPointerDown: point,
      onPointerMove: point,
      onPointerLeave: (event: PointerEvent) => {
        if (event.pointerType === 'mouse') setHovered(null);
      },
    },
  };
}

interface ChartAxesProps {
  plot: Plot;
  scale: Scale;
  dates: string[];
}

/** Value grid with its tick labels, the zero baseline, and the date axis. */
export function ChartAxes({ plot, scale, dates }: ChartAxesProps) {
  const { pad, width, x, y } = plot;
  return (
    <>
      <g class="chart__grid" aria-hidden="true">
        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text class="chart__tick" x={pad.left - 10} y={y(tick)} text-anchor="end" dy="0.32em">
              {formatMoneyShort(tick)}
            </text>
          </g>
        ))}
        {scale.domain.min < 0 && scale.domain.max > 0 ? (
          <line class="chart__zero" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
        ) : null}
      </g>

      <g class="chart__axis" aria-hidden="true">
        {indexTicks(dates.length, dateTickLimit(plot.plotWidth)).map((index) => (
          <text key={index} class="chart__tick" x={x(index)} y={plot.height - 12} text-anchor="middle">
            {dates[index]}
          </text>
        ))}
      </g>
    </>
  );
}
