import { describe, expect, it } from 'vitest';
import { gaugeArc, gaugePoint, gaugeRatio, gaugeTone } from './gaugeMath';

describe('gaugeRatio', () => {
  it('is the funded share of the target', () => {
    expect(gaugeRatio(3, 6)).toBeCloseTo(0.5);
  });

  it('is null without a positive target', () => {
    expect(gaugeRatio(3, 0)).toBeNull();
    expect(gaugeRatio(3, -1)).toBeNull();
  });

  it('never goes below zero', () => {
    expect(gaugeRatio(-2, 6)).toBe(0);
  });
});

describe('gaugeTone', () => {
  it('is ok at or beyond the target', () => {
    expect(gaugeTone(1)).toBe('ok');
    expect(gaugeTone(1.7)).toBe('ok');
  });

  it('is warn from half coverage up to the target', () => {
    expect(gaugeTone(0.5)).toBe('warn');
    expect(gaugeTone(0.99)).toBe('warn');
  });

  it('is danger below half coverage', () => {
    expect(gaugeTone(0)).toBe('danger');
    expect(gaugeTone(0.49)).toBe('danger');
  });
});

describe('gaugePoint', () => {
  it('starts at the left end of the semicircle', () => {
    const p = gaugePoint(60, 60, 50, 0);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(60);
  });

  it('reaches the top at half', () => {
    const p = gaugePoint(60, 60, 50, 0.5);
    expect(p.x).toBeCloseTo(60);
    expect(p.y).toBeCloseTo(10);
  });

  it('ends at the right end when full', () => {
    const p = gaugePoint(60, 60, 50, 1);
    expect(p.x).toBeCloseTo(110);
    expect(p.y).toBeCloseTo(60);
  });
});

describe('gaugeArc', () => {
  it('sweeps clockwise from the left end to the fraction, capped at full', () => {
    expect(gaugeArc(60, 60, 50, 1.4)).toBe(gaugeArc(60, 60, 50, 1));
    expect(gaugeArc(60, 60, 50, 0.5)).toBe('M 10 60 A 50 50 0 0 1 60 10');
  });

  it('is empty when there is nothing to draw', () => {
    expect(gaugeArc(60, 60, 50, 0)).toBe('');
  });
});
