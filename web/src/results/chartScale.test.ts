import { describe, expect, it } from 'vitest';
import {
  areaPolygon,
  extentOf,
  indexFromPosition,
  dateTickLimit,
  indexTicks,
  negativeSpans,
  normalize,
  segments,
  sparklinePoints,
  spreadLabels,
  valueScale,
} from './chartScale';

describe('extentOf', () => {
  it('ignores gaps and spans every series', () => {
    expect(extentOf([[1, null, 5], [-3, 2]])).toEqual({ min: -3, max: 5 });
  });

  it('returns null when there is no data at all', () => {
    expect(extentOf([])).toBeNull();
    expect(extentOf([[null, null]])).toBeNull();
  });
});

describe('valueScale', () => {
  it('produces rounded ticks covering the data', () => {
    const scale = valueScale({ min: 1234, max: 87650 });
    expect(scale.domain.min).toBeLessThanOrEqual(0);
    expect(scale.domain.max).toBeGreaterThanOrEqual(87650);
    expect(scale.ticks[0]).toBe(scale.domain.min);
    expect(scale.ticks[scale.ticks.length - 1]).toBe(scale.domain.max);
  });

  it('includes zero when the data is entirely positive', () => {
    expect(valueScale({ min: 500, max: 900 }).domain.min).toBe(0);
  });

  it('includes zero when the data is entirely negative', () => {
    expect(valueScale({ min: -900, max: -500 }).domain.max).toBe(0);
  });

  it('keeps evenly spaced ticks', () => {
    const { ticks } = valueScale({ min: -20000, max: 60000 });
    const step = (ticks[1] as number) - (ticks[0] as number);
    for (let i = 1; i < ticks.length; i += 1) {
      expect((ticks[i] as number) - (ticks[i - 1] as number)).toBeCloseTo(step, 6);
    }
  });

  it('pads a flat series rather than dividing by zero', () => {
    const scale = valueScale({ min: 100, max: 100 });
    expect(scale.domain.max).toBeGreaterThan(scale.domain.min);
    expect(Number.isFinite(normalize(100, scale.domain))).toBe(true);
  });

  it('normalizes within the domain', () => {
    expect(normalize(50, { min: 0, max: 100 })).toBeCloseTo(0.5);
    expect(normalize(5, { min: 5, max: 5 })).toBe(0.5);
  });
});

describe('indexTicks', () => {
  it('always includes the first and last row', () => {
    const ticks = indexTicks(40);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(39);
    expect(ticks.length).toBeLessThanOrEqual(6);
  });

  it('degrades gracefully for tiny or empty series', () => {
    expect(indexTicks(0)).toEqual([]);
    expect(indexTicks(1)).toEqual([0]);
    expect(indexTicks(2)).toEqual([0, 1]);
  });
});

describe('dateTickLimit', () => {
  it('fits as many date labels as the plot has room for, up to six', () => {
    expect(dateTickLimit(1000)).toBe(6);
    // A phone-width plot: six labels would sit 37 px apart and collide;
    // four leave 61 px gaps.
    expect(dateTickLimit(184)).toBe(4);
    // Never fewer than the two ends.
    expect(dateTickLimit(10)).toBe(2);
  });
});

describe('segments', () => {
  it('splits a series at gaps', () => {
    expect(segments([1, 2, null, 4])).toEqual([
      [
        { index: 0, value: 1 },
        { index: 1, value: 2 },
      ],
      [{ index: 3, value: 4 }],
    ]);
  });

  it('returns nothing for an all-gap series', () => {
    expect(segments([null, null])).toEqual([]);
  });
});

describe('negativeSpans', () => {
  it('finds a fully negative stretch', () => {
    const spans = negativeSpans([5, -5, -5, 5]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.start).toBeCloseTo(0.5);
    expect(spans[0]?.end).toBeCloseTo(2.5);
  });

  it('interpolates the crossing points', () => {
    const spans = negativeSpans([10, -10]);
    expect(spans[0]?.start).toBeCloseTo(0.5);
    expect(spans[0]?.end).toBe(1);
  });

  it('returns nothing when the series never dips below zero', () => {
    expect(negativeSpans([1, 2, 0, 3])).toEqual([]);
  });

  it('handles a span that runs to the end of the series', () => {
    const spans = negativeSpans([1, -1, -2]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.end).toBe(2);
  });

  it('finds multiple separate spans', () => {
    expect(negativeSpans([-1, -1, 1, 1, -1, -1])).toHaveLength(2);
  });
});

describe('areaPolygon', () => {
  it('closes the line down to the baseline, back to the start', () => {
    const points = [
      { x: 10, y: 40 },
      { x: 20, y: 30 },
      { x: 30, y: 50 },
    ];
    expect(areaPolygon(points, 100)).toBe('10,40 20,30 30,50 30,100 10,100');
  });

  it('returns nothing for fewer than two points', () => {
    expect(areaPolygon([], 100)).toBe('');
    expect(areaPolygon([{ x: 5, y: 5 }], 100)).toBe('');
  });
});

describe('spreadLabels', () => {
  it('leaves labels alone when they already clear the gap', () => {
    expect(spreadLabels([10, 40], 12, 0, 100)).toEqual([10, 40]);
  });

  it('pushes overlapping labels apart symmetrically, preserving order', () => {
    expect(spreadLabels([50, 54], 12, 0, 100)).toEqual([46, 58]);
  });

  it('clamps to the bounds and keeps the gap by shifting the run', () => {
    expect(spreadLabels([2, 4], 12, 0, 100)).toEqual([0, 12]);
    expect(spreadLabels([97, 99], 12, 0, 100)).toEqual([88, 100]);
  });

  it('handles a single label by clamping only', () => {
    expect(spreadLabels([-5], 12, 0, 100)).toEqual([0]);
  });
});

describe('sparklinePoints', () => {
  it('maps a rising series to descending y across the width', () => {
    expect(sparklinePoints([0, 5, 10], 40, 10)).toBe('0,10 20,5 40,0');
  });

  it('skips gaps and still spans the width by index', () => {
    expect(sparklinePoints([0, null, 10], 40, 10)).toBe('0,10 40,0');
  });

  it('draws a flat series midway rather than dividing by zero', () => {
    expect(sparklinePoints([3, 3], 40, 10)).toBe('0,5 40,5');
  });

  it('returns nothing without at least two values', () => {
    expect(sparklinePoints([], 40, 10)).toBe('');
    expect(sparklinePoints([null, 7], 40, 10)).toBe('');
  });
});

describe('indexFromPosition', () => {
  it('snaps to the nearest row and clamps to the plot', () => {
    expect(indexFromPosition(0, 100, 11)).toBe(0);
    expect(indexFromPosition(100, 100, 11)).toBe(10);
    expect(indexFromPosition(52, 100, 11)).toBe(5);
    expect(indexFromPosition(-40, 100, 11)).toBe(0);
    expect(indexFromPosition(999, 100, 11)).toBe(10);
  });

  it('is safe for degenerate inputs', () => {
    expect(indexFromPosition(10, 0, 5)).toBe(0);
    expect(indexFromPosition(10, 100, 1)).toBe(0);
  });
});
