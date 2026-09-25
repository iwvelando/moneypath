/**
 * Pure geometry and classification for the emergency-fund gauge: a semicircle
 * swept clockwise from the left end (empty) over the top to the right end
 * (fully funded). No DOM. Unit-tested on its own.
 */

export type GaugeTone = 'ok' | 'warn' | 'danger';

/** Funded share of the target, floored at zero; null without a real target. */
export function gaugeRatio(funded: number, target: number): number | null {
  if (!Number.isFinite(funded) || !Number.isFinite(target) || target <= 0) return null;
  return Math.max(0, funded / target);
}

/** Reading tone: at target is healthy, half-way is a warning, below is not. */
export function gaugeTone(ratio: number): GaugeTone {
  if (ratio >= 1) return 'ok';
  if (ratio >= 0.5) return 'warn';
  return 'danger';
}

/** Point on the semicircle at `fraction` of the sweep (0 = left, 1 = right). */
export function gaugePoint(
  cx: number,
  cy: number,
  radius: number,
  fraction: number,
): { x: number; y: number } {
  const angle = Math.PI * (1 - fraction);
  return { x: cx + radius * Math.cos(angle), y: cy - radius * Math.sin(angle) };
}

/**
 * SVG path for the filled part of the sweep. Fractions above 1 draw the full
 * semicircle; nothing to draw yields an empty path.
 */
export function gaugeArc(cx: number, cy: number, radius: number, fraction: number): string {
  const capped = Math.min(1, Math.max(0, fraction));
  if (capped === 0) return '';
  const from = gaugePoint(cx, cy, radius, 0);
  const to = gaugePoint(cx, cy, radius, capped);
  return `M ${round2(from.x)} ${round2(from.y)} A ${radius} ${radius} 0 0 1 ${round2(to.x)} ${round2(to.y)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
