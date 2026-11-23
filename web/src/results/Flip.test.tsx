import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlipSubject } from '../config/choices';
import {
  EngineError,
  type FlipComparison,
  type FlipRequest,
  type ForecastResults,
  type Reading,
  type Readings,
} from '../engine/types';
import { Flip } from './Flip';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

const dates = ['2026-01', '2026-02', '2026-03'];

const results: ForecastResults = {
  version: 'test',
  scenarios: ['stay', 'other'],
  rows: dates.map((date) => ({ date, values: [{ liquid: 1, total: 2, notes: [] }, { liquid: 3, total: 4, notes: [] }] })),
  csv: '',
  metrics: [{}, {}],
  comparisons: [],
  warnings: [],
  configYaml: '',
};

const subject: FlipSubject = {
  scenarioId: 'sc-stay',
  choices: [
    {
      id: 'ch-home',
      name: 'Home',
      current: { id: 'op-stay', name: 'Stay' },
      others: [
        { id: 'op-move', name: 'Move' },
        { id: 'op-sell', name: 'Sell' },
      ],
    },
    { id: 'ch-job', name: 'Job', current: { id: 'op-keep', name: 'Keep' }, others: [{ id: 'op-quit', name: 'Quit' }] },
  ],
};

function answer(request: FlipRequest): FlipComparison {
  return {
    scenario: 0,
    choice: request.choice,
    option: request.option,
    name: `${request.scenario} (${request.choice}: ${request.option})`,
    cash: {
      difference: [0, -400, 250],
      breakEven: [
        { date: '2026-02', flipped: false },
        { date: '2026-03', flipped: true },
      ],
    },
    total: { difference: [0, 150, 175], breakEven: [] },
  };
}

type Run = (request: FlipRequest) => Promise<FlipComparison>;
type Keep = (scenarioId: string, choiceId: string, optionId: string, name: string) => string | null;

/** The engine's answer in nominal dollars only, as for a plan without an inflation rate. */
const nominalOnly =
  (run: Run) =>
  (request: FlipRequest): Promise<Readings<FlipComparison>> =>
    run(request).then((nominal) => ({ nominal, today: null }));

function show(run: Run, onKeep: Keep = () => null, data: ForecastResults = results): void {
  act(() => {
    render(<Flip results={data} scenario={0} subject={subject} run={nominalOnly(run)} onKeep={onKeep} />, host);
  });
}

function picker(index: number): HTMLSelectElement {
  const select = host.querySelectorAll('select')[index];
  if (!select) throw new Error(`no picker ${index}`);
  return select;
}

async function pick(index: number, value: string): Promise<void> {
  await act(async () => {
    const select = picker(index);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const optionLabels = (index: number) => [...picker(index).options].map((o) => o.textContent?.trim());
const text = () => host.textContent ?? '';
const keepButton = () =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Keep as a scenario')) ?? null;

describe('flipping one choice of a scenario', () => {
  it('offers the choices and, for the chosen one, the options the scenario does not take', () => {
    const run = vi.fn(async (request: FlipRequest) => answer(request));
    show(run);
    expect(optionLabels(0)).toEqual(['Home', 'Job']);
    expect(optionLabels(1)).toEqual(['Choose an option…', 'Move', 'Sell']);
    expect(text()).toContain('Stay');
    // Nothing is worked out, or shown, until an option is picked.
    expect(run).not.toHaveBeenCalled();
    expect(host.querySelector('.chart')).toBeNull();
    expect(keepButton()).toBeNull();
  });

  it('asks the engine for the picked flip and shows what it reported', async () => {
    const run = vi.fn(async (request: FlipRequest) => answer(request));
    show(run);
    await pick(1, 'op-sell');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ scenario: 'stay', choice: 'Home', option: 'Sell' });

    expect(text()).toContain('2026-02: stay moves ahead');
    expect(text()).toContain('2026-03: stay (Home: Sell) moves ahead');
    expect(text()).toContain('The lead never changes hands.');
    expect(text()).toContain('Above zero, stay is better off with Sell than with Stay; below zero, worse off.');
    expect(host.querySelector('svg')).not.toBeNull();
  });

  it('follows the choice picker, and forgets the figures of the previous flip', async () => {
    const run = vi.fn(async (request: FlipRequest) => answer(request));
    show(run);
    await pick(1, 'op-move');
    await pick(0, 'ch-job');
    expect(optionLabels(1)).toEqual(['Choose an option…', 'Quit']);
    expect(picker(1).value).toBe('');
    expect(text()).not.toContain('moves ahead');
    expect(keepButton()).toBeNull();
    await pick(1, 'op-quit');
    expect(run).toHaveBeenLastCalledWith({ scenario: 'stay', choice: 'Job', option: 'Quit' });
  });

  it('shows the engine’s refusal in place of figures', async () => {
    show(async () => {
      throw new EngineError('with "Move" for the choice "Home": duplicate investment name "Fund"');
    });
    await pick(1, 'op-move');
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('duplicate investment name "Fund"');
    expect(text()).not.toContain('moves ahead');
    expect(keepButton()).toBeNull();
  });

  it('keeps the flipped path once, and says so', async () => {
    const onKeep = vi.fn<Keep>(() => null);
    show(async (request) => answer(request), onKeep);
    await pick(1, 'op-move');
    const button = keepButton()!;
    act(() => button.click());
    expect(onKeep).toHaveBeenCalledWith('sc-stay', 'ch-home', 'op-move', 'stay (Home: Move)');
    expect(text()).toContain('Added to your plan.');
    expect(keepButton()).toBeNull();
    // The control stays where the focus is, but no longer acts.
    expect(button.isConnected).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    act(() => button.click());
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('leaves the offer standing when the plan could not take the path', async () => {
    const message = 'Your plan has changed. Run the forecast again before keeping this path.';
    show(async (request) => answer(request), () => message);
    await pick(1, 'op-move');
    act(() => keepButton()!.click());
    expect(keepButton()).not.toBeNull();
    expect(text()).not.toContain('Added to your plan.');
    expect(host.querySelector('.flip__keep [role="alert"]')?.textContent).toBe(message);
    // The refusal is added beside what the button does, never in place of it.
    expect(host.querySelector('.flip__keep [role="status"]')?.textContent).toContain('to your plan. Until then');
    await pick(1, 'op-sell');
    expect(host.querySelector('.flip__keep [role="alert"]')).toBeNull();
  });

  it('starts over for a new run', async () => {
    const run = vi.fn(async (request: FlipRequest) => answer(request));
    show(run);
    await pick(1, 'op-move');
    show(run, () => null, { ...results });
    expect(picker(1).value).toBe('');
    expect(text()).not.toContain('moves ahead');
  });
});

describe('a flip read in today’s dollars', () => {
  const metric = (margin: number) => ({
    guardrails: [{ name: 'Cushion', kind: 'cashFloor', result: 'holds' as const, tightestDate: '2026-02', margin }],
  });
  const data: ForecastResults = {
    ...results,
    metrics: [metric(500), {}],
    todaysDollars: { today: '2026-01', rows: results.rows, metrics: [metric(480), {}], comparisons: [] },
  };
  const readings = (request: FlipRequest): Readings<FlipComparison> => {
    const nominal = { ...answer(request), guardrails: metric(700).guardrails };
    return {
      nominal,
      today: {
        ...nominal,
        cash: { ...nominal.cash, difference: [0, -390, 240] },
        guardrails: metric(650).guardrails,
      },
    };
  };

  function showIn(reading: Reading, run: (request: FlipRequest) => Promise<Readings<FlipComparison>>): void {
    act(() => {
      render(
        <Flip results={data} reading={reading} scenario={0} subject={subject} run={run} onKeep={() => null} />,
        host,
      );
    });
  }

  it('shows the answer in the reading chosen, without asking again or starting over', async () => {
    const run = vi.fn(async (request: FlipRequest) => readings(request));
    showIn('nominal', run);
    await pick(1, 'op-move');
    expect(text()).toContain('$500.00');
    expect(text()).toContain('$700.00');
    showIn('today', run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(picker(1).value).toBe('op-move');
    expect(text()).toContain('$480.00');
    expect(text()).toContain('$650.00');
    expect(text()).not.toContain('$700.00');
    // The months are the engine's, the same in both.
    expect(text()).toContain('2026-03: stay (Home: Move) moves ahead');
  });
});

describe('the flip in net worth', () => {
  const labels = () => [...host.querySelectorAll('.difference__breakeven dt')].map((dt) => dt.textContent);

  it('lists its break-even months and charts it when the flipped path owes differently', async () => {
    show(async (request) => ({
      ...answer(request),
      netWorth: { difference: [0, -9000, -8800], breakEven: [{ date: '2026-02', flipped: false }] },
    }));
    await pick(1, 'op-move');
    expect(labels()).toEqual(['Total break-even', 'Liquid break-even', 'Net worth break-even']);
    expect(host.querySelectorAll('.chart__line')).toHaveLength(3);
  });

  it('is left out when it is the same as the total and nothing is owed', async () => {
    show(async (request) => ({ ...answer(request), netWorth: { difference: [0, 150, 175], breakEven: [] } }));
    await pick(1, 'op-move');
    expect(labels()).toEqual(['Total break-even', 'Liquid break-even']);
    expect(host.querySelectorAll('.chart__line')).toHaveLength(2);
  });
});
