import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EarliestSubject } from '../config/earliest';
import {
  EngineError,
  type EarliestAnswer,
  type EarliestRequest,
  type ForecastResults,
  type Reading,
  type Readings,
} from '../engine/types';
import { Earliest } from './Earliest';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

const dates = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

const results: ForecastResults = {
  version: 'test',
  scenarios: ['buy the car'],
  rows: dates.map((date) => ({ date, values: [{ liquid: 1, total: 2, notes: [] }] })),
  csv: '',
  metrics: [
    {
      guardrails: [
        { name: 'Cushion', kind: 'cashFloor', result: 'holds', tightestDate: '2026-02', margin: 5 },
        { name: 'Later', kind: 'cashFloor', result: 'doesNotApply' },
        { name: 'Car gone', kind: 'debtFree', result: 'holds', tightestDate: '2026-05', marginMonths: 1 },
      ],
    },
  ],
  comparisons: [],
  warnings: [],
  configYaml: '',
};

const subject: EarliestSubject = {
  scenarioName: 'buy the car',
  targets: [
    { key: 'a', group: 'Baseline', entry: 'common.loans.0', field: 'startDate', label: 'Car: when it starts', start: '2026-04', end: '' },
    { key: 'b', group: 'Baseline', entry: 'common.events.0', field: 'startDate', label: 'Salary: when it starts', start: '2026-02', end: '2026-04' },
    { key: 'c', group: 'Baseline', entry: 'common.events.0', field: 'endDate', label: 'Salary: when it ends', start: '2026-02', end: '2026-04' },
  ],
};

const guardrails = ['Cushion', 'Later', 'Car gone'];

const found: EarliestAnswer = {
  scenario: 0,
  entry: 'common.loans.0',
  name: 'Car',
  field: 'startDate',
  from: '2026-01',
  to: '2026-06',
  guardrails: ['Cushion', 'Car gone'],
  configured: '2026-04',
  month: '2026-02',
  works: [
    { from: '2026-02', to: '2026-03' },
    { from: '2026-05', to: '2026-05' },
  ],
  holds: [
    { name: 'Cushion', months: [{ from: '2026-02', to: '2026-06' }] },
    { name: 'Car gone', months: [{ from: '2026-01', to: '2026-03' }, { from: '2026-05', to: '2026-05' }] },
  ],
  decidedBy: [
    { name: 'Cushion', kind: 'cashFloor', result: 'breaks', firstBreachDate: '2026-04', tightestDate: '2026-04', margin: -7.75 },
  ],
  atEarliest: [
    { name: 'Cushion', kind: 'cashFloor', result: 'holds', tightestDate: '2026-04', margin: 4.09 },
    { name: 'Car gone', kind: 'debtFree', result: 'holds', tightestDate: '2026-04', marginMonths: 2 },
  ],
};

type Run = (request: EarliestRequest) => Promise<EarliestAnswer>;

function show(run: Run, data: ForecastResults = results, reading: Reading = 'nominal', today: EarliestAnswer | null = null): void {
  const both = (request: EarliestRequest): Promise<Readings<EarliestAnswer>> =>
    run(request).then((nominal) => ({ nominal, today }));
  act(() => {
    render(
      <Earliest results={data} reading={reading} scenario={0} subject={subject} guardrails={guardrails} run={both} />,
      host,
    );
  });
}

function field(label: string): HTMLInputElement | HTMLSelectElement {
  const labelEl = [...host.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(label));
  const id = labelEl?.getAttribute('for');
  const el = id ? (host.querySelector(`#${CSS.escape(id)}`) as HTMLInputElement | HTMLSelectElement | null) : null;
  if (!el) throw new Error(`no field ${label}`);
  return el;
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function findButton(): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Find the earliest month');
  if (!button) throw new Error('no Find button');
  return button;
}

async function find(): Promise<void> {
  await act(async () => {
    findButton().click();
    await Promise.resolve();
  });
}

function text(): string {
  return (host.textContent ?? '').replace(/\s+/g, ' ');
}

describe('the earliest month', () => {
  it('asks about the first entry over the whole plan, holding every guardrail that applies', async () => {
    const run = vi.fn<Run>(() => Promise.resolve(found));
    show(run);
    expect(field('Move').value).toBe('a');
    expect(field('From').value).toBe('2026-01');
    expect(field('To').value).toBe('2026-06');
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((b) => b.checked)).toEqual([true, false, true]);
    await find();
    expect(run).toHaveBeenCalledWith({
      scenario: 'buy the car',
      entry: 'common.loans.0',
      field: 'startDate',
      from: '2026-01',
      to: '2026-06',
      guardrails: ['Cushion', 'Car gone'],
    });
  });

  it('starts the range where the entry lets the month move', async () => {
    const run = vi.fn<Run>(() => Promise.resolve(found));
    show(run);
    setValue(field('Move'), 'b');
    // A start can move no later than the end the entry keeps.
    expect([field('From').value, field('To').value]).toEqual(['2026-01', '2026-04']);
    setValue(field('Move'), 'c');
    // And an end no earlier than its start.
    expect([field('From').value, field('To').value]).toEqual(['2026-02', '2026-06']);
    setValue(field('From'), '2026-03');
    const later = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!;
    act(() => later.click());
    await find();
    expect(run).toHaveBeenLastCalledWith(
      expect.objectContaining({ entry: 'common.events.0', field: 'endDate', from: '2026-03', guardrails: ['Cushion', 'Later', 'Car gone'] }),
    );
  });

  it('says the month, what the plan has, what decides it and which months work', async () => {
    show(() => Promise.resolve(found));
    await find();
    const said = text();
    expect(said).toContain('Earliest month: 2026-02');
    expect(said).toContain('Your plan has 2026-04.');
    expect(said).toContain('A month earlier, in 2026-01:');
    expect(said).toContain('Cushion Breaks in 2026-04 Tightest 2026-04, $7.75 short');
    expect(said).toContain('Works in 2026-02 to 2026-03 and 2026-05. The months between do not.');
    expect(said).toContain('Cushion holds 2026-02 to 2026-06');
    expect(said).toContain('Car gone holds 2026-01 to 2026-03 and 2026-05');
    expect(said).toContain('In 2026-02:');
    expect(said).toContain('Car gone Holds Debt-free from 2026-04, 2 months to spare');
  });

  it('says when the range’s first month already works', async () => {
    show(() =>
      Promise.resolve({ ...found, month: '2026-01', works: [{ from: '2026-01', to: '2026-06' }], decidedBy: undefined, configured: '2026-01' }),
    );
    await find();
    expect(text()).toContain('It works from the first month of the range, so nothing in the range decides it.');
    expect(text()).toContain('That is the month your plan has.');
    expect(text()).toContain('Works in 2026-01 to 2026-06.');
    expect(text()).not.toContain('A month earlier');
  });

  it('says when no month works, and each guardrail’s months say why', async () => {
    show(() =>
      Promise.resolve({
        ...found,
        month: undefined,
        works: [],
        decidedBy: undefined,
        atEarliest: undefined,
        holds: [
          { name: 'Cushion', months: [] },
          { name: 'Car gone', months: [{ from: '2026-01', to: '2026-03' }] },
        ],
      }),
    );
    await find();
    expect(text()).toContain('No month from 2026-01 to 2026-06 works with every chosen guardrail holding.');
    expect(text()).toContain('Cushion holds in no month of the range');
    expect(text()).toContain('Car gone holds 2026-01 to 2026-03');
    expect(text()).not.toContain('Earliest month:');
  });

  it('shows a refusal beside the button, keeping what the button says', async () => {
    show(() => Promise.reject(new EngineError('Choose at least one guardrail that must hold.')));
    await find();
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('Choose at least one guardrail that must hold.');
    expect(findButton().textContent).toBe('Find the earliest month');
  });

  it('starts again for a new run', async () => {
    show(() => Promise.resolve(found));
    await find();
    expect(text()).toContain('Earliest month: 2026-02');
    show(() => Promise.resolve(found), { ...results });
    expect(text()).not.toContain('Earliest month:');
  });

  it('drops an answer that arrives after another question', async () => {
    let resolveFirst: (a: EarliestAnswer) => void = () => {};
    const first = new Promise<EarliestAnswer>((resolve) => {
      resolveFirst = resolve;
    });
    const run = vi.fn<Run>().mockReturnValueOnce(first).mockReturnValueOnce(Promise.resolve({ ...found, month: '2026-03' }));
    show(run);
    await find();
    await find();
    await act(async () => {
      resolveFirst(found);
      await Promise.resolve();
    });
    expect(text()).toContain('Earliest month: 2026-03');
  });
});

describe('the earliest month read in today’s dollars', () => {
  const today: EarliestAnswer = {
    ...found,
    decidedBy: [{ ...found.decidedBy![0]!, margin: -7.5 }],
    atEarliest: [{ ...found.atEarliest![0]!, margin: 3.95 }, found.atEarliest![1]!],
  };

  it('shows the amounts of the reading chosen beside the same months, without asking again', async () => {
    const run = vi.fn<Run>(() => Promise.resolve(found));
    show(run, results, 'nominal', today);
    await find();
    expect(text()).toContain('Tightest 2026-04, $7.75 short');
    show(run, results, 'today', today);
    expect(run).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Earliest month: 2026-02');
    expect(text()).toContain('Tightest 2026-04, $7.50 short');
    expect(text()).not.toContain('$7.75');
    expect(text()).toContain('$3.95');
  });
});
