import { Fragment } from 'preact';
import { useEffect, useId, useState } from 'preact/hooks';
import { formatMoney } from '../util/format';

export interface MonthlyRow {
  date: string;
  liquid: number | null;
  total: number | null;
  notes: string[];
}

interface MonthlyTableProps {
  rows: MonthlyRow[];
  scenarioName: string;
}

export function MonthlyTable({ rows, scenarioName }: MonthlyTableProps) {
  const id = useId();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const hasNotes = rows.some((row) => row.notes.length > 0);

  // A fresh run starts closed; ResultsView also keys this table by scenario.
  useEffect(() => setExpanded(new Set()), [rows]);

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
            {`Monthly liquid and total net worth for ${scenarioName}`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" class="numeric">Liquid</th>
              <th scope="col" class="numeric">Total</th>
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
                    <td class={row.liquid !== null && row.liquid < 0 ? 'numeric is-negative' : 'numeric'}>
                      {row.liquid === null ? '' : formatMoney(row.liquid)}
                    </td>
                    <td class={row.total !== null && row.total < 0 ? 'numeric is-negative' : 'numeric'}>
                      {row.total === null ? '' : formatMoney(row.total)}
                    </td>
                  </tr>
                  {hasEvents ? (
                    <tr id={detailsId} class="month-details" hidden={!open}>
                      <td colSpan={3}>
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
