import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { FlipSubject } from '../config/choices';
import {
  EngineError,
  type FlipComparison,
  type FlipRequest,
  type ForecastResults,
  type Reading,
  type Readings,
} from '../engine/types';
import { runOwes, seriesDiffer } from './balance';
import { Chart } from './Chart';
import { BreakEven } from './Difference';
import { GuardrailTable } from './Guardrails';
import { inReading, pick } from './reading';

interface FlipProps {
  /** The run's results, in nominal dollars. */
  results: ForecastResults;
  /** How to read the amounts; nominal by default. */
  reading?: Reading;
  /** The scenario's position in the results. */
  scenario: number;
  subject: FlipSubject;
  /** Asks the engine for the flip, against the plan these results came from. */
  run: (request: FlipRequest) => Promise<Readings<FlipComparison>>;
  /** Adds the flipped path to the plan; returns an explanation on refusal, otherwise null. */
  onKeep: (scenarioId: string, choiceId: string, optionId: string, name: string) => string | null;
}

type Outcome =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'failed'; message: string }
  | { state: 'done'; answer: Readings<FlipComparison>; kept: boolean; keepError: string | null };

/**
 * One scenario with a single choice made differently, against the scenario
 * as it is: the months the lead changes hands and the difference over time.
 * The engine works the flipped path out; nothing here changes the plan
 * unless the reader keeps the path.
 */
export function Flip({ results, reading = 'nominal', scenario, subject, run, onKeep }: FlipProps) {
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
      (answer) => {
        if (request.current === mine) setOutcome({ state: 'done', answer, kept: false, keepError: null });
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

  const keep = (answer: Readings<FlipComparison>) => {
    if (!option) return;
    const keepError = onKeep(subject.scenarioId, choice.id, option.id, answer.nominal.name);
    setOutcome({ state: 'done', answer, kept: keepError === null, keepError });
  };

  // The answer in the reading chosen; the months are the same in both.
  const flip = outcome.state === 'done' ? pick(outcome.answer, reading) : null;
  const metrics = inReading(results, reading).metrics;
  // Net worth shows when something is owed on either path: the run's, or the
  // flipped path's, which only shows as a net worth unlike the total.
  const netWorth =
    flip?.netWorth && (runOwes(results) || seriesDiffer(flip.netWorth.difference, flip.total.difference))
      ? flip.netWorth
      : undefined;

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
        {outcome.state === 'done' && flip && option ? (
          <>
            <dl class="difference__breakeven">
              <BreakEven
                label="Total"
                months={flip.total.breakEven.map((m) => ({ date: m.date, leader: m.flipped ? 0 : 1 }))}
                scenarios={[flip.name, scenarioName]}
              />
              <BreakEven
                label="Liquid"
                months={flip.cash.breakEven.map((m) => ({ date: m.date, leader: m.flipped ? 0 : 1 }))}
                scenarios={[flip.name, scenarioName]}
              />
              {netWorth ? (
                <BreakEven
                  label="Net worth"
                  months={netWorth.breakEven.map((m) => ({ date: m.date, leader: m.flipped ? 0 : 1 }))}
                  scenarios={[flip.name, scenarioName]}
                />
              ) : null}
            </dl>
            <p class="difference__reading">
              Above zero, {scenarioName} is better off with {option.name} than with {choice.current.name}; below
              zero, worse off.
            </p>
            <GuardrailTable
              title="Guardrails on both paths"
              intro={`Whether ${scenarioName} keeps each guardrail with ${option.name}, beside how it does now.`}
              pathLabel="Path"
              nested
              paths={[
                { name: scenarioName, guardrails: metrics[scenario]?.guardrails },
                { name: flip.name, guardrails: flip.guardrails },
              ]}
            />
            <Chart
              dates={results.rows.map((row) => row.date)}
              liquid={flip.cash.difference}
              total={flip.total.difference}
              netWorth={netWorth?.difference}
              scenarioName={flip.name}
              subject={`of ${flip.name} minus ${scenarioName}`}
            />
            <div class="flip__keep">
              {/* Kept, the button stays where the focus is but no longer acts. */}
              <button
                type="button"
                class="btn btn--small"
                aria-disabled={outcome.kept ? 'true' : undefined}
                onClick={() => {
                  if (!outcome.kept) keep(outcome.answer);
                }}
              >
                {outcome.kept ? 'Kept as a scenario' : 'Keep as a scenario'}
              </button>
              <p role="status">
                {outcome.kept
                  ? 'Added to your plan. Run the forecast again to see it beside the others.'
                  : `Adds “${flip.name}” to your plan. Until then this comparison changes nothing.`}
              </p>
              {/* Beside what the button does, never in place of it. */}
              {outcome.keepError ? (
                <p ref={keepMessage} role="alert" class="flip__error">
                  {outcome.keepError}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
