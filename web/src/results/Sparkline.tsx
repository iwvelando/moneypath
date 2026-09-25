import { useMemo } from 'preact/hooks';
import { sparklinePoints, type Series } from './chartScale';

interface SparklineProps {
  series: Series;
}

const WIDTH = 44;
const HEIGHT = 14;

/**
 * Tiny shape-of-the-outcome line inside a scenario tab. Purely decorative —
 * the tab's name is the accessible content, and the real chart is below.
 */
export function Sparkline({ series }: SparklineProps) {
  const points = useMemo(() => sparklinePoints(series, WIDTH, HEIGHT - 2), [series]);
  if (points === '') return null;
  return (
    <svg
      class="sparkline"
      viewBox={`-1 -2 ${WIDTH + 2} ${HEIGHT + 2}`}
      width={WIDTH}
      height={HEIGHT}
      aria-hidden="true"
    >
      <polyline class="sparkline__line" points={points} />
    </svg>
  );
}
