import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { EarliestSubject, EarliestTarget } from '../config/earliest';
import { HelpTip } from '../components/HelpTip';
import { HELP } from '../config/help';
import { MonthField } from '../components/fields';
import { addMonths } from '../config/month';
import { EngineError, type EarliestAnswer, type EarliestRequest, type ForecastResults, type MonthSpan } from '../engine/types';
import { GuardrailList } from './Guardrails';

interface EarliestProps {
  results: ForecastResults;
  /** The scenario's position in the results. */
  scenario: number;
  subject: EarliestSubject;
  /** The names of the plan's guardrails, in its order. */
  guardrails: readonly string[];
  /** Asks the engine, against the plan these results came from. */
  run: (request: EarliestRequest) => Promise<EarliestAnswer>;
}

type Outcome =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'failed'; message: string }
  | { state: 'done'; answer: EarliestAnswer };

function span({ from, to }: MonthSpan): string {
  return from === to ? from : `${from} to ${to}`;
}

/** "a", "a and b", "a, b and c". */
function spans(list: MonthSpan[]): string {
  const parts = list.map(span);
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The range a target starts from: the whole plan, short of the month the entry keeps. */
function rangeFor(target: EarliestTarget | undefined, first: string, last: string): { from: string; to: string } {
  let from = first;
  let to = last;
  // Months compare as text in this form. The engine still judges the range.
  if (target && target.start !== target.end) {
    if (target.field === 'startDate' && target.end > first && target.end < last) to = target.end;
    if (target.field === 'endDate' && target.start > first && target.start < last) from = target.start;
  }
  return { from, to };
}

/**
 * The earliest month one entry of this scenario's path can take with the
 * chosen guardrails holding, as the engine works it out on the plan these
 * results came from. Asking changes nothing in the plan.
 */
export function Earliest({ results, scenario, subject, guardrails, run }: EarliestProps) {
  const base = useId();
  const first = results.rows[0]?.date ?? '';
  const last = results.rows[results.rows.length - 1]?.date ?? '';
  const applies = (name: string) =>
    results.metrics[scenario]?.guardrails?.find((result) => result.name === name)?.result !== 'doesNotApply';

  const [targetKey, setTargetKey] = useState(subject.targets[0]?.key ?? '');
  const target = subject.targets.find((candidate) => candidate.key === targetKey) ?? subject.targets[0];
  const [range, setRange] = useState(() => rangeFor(target, first, last));
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(guardrails.filter(applies)));
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });
  // Only the latest request may report; an earlier one finishing late is dropped.
  const request = useRef(0);

  // A new run, or another scenario, starts afresh.
  useEffect(() => {
    request.current += 1;
    const next = subject.targets[0];
    setTargetKey(next?.key ?? '');
    setRange(rangeFor(next, first, last));
    setChosen(new Set(guardrails.filter(applies)));
    setOutcome({ state: 'idle' });
  }, [results, scenario]);

  if (!target) return null;

  const chooseTarget = (key: string) => {
    request.current += 1;
    setTargetKey(key);
    setRange(rangeFor(subject.targets.find((candidate) => candidate.key === key), first, last));
    setOutcome({ state: 'idle' });
  };

  const toggle = (name: string, ticked: boolean) => {
    const next = new Set(chosen);
    if (ticked) next.add(name);
    else next.delete(name);
    setChosen(next);
  };

  const ask = () => {
    request.current += 1;
    const mine = request.current;
    setOutcome({ state: 'running' });
    run({
      scenario: subject.scenarioName,
      entry: target.entry,
      field: target.field,
      from: range.from,
      to: range.to,
      guardrails: guardrails.filter((name) => chosen.has(name)),
    }).then(
      (answer) => {
        if (request.current === mine) setOutcome({ state: 'done', answer });
      },
      (error: unknown) => {
        if (request.current !== mine) return;
        setOutcome({
          state: 'failed',
          message: error instanceof EngineError ? error.message : `Unexpected engine failure: ${String(error)}`,
        });
      },
    );
  };

  const groups = subject.targets.reduce<{ name: string; targets: EarliestTarget[] }[]>((out, candidate) => {
    const group = out.find((g) => g.name === candidate.group);
    if (group) group.targets.push(candidate);
    else out.push({ name: candidate.group, targets: [candidate] });
    return out;
  }, []);

  return (
    <section class="earliest">
      <div class="results__section-heading">
        <h3>Earliest month</h3>
        <p>The earliest month an event or a loan of this scenario can be placed with your guardrails holding.</p>
      </div>
      <div class="results__projection">
        <div class="earliest__form">
          <div class="field field--wide">
            <div class="field__label">
              <label for={`${base}-target`}>Move</label>
              <HelpTip
                id={`${base}-target-help`}
                label="Move"
                help={HELP.earliestTarget}
              />
            </div>
            <select
              id={`${base}-target`}
              class="input"
              value={target.key}
              onChange={(event) => chooseTarget((event.currentTarget as HTMLSelectElement).value)}
            >
              {groups.map((group) => (
                <optgroup key={group.name} label={group.name}>
                  {group.targets.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <MonthField
            label="From"
            help={HELP.earliestFrom}
            value={range.from}
            onChange={(from) => setRange({ ...range, from })}
            required
          />
          <MonthField
            label="To"
            help={HELP.earliestTo}
            value={range.to}
            onChange={(to) => setRange({ ...range, to })}
            required
          />
          <fieldset class="field field--wide name-checklist">
            <legend class="field__label">
              <span>Must hold</span>
              <HelpTip
                id={`${base}-guardrails-help`}
                label="Must hold"
                help={HELP.earliestGuardrails}
              />
            </legend>
            <ul class="check-grid name-checklist__list">
              {guardrails.map((name, i) => (
                <li key={name}>
                  <div class="check-row">
                    <input
                      id={`${base}-g${i}`}
                      type="checkbox"
                      checked={chosen.has(name)}
                      onChange={(event) => toggle(name, (event.currentTarget as HTMLInputElement).checked)}
                    />
                    <label for={`${base}-g${i}`}>{name}</label>
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>

        <div class="earliest__ask">
          <button type="button" class="btn btn--small" onClick={ask}>
            Find the earliest month
          </button>
          <p role="status">
            {outcome.state === 'running'
              ? 'Trying each month…'
              : `Tries every month in the range for ${subject.scenarioName}. Your plan stays as it is.`}
          </p>
          {/* Beside what the button does, never in place of it. */}
          {outcome.state === 'failed' ? (
            <p role="alert" class="flip__error">
              {outcome.message}
            </p>
          ) : null}
        </div>

        {outcome.state === 'done' ? <Answer answer={outcome.answer} /> : null}
      </div>
    </section>
  );
}

function Answer({ answer }: { answer: EarliestAnswer }) {
  const decided = answer.decidedBy ?? [];
  const before = decided.length > 0 && answer.month ? addMonths(answer.month, -1) : null;
  return (
    <div class="earliest__answer">
      {answer.month ? (
        <>
          <p class="earliest__headline">
            Earliest month: <strong>{answer.month}</strong>.{' '}
            {answer.month === answer.configured ? 'That is the month your plan has.' : `Your plan has ${answer.configured}.`}
          </p>
          {before ? (
            <div class="earliest__decided">
              <p>A month earlier, in {before}:</p>
              <GuardrailList guardrails={decided} />
            </div>
          ) : (
            <p>It works from the first month of the range, so nothing in the range decides it.</p>
          )}
          <p>
            Works in {spans(answer.works)}.{answer.works.length > 1 ? ' The months between do not.' : ''}
          </p>
        </>
      ) : (
        <p class="earliest__headline">
          No month from {answer.from} to {answer.to} works with every chosen guardrail holding.
        </p>
      )}
      <ul class="earliest__holds">
        {answer.holds.map((holds) => (
          <li key={holds.name}>
            <strong class="guardrails__name">{holds.name}</strong>{' '}
            {holds.months.length > 0 ? `holds ${spans(holds.months)}` : 'holds in no month of the range'}
          </li>
        ))}
      </ul>
      {answer.month && answer.atEarliest && answer.atEarliest.length > 0 ? (
        <div class="earliest__at">
          <p>In {answer.month}:</p>
          <GuardrailList guardrails={answer.atEarliest} />
        </div>
      ) : null}
    </div>
  );
}
