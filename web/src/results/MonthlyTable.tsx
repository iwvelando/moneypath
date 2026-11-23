import { Fragment } from 'preact';
import { useEffect, useId, useState } from 'preact/hooks';
import { HALF_CENT, formatMoney, isNegativeMoney } from '../util/format';

export interface MonthlyRow {
  date: string;
  liquid: number | null;
  total: number | null;
  /** What the path's loans still owe; absent or 0 in every month for a path with none. */
  liabilities?: number | null;
  netWorth?: number | null;
  notes: string[];
}

/** A money cell, blank where the scenario has no value. */
function Money({ value }: { value: number | null | undefined }) {
  const known = value !== null && value !== undefined;
  return (
    <td class={known && isNegativeMoney(value) ? 'numeric is-negative' : 'numeric'}>
      {known ? formatMoney(value) : ''}
    </td>
  );
}

interface MonthlyTableProps {
  rows: MonthlyRow[];
  scenarioName: string;
  /** The run the rows came from; a new one starts closed. Without it, new rows do. */
  run?: unknown;
}

export function MonthlyTable({ rows, scenarioName, run }: MonthlyTableProps) {
  const id = useId();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const hasNotes = rows.some((row) => row.notes.length > 0);
  // Without debt, net worth is the total, so the two columns would only repeat it.
  const owes = rows.some((row) => Math.abs(row.liabilities ?? 0) >= HALF_CENT);

  // A fresh run starts closed, while another reading of the same run keeps
  // what is open; ResultsView also keys this table by scenario.
  useEffect(() => setExpanded(new Set()), [run ?? rows]);

  const toggle = (date: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  return (
    <>
      {hasNotes ? (
        <p class="monthly-hint" id={`${id}-hint`}>
          Rows with an arrow open to show that month’s events.
        </p>
      ) : null}
      <div class="table-wrap">
        <table class="results-table" aria-describedby={hasNotes ? `${id}-hint` : undefined}>
          <caption class="visually-hidden">
            {owes
              ? `Monthly liquid, total, debt and net worth for ${scenarioName}`
              : `Monthly liquid and total net worth for ${scenarioName}`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" class="numeric">Liquid</th>
              <th scope="col" class="numeric">Total</th>
              {owes ? (
                <>
                  <th scope="col" class="numeric">Debt</th>
                  <th scope="col" class="numeric">Net worth</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const hasEvents = row.notes.length > 0;
              const open = expanded.has(row.date);
              const detailsId = `${id}-${row.date}-events`;
              return (
                <Fragment key={row.date}>
                  <tr
                    class={hasEvents ? `month-row is-expandable${open ? ' is-expanded' : ''}` : 'month-row'}
                    onClick={hasEvents ? () => toggle(row.date) : undefined}
                  >
                    <th scope="row">
                      {hasEvents ? (
                        <button
                          type="button"
                          class="month-toggle"
                          aria-label={`${open ? 'Hide' : 'Show'} events for ${row.date}`}
                          aria-expanded={open}
                          aria-controls={detailsId}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(row.date);
                          }}
                        >
                          <svg class="month-toggle__arrow" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                            <path d="m4 2 4 4-4 4" />
                          </svg>
                          <span>{row.date}</span>
                        </button>
                      ) : <span class="month-date">{row.date}</span>}
                    </th>
                    <Money value={row.liquid} />
                    <Money value={row.total} />
                    {owes ? (
                      <>
                        <Money value={row.liabilities} />
                        <Money value={row.netWorth} />
                      </>
                    ) : null}
                  </tr>
                  {hasEvents ? (
                    <tr id={detailsId} class="month-details" hidden={!open}>
                      <td colSpan={owes ? 5 : 3}>
                        {open ? (
                          <div class="month-details__content">
                            <p class="month-details__heading">Events in {row.date}</p>
                            <ul aria-label={`Events for ${row.date}`}>
                              {row.notes.map((note, index) => <li key={index}>{note}</li>)}
                            </ul>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p class="empty">This scenario produced no rows.</p> : null}
      </div>
    </>
  );
}
