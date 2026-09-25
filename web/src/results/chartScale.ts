/**
 * Pure scale/geometry math for the inline SVG chart. No DOM, no engine data
 * semantics — just turning arrays of numbers into coordinates, ticks, polyline
 * segments and negative spans. Unit-tested on its own.
 */

export interface Extent {
  min: number;
  max: number;
}

export interface Scale {
  domain: Extent;
  ticks: number[];
}

export interface Span {
  /** Fractional index positions; the caller maps them through the x scale. */
  start: number;
  end: number;
}

export type Series = (number | null)[];

export function extentOf(series: Series[]): Extent | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const values of series) {
    for (const value of values) {
      if (value === null || !Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (min === Number.POSITIVE_INFINITY) return null;
  return { min, max };
}

function niceNum(range: number, round: boolean): number {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let nice: number;
  if (round) {
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
  } else {
    if (fraction <= 1) nice = 1;
    else if (fraction <= 2) nice = 2;
    else if (fraction <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exponent);
}

/**
 * A rounded value axis. The domain always contains the data; zero is included
 * whenever the data straddles it, so the zero baseline and the negative tint
 * line up with the same grid.
 */
export function valueScale(extent: Extent, tickCount = 5): Scale {
  let { min, max } = extent;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { domain: { min: 0, max: 1 }, ticks: [0, 1] };

  if (min > 0 && max > 0) min = Math.min(min, 0);
  if (min < 0 && max < 0) max = Math.max(max, 0);

  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    min -= pad;
    max += pad;
  }

  const count = Math.max(2, tickCount);
  const step = niceNum(niceNum(max - min, false) / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  // Multiply rather than accumulate so float drift cannot shift later ticks.
  const steps = Math.round((niceMax - niceMin) / step);
  for (let i = 0; i <= steps; i += 1) {
    ticks.push(Math.round((niceMin + i * step) * 1e6) / 1e6);
  }

  return { domain: { min: niceMin, max: niceMax }, ticks };
}

/** Map a value into [0, 1] where 0 is the domain minimum. */
export function normalize(value: number, domain: Extent): number {
  const span = domain.max - domain.min;
  if (span === 0) return 0.5;
  return (value - domain.min) / span;
}

/** Evenly spaced row indices for the date axis, always including the ends. */
export function indexTicks(count: number, maxTicks = 6): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const wanted = Math.max(2, Math.min(maxTicks, count));
  const ticks: number[] = [];
  for (let i = 0; i < wanted; i += 1) {
    ticks.push(Math.round((i * (count - 1)) / (wanted - 1)));
  }
  return Array.from(new Set(ticks));
}

/**
 * Contiguous runs of present values. A scenario with no value at a date leaves
 * a gap rather than a straight line through it.
 */
export function segments(series: Series): { index: number; value: number }[][] {
  const out: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  series.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 0) out.push(current);
      current = [];
      return;
    }
    current.push({ index, value });
  });
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Fractional index spans where the series is below zero, with linearly
 * interpolated crossings so the tinted region meets the line exactly at zero.
 */
export function negativeSpans(series: Series): Span[] {
  const spans: Span[] = [];
  let start: number | null = null;

  const at = (i: number): number | null => {
    const value = series[i];
    return value === null || value === undefined || !Number.isFinite(value) ? null : value;
  };

  for (let i = 0; i < series.length; i += 1) {
    const value = at(i);
    const negative = value !== null && value < 0;

    if (negative && start === null) {
      const previous = i > 0 ? at(i - 1) : null;
      if (previous !== null && previous >= 0) {
        const t = previous / (previous - (value as number));
        start = i - 1 + t;
      } else {
        start = i;
      }
    } else if (!negative && start !== null) {
      const previous = at(i - 1);
      if (value !== null && previous !== null && previous < 0) {
        const t = -previous / (value - previous);
        spans.push({ start, end: i - 1 + t });
      } else {
        spans.push({ start, end: i - 1 });
      }
      start = null;
    }
  }

  if (start !== null) spans.push({ start, end: series.length - 1 });
  return spans.filter((span) => span.end > span.start || series.length === 1);
}

/**
 * Close a projected line down to a horizontal baseline so it can be filled as
 * a polygon: the line's points, then straight down and back along the base.
 */
export function areaPolygon(points: { x: number; y: number }[], baseY: number): string {
  if (points.length < 2) return '';
  const line = points.map((point) => `${point.x},${point.y}`);
  const last = points[points.length - 1] as { x: number; y: number };
  const first = points[0] as { x: number; y: number };
  return [...line, `${last.x},${baseY}`, `${first.x},${baseY}`].join(' ');
}

/**
 * Nudge label positions apart until neighbours are at least `minGap` apart,
 * preserving order and staying within [min, max]. Overlapping runs move
 * symmetrically about their midpoint; a run pushed past a bound slides back in.
 */
export function spreadLabels(positions: number[], minGap: number, min: number, max: number): number[] {
  const out = positions.slice();
  // Forward pass opens the gaps; overlapping neighbours split the difference.
  for (let i = 1; i < out.length; i += 1) {
    const overlap = minGap - ((out[i] as number) - (out[i - 1] as number));
    if (overlap > 0) {
      out[i - 1] = (out[i - 1] as number) - overlap / 2;
      out[i] = (out[i] as number) + overlap / 2;
      // Reopening a gap can close the one before it; walk back.
      for (let j = i - 1; j > 0; j -= 1) {
        const gap = (out[j] as number) - (out[j - 1] as number);
        if (gap >= minGap) break;
        out[j - 1] = (out[j] as number) - minGap;
      }
    }
  }
  // Clamp into bounds without collapsing the gaps just opened.
  if (out.length > 0) {
    const low = min - (out[0] as number);
    if (low > 0) for (let i = 0; i < out.length; i += 1) out[i] = (out[i] as number) + low;
    for (let i = 0; i < out.length; i += 1) {
      const prev = i > 0 ? (out[i - 1] as number) + minGap : Number.NEGATIVE_INFINITY;
      out[i] = Math.max(out[i] as number, prev);
    }
    const high = (out[out.length - 1] as number) - max;
    if (high > 0) {
      out[out.length - 1] = max;
      for (let i = out.length - 2; i >= 0; i -= 1) {
        out[i] = Math.min(out[i] as number, (out[i + 1] as number) - minGap);
      }
    }
  }
  return out;
}

/**
 * A whole series compressed into a `width` × `height` polyline points string,
 * for the tiny scenario-tab sparklines. Gaps are skipped; x spacing follows
 * the row index so all scenarios' sparklines share a time axis.
 */
export function sparklinePoints(series: Series, width: number, height: number): string {
  const extent = extentOf([series]);
  if (!extent) return '';
  const count = series.length;
  const points: string[] = [];
  series.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) return;
    const x = count <= 1 ? width / 2 : (index / (count - 1)) * width;
    const y = (1 - normalize(value, extent)) * height;
    points.push(`${round1(x)},${round1(y)}`);
  });
  return points.length < 2 ? '' : points.join(' ');
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Nearest row index for a pointer position along the plot area. */
export function indexFromPosition(x: number, plotWidth: number, count: number): number {
  if (count <= 1) return 0;
  if (plotWidth <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, x / plotWidth));
  return Math.round(ratio * (count - 1));
}
