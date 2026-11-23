import type { EmergencyFundMetrics, ForecastResults } from '../engine/types';
import { formatMoney, isNegativeMoney } from '../util/format';
import { runOwes } from './balance';
import { ScenarioSample } from './scenarioStyle';

interface KeyFiguresProps {
  results: ForecastResults;
  /** `byPointer` is false when the keyboard chose the scenario. */
  onOpenScenario: (index: number, byPointer: boolean) => void;
}

const COLUMNS = ['Lowest cash', 'Ending cash', 'Ending total'];
const NET_WORTH_COLUMN = 'Ending net worth';
const FUND_COLUMN = 'Emergency fund';

/** The column's name, shown beside the value where the table stacks; the header cell already tells assistive technology. */
function Label({ text }: { text: string }) {
  return (
    <span class="figures-table__label" aria-hidden="true">
      {text}
    </span>
  );
}

function MoneyCell({ label, value, detail }: { label: string; value: number | undefined; detail?: string }) {
  const known = value !== undefined && Number.isFinite(value);
  return (
    <td role="cell" class={known && isNegativeMoney(value) ? 'numeric is-negative' : 'numeric'}>
      <Label text={label} />
      <span class="figures-table__value">{known ? formatMoney(value) : '—'}</span>
      {known && detail ? <span class="figures-table__detail"> {detail}</span> : null}
    </td>
  );
}

function FundCell({ fund }: { fund: EmergencyFundMetrics | null }) {
  let tone = 'numeric';
  let text = '—';
  if (fund) {
    if (fund.shortfall > 0) {
      tone = 'numeric is-negative';
      text = `${formatMoney(fund.shortfall)} short`;
    } else if (fund.surplus > 0) {
      tone = 'numeric is-positive';
      text = `${formatMoney(fund.surplus)} surplus`;
    } else {
      text = 'On target';
    }
  }
  return (
    <td role="cell" class={tone}>
      <Label text={FUND_COLUMN} />
      <span class="figures-table__value">{text}</span>
    </td>
  );
}

/**
 * One row of engine-reported figures per scenario. The roles are spelled out
 * because the stylesheet stacks the rows on a narrow screen, and a table laid
 * out as blocks can otherwise stop being announced as one.
 */
export function KeyFigures({ results, onOpenScenario }: KeyFiguresProps) {
  // The recommendation is on or off for the whole run, so the column is too.
  const showFund = results.metrics.some((metrics) => metrics?.emergencyFund);
  // Until something is owed, net worth is the total.
  const showNetWorth = runOwes(results);

  return (
    <section class="figures">
      <div class="results__section-heading">
        <h3>Key figures</h3>
        <p>Choose a scenario to open its own view.</p>
      </div>
      <div class="figures__wrap">
        <table class="figures-table" role="table">
          <caption class="visually-hidden">Key figures for each scenario</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Scenario</th>
              {COLUMNS.map((column) => (
                <th key={column} role="columnheader" scope="col" class="numeric">
                  {column}
                </th>
              ))}
              {showNetWorth ? (
                <th role="columnheader" scope="col" class="numeric">
                  {NET_WORTH_COLUMN}
                </th>
              ) : null}
              {showFund ? (
                <th role="columnheader" scope="col" class="numeric">
                  {FUND_COLUMN}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {results.scenarios.map((name, i) => {
              const metrics = results.metrics[i];
              const figures = metrics?.keyFigures ?? null;
              return (
                <tr
                  key={i}
                  role="row"
                  class="figures-table__row"
                  onClick={(event) => onOpenScenario(i, event.detail > 0)}
                >
                  <th role="rowheader" scope="row">
                    <span class="figures-table__scenario">
                      <ScenarioSample index={i} />
                      <button
                        type="button"
                        class="figures-table__open"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenScenario(i, event.detail > 0);
                        }}
                      >
                        {name}
                      </button>
                    </span>
                  </th>
                  <MoneyCell
                    label={COLUMNS[0]!}
                    value={figures?.lowestCash}
                    detail={figures ? `in ${figures.lowestCashDate}` : undefined}
                  />
                  <MoneyCell label={COLUMNS[1]!} value={figures?.endingCash} />
                  <MoneyCell label={COLUMNS[2]!} value={figures?.endingTotal} />
                  {showNetWorth ? <MoneyCell label={NET_WORTH_COLUMN} value={figures?.endingNetWorth} /> : null}
                  {showFund ? <FundCell fund={metrics?.emergencyFund ?? null} /> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
