import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { FlipSubject } from '../config/choices';
import { EngineError, type FlipComparison, type FlipRequest, type ForecastResults } from '../engine/types';
import { Chart } from './Chart';
import { BreakEven } from './Difference';

interface FlipProps {
  results: ForecastResults;
  /** The scenario's position in the results. */
  scenario: number;
  subject: FlipSubject;
  /** Asks the engine for the flip, against the plan these results came from. */
  run: (request: FlipRequest) => Promise<FlipComparison>;
  /** Adds the flipped path to the plan; returns an explanation on refusal, otherwise null. */
  onKeep: (scenarioId: string, choiceId: string, optionId: string, name: string) => string | null;
}

type Outcome =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'failed'; message: string }
  | { state: 'done'; flip: FlipComparison; kept: boolean; keepError: string | null };

/**
 * One scenario with a single choice made differently, against the scenario
 * as it is: the months the lead changes hands and the difference over time.
 * The engine works the flipped path out; nothing here changes the plan
 * unless the reader keeps the path.
 */
export function Flip({ results, scenario, subject, run, onKeep }: FlipProps) {
  const base = useId();
  const [choiceId, setChoiceId] = useState('');
  const [optionId, setOptionId] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });
  const keepMessage = useRef<HTMLParagraphElement | null>(null);
  // Only the latest request may report; an earlier one finishing late is dropped.
  const request = useRef(0);

  // The button may sit at the bottom of a phone screen. Bring its refusal
  // into view without moving focus away from the button.
  useLayoutEffect(() => {
    if (outcome.state === 'done' && outcome.keepError) {
      keepMessage.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [outcome]);

  // A new run, or another scenario, starts from nothing picked.
  useEffect(() => {
    request.current += 1;
    setOptionId('');
    setOutcome({ state: 'idle' });
  }, [results, scenario]);

  const choice = subject.choices.find((candidate) => candidate.id === choiceId) ?? subject.choices[0];
  if (!choice) return null;
  const scenarioName = results.scenarios[scenario] ?? '';
  const option = choice.others.find((candidate) => candidate.id === optionId);

  const chooseChoice = (id: string) => {
    request.current += 1;
    setChoiceId(id);
    setOptionId('');
    setOutcome({ state: 'idle' });
  };

  const chooseOption = (id: string) => {
    request.current += 1;
    const mine = request.current;
    setOptionId(id);
    const picked = choice.others.find((candidate) => candidate.id === id);
    if (!picked) {
      setOutcome({ state: 'idle' });
      return;
    }
    setOutcome({ state: 'running' });
    run({ scenario: scenarioName, choice: choice.name, option: picked.name }).then(
      (flip) => {
        if (request.current === mine) setOutcome({ state: 'done', flip, kept: false, keepError: null });
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

  const keep = (flip: FlipComparison) => {
    if (!option) return;
    const keepError = onKeep(subject.scenarioId, choice.id, option.id, flip.name);
    setOutcome({ state: 'done', flip, kept: keepError === null, keepError });
  };

  return (
    <section class="flip">
      <div class="results__section-heading">
        <h3>Flip one choice</h3>
        <p>This scenario with one decision made differently, and everything else as it is.</p>
      </div>
      <div class="results__projection">
        <div class="difference__pickers">
          <label for={`${base}-choice`}>
            <span>Choice</span>
            <select
              id={`${base}-choice`}
              class="input"
              value={choice.id}
              onChange={(event) => chooseChoice((event.currentTarget as HTMLSelectElement).value)}
            >
              {subject.choices.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <label for={`${base}-option`}>
            <span>Instead of {choice.current.name}</span>
            <select
              id={`${base}-option`}
              class="input"
              value={option ? option.id : ''}
              onChange={(event) => chooseOption((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="">Choose an option…</option>
              {choice.others.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {outcome.state === 'idle' ? (
          <p class="flip__hint">
            Pick another option to see what that one decision changes for {scenarioName}. Your plan stays
            as it is.
          </p>
        ) : null}
        {outcome.state === 'running' ? (
          <p class="flip__hint" role="status">
            Working out the difference…
          </p>
        ) : null}
        {outcome.state === 'failed' ? (
          <p class="flip__error" role="alert">
            {outcome.message}
          </p>
        ) : null}
        {outcome.state === 'done' && option ? (
          <>
            <dl class="difference__breakeven">
              <BreakEven
                label="Total"
                months={outcome.flip.total.breakEven.map((m) => ({ date: m.date, leader: m.flipped ? 0 : 1 }))}
                scenarios={[outcome.flip.name, scenarioName]}
              />
              <BreakEven
                label="Liquid"
                months={outcome.flip.cash.breakEven.map((m) => ({ date: m.date, leader: m.flipped ? 0 : 1 }))}
                scenarios={[outcome.flip.name, scenarioName]}
              />
            </dl>
            <p class="difference__reading">
              Above zero, {scenarioName} is better off with {option.name} than with {choice.current.name}; below
              zero, worse off.
            </p>
            <Chart
              dates={results.rows.map((row) => row.date)}
              liquid={outcome.flip.cash.difference}
              total={outcome.flip.total.difference}
              scenarioName={outcome.flip.name}
              subject={`of ${outcome.flip.name} minus ${scenarioName}`}
            />
            <div class="flip__keep">
              {/* Kept, the button stays where the focus is but no longer acts. */}
              <button
                type="button"
                class="btn btn--small"
                aria-disabled={outcome.kept ? 'true' : undefined}
                onClick={() => {
                  if (!outcome.kept) keep(outcome.flip);
                }}
              >
                {outcome.kept ? 'Kept as a scenario' : 'Keep as a scenario'}
              </button>
              <p
                ref={keepMessage}
                role={outcome.keepError ? 'alert' : 'status'}
                class={outcome.keepError ? 'flip__error' : undefined}
              >
                {outcome.keepError ?? (outcome.kept
                  ? 'Added to your plan. Run the forecast again to see it beside the others.'
                  : `Adds “${outcome.flip.name}” to your plan. Until then this comparison changes nothing.`)}
              </p>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
