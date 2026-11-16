import { useId, useState } from 'preact/hooks';
import type { BreakEvenMonth, ForecastResults } from '../engine/types';
import { Chart } from './Chart';

interface DifferenceProps {
  results: ForecastResults;
}

interface BreakEvenProps {
  label: string;
  months: BreakEvenMonth[];
  scenarios: string[];
}

export function BreakEven({ label, months, scenarios }: BreakEvenProps) {
  return (
    <div>
      <dt>{label} break-even</dt>
      <dd>
        {months.length === 0 ? (
          'The lead never changes hands.'
        ) : (
          <ul>
            {months.map((month) => (
              <li key={month.date}>
                <strong>{month.date}</strong>: {scenarios[month.leader] ?? ''} moves ahead{' '}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

/**
 * One chosen scenario minus another: the months the lead changes hands and
 * the difference over time. Every figure is the engine's; choosing a pair
 * only selects which of its comparisons to show.
 */
export function Difference({ results }: DifferenceProps) {
  const [pair, setPair] = useState<[number, number]>([0, 1]);
  const base = useId();
  const comparisons = results.comparisons ?? [];
  const count = results.scenarios.length;

  // A new run can have fewer scenarios than the pair that was chosen.
  const [first, second] = pair[0] < count && pair[1] < count ? pair : [0, 1];
  const comparison = comparisons.find((c) => c.scenario === first && c.against === second);
  if (!comparison) return null;

  const firstName = results.scenarios[first] ?? '';
  const secondName = results.scenarios[second] ?? '';

  // Choosing the scenario the other picker holds swaps the two.
  const choose = (side: 0 | 1, scenario: number) => {
    const other = side === 0 ? second : first;
    const kept = scenario === other ? (side === 0 ? first : second) : other;
    setPair(side === 0 ? [scenario, kept] : [kept, scenario]);
  };

  const pickers: { side: 0 | 1; label: string; value: number }[] = [
    { side: 0, label: 'Compare', value: first },
    { side: 1, label: 'against', value: second },
  ];

  return (
    <section class="difference">
      <div class="results__section-heading">
        <h3>Difference between two scenarios</h3>
        <p>One scenario minus the other, month by month.</p>
      </div>
      <div class="results__projection">
        <div class="difference__pickers">
          {pickers.map((picker) => (
            <label key={picker.side} for={`${base}-${picker.side}`}>
              <span>{picker.label}</span>
              <select
                id={`${base}-${picker.side}`}
                class="input"
                value={String(picker.value)}
                onChange={(event) =>
                  choose(picker.side, Number((event.currentTarget as HTMLSelectElement).value))
                }
              >
                {results.scenarios.map((name, i) => (
                  <option key={i} value={String(i)}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <dl class="difference__breakeven">
          <BreakEven label="Total" months={comparison.total.breakEven} scenarios={results.scenarios} />
          <BreakEven label="Liquid" months={comparison.cash.breakEven} scenarios={results.scenarios} />
        </dl>
        <p class="difference__reading">
          Above zero, {firstName} is ahead of {secondName}; below zero, it is behind.
        </p>
        <Chart
          dates={results.rows.map((row) => row.date)}
          liquid={comparison.cash.difference}
          total={comparison.total.difference}
          scenarioName={firstName}
          subject={`of ${firstName} minus ${secondName}`}
        />
      </div>
    </section>
  );
}
