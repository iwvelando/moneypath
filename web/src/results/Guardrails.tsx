import type { GuardrailResult } from '../engine/types';
import { formatMoney, isNegativeMoney } from '../util/format';
import { ScenarioSample } from './scenarioStyle';

interface Outcome {
  text: string;
  tone: 'is-positive' | 'is-negative' | '';
  detail: string | null;
}

/** How the engine's result for one guardrail on one path reads. Nothing is worked out here. */
export function outcomeOf(result: GuardrailResult): Outcome {
  if (result.result === 'doesNotApply') return { text: 'Does not apply', tone: '', detail: null };
  const text = result.result === 'breaks' ? `Breaks in ${result.firstBreachDate ?? '—'}` : 'Holds';
  const tone = result.result === 'breaks' ? 'is-negative' : 'is-positive';
  let detail: string | null = null;
  if (result.tightestDate !== undefined && result.margin !== undefined) {
    const margin = result.margin;
    const amount =
      formatMoney(Math.abs(margin)) === '$0.00'
        ? 'exactly at the floor'
        : isNegativeMoney(margin)
          ? `${formatMoney(-margin)} short`
          : `${formatMoney(margin)} to spare`;
    detail = `Tightest ${result.tightestDate}, ${amount}`;
  }
  return { text, tone, detail };
}

/** A month is never split at its dash when the text wraps. */
function monthsKept(text: string) {
  return text.split(/(\d{4}-\d{2})/).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} class="guardrails__month">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function OutcomeText({ result }: { result: GuardrailResult }) {
  const outcome = outcomeOf(result);
  return (
    <>
      <span class={`guardrails__outcome ${outcome.tone}`.trim()}>{monthsKept(outcome.text)}</span>
      {outcome.detail ? <span class="guardrails__detail"> {monthsKept(outcome.detail)}</span> : null}
    </>
  );
}

export interface GuardrailPath {
  name: string;
  /** The scenario's position, for its line sample; absent for a path that is not a scenario. */
  scenario?: number;
  guardrails: GuardrailResult[] | null | undefined;
}

interface GuardrailTableProps {
  title: string;
  intro: string;
  /** The header of the column that names each path. */
  pathLabel: string;
  paths: GuardrailPath[];
  /** Nested under another section's heading, as in the flip panel. */
  nested?: boolean;
}

/**
 * One row per path and one column per guardrail, as the engine reported them.
 * Left out when the plan has no guardrails. Like the key figures, its rows
 * stack on a phone, each result under its guardrail's name.
 */
export function GuardrailTable({ title, intro, pathLabel, paths, nested = false }: GuardrailTableProps) {
  const columns = paths.find((path) => (path.guardrails ?? []).length > 0)?.guardrails ?? [];
  if (columns.length === 0) return null;
  return (
    <section class={nested ? 'guardrails guardrails--nested' : 'guardrails'}>
      <div class="results__section-heading">
        {nested ? <h4>{title}</h4> : <h3>{title}</h3>}
        <p>{intro}</p>
      </div>
      <div class="figures__wrap">
        <table class="figures-table guardrails-table" role="table">
          <caption class="visually-hidden">{title}</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">
                {pathLabel}
              </th>
              {columns.map((column, i) => (
                <th key={i} role="columnheader" scope="col">
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {paths.map((path, row) => (
              <tr key={row} role="row" class="figures-table__row">
                <th role="rowheader" scope="row">
                  <span class="figures-table__scenario">
                    {path.scenario !== undefined ? <ScenarioSample index={path.scenario} /> : null}
                    <span>{path.name}</span>
                  </span>
                </th>
                {columns.map((column, i) => {
                  const result = path.guardrails?.[i];
                  return (
                    <td key={i} role="cell">
                      <span class="figures-table__label" aria-hidden="true">
                        {column.name}
                      </span>{' '}
                      {result ? <OutcomeText result={result} /> : <span>—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A scenario's own guardrails, for its summary. */
export function GuardrailList({ guardrails }: { guardrails: GuardrailResult[] }) {
  return (
    <ul class="guardrails__list">
      {guardrails.map((result, i) => (
        <li key={i}>
          <strong class="guardrails__name">{result.name}</strong> <OutcomeText result={result} />
        </li>
      ))}
    </ul>
  );
}
