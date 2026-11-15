/**
 * How many colors and line patterns the stylesheet defines for scenarios.
 * They differ in length so a pattern never repeats with the same color until
 * every combination has been used.
 */
export const SCENARIO_COLORS = 6;
export const SCENARIO_DASHES = 5;

/** The classes that give a scenario's line its color and pattern. */
export function styleOf(index: number): string {
  return `chart__scenario--${index % SCENARIO_COLORS} chart__dash--${index % SCENARIO_DASHES}`;
}

/** The line a scenario is drawn with, as a swatch beside its name. */
export function ScenarioSample({ index }: { index: number }) {
  return (
    <svg class="comparison__sample" viewBox="0 0 28 8" width="28" height="8" aria-hidden="true">
      <line class={`chart__line-sample ${styleOf(index)}`} x1="1" x2="27" y1="4" y2="4" />
    </svg>
  );
}
