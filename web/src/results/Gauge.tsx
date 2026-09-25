import { formatMonths } from '../util/format';
import { gaugeArc, gaugeRatio, gaugeTone } from './gaugeMath';

interface GaugeProps {
  fundedMonths: number;
  targetMonths: number;
}

const CX = 60;
const CY = 58;
const RADIUS = 46;

/**
 * Semicircular emergency-fund gauge: how much of the target the starting
 * liquid already covers. The numbers below the chart remain the readable
 * record; this is the at-a-glance version, so it is labeled as one image.
 */
export function EmergencyFundGauge({ fundedMonths, targetMonths }: GaugeProps) {
  const ratio = gaugeRatio(fundedMonths, targetMonths);
  if (ratio === null) return null;

  const tone = gaugeTone(ratio);
  const percent = Math.round(ratio * 100);
  const label =
    `Emergency fund gauge: ${formatMonths(fundedMonths)} of the ` +
    `${formatMonths(targetMonths)} target covered (${percent} percent).`;

  return (
    <div class="gauge">
      <svg class="gauge__svg" viewBox="0 0 120 64" role="img" aria-label={label}>
        <path class="gauge__track" d={gaugeArc(CX, CY, RADIUS, 1)} />
        {ratio > 0 ? (
          <path class={`gauge__fill gauge__fill--${tone}`} d={gaugeArc(CX, CY, RADIUS, ratio)} />
        ) : null}
        <text class="gauge__value" x={CX} y={CY - 12} text-anchor="middle">
          {percent}%
        </text>
        <text class={`gauge__caption gauge__caption--${tone}`} x={CX} y={CY + 2} text-anchor="middle">
          of target
        </text>
      </svg>
    </div>
  );
}
