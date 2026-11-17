import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FlipSubject } from '../config/choices';
import type { FlipComparison, ForecastResults, GuardrailResult } from '../engine/types';
import { Comparison } from './Comparison';
import { Flip } from './Flip';
import { ResultsView } from './ResultsView';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

const holds: GuardrailResult = { name: 'Cushion', kind: 'cashFloor', result: 'holds', tightestDate: '2026-01', margin: 5000 };
const exactly: GuardrailResult = { name: 'Cushion', kind: 'cashFloor', result: 'holds', tightestDate: '2026-03', margin: 0.000001 };
const breaks: GuardrailResult = {
  name: 'Cushion',
  kind: 'cashFloor',
  result: 'breaks',
  firstBreachDate: '2027-01',
  tightestDate: '2027-02',
  margin: -4545.36,
};
const later: GuardrailResult = { name: 'Later', kind: 'cashFloor', result: 'doesNotApply' };

function results(guardrails: (GuardrailResult[] | undefined)[]): ForecastResults {
  const names = ['as we are', 'sell and freelance'].slice(0, guardrails.length);
  return {
    version: 'test',
    scenarios: names,
    rows: ['2026-01', '2026-02'].map((date) => ({
      date,
      values: names.map(() => ({ liquid: 1, total: 2, notes: [] })),
    })),
    csv: '',
    metrics: guardrails.map((list) => (list ? { guardrails: list } : {})),
    comparisons: [],
    warnings: [],
    configYaml: '',
  };
}

/** Each body row of the guardrails table: its header, then each cell's text. */
function table(scope: ParentNode = host): string[][] {
  const found = scope.querySelector('.guardrails-table');
  if (!found) return [];
  return [...found.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
  );
}

describe('guardrails in Compare', () => {
  it('reports each scenario’s result for each guardrail beside the key figures', () => {
    act(() => {
      render(<Comparison results={results([[holds, later], [breaks, later]])} onOpenScenario={() => {}} />, host);
    });
    const figures = host.querySelector('.figures')!;
    expect(figures.nextElementSibling?.classList.contains('guardrails')).toBe(true);
    expect(table()).toEqual([
      ['Scenario', 'Cushion', 'Later'],
      ['as we are', 'Cushion Holds Tightest 2026-01, $5,000.00 to spare', 'Later Does not apply'],
      ['sell and freelance', 'Cushion Breaks in 2027-01 Tightest 2027-02, $4,545.36 short', 'Later Does not apply'],
    ]);
  });

  it('says a floor met to the cent is met exactly', () => {
    act(() => {
      render(<Comparison results={results([[exactly], [exactly]])} onOpenScenario={() => {}} />, host);
    });
    expect(table()[1]![1]).toBe('Cushion Holds Tightest 2026-03, exactly at the floor');
  });

  it('is left out of a plan without guardrails', () => {
    act(() => {
      render(<Comparison results={results([undefined, undefined])} onOpenScenario={() => {}} />, host);
    });
    expect(host.querySelector('.guardrails')).toBeNull();
  });
});

describe('guardrails in a scenario’s own view', () => {
  function show(data: ForecastResults): void {
    act(() => {
      render(
        <ResultsView
          results={data}
          durationMs={1}
          optimizerRan={false}
          onDownloadCsv={() => {}}
          statusOf={() => 'missing'}
          onApply={() => {}}
        />,
        host,
      );
    });
  }

  it('lists each guardrail with its outcome, first breach, tightest month and margin', () => {
    show(results([[breaks, later]]));
    const card = [...host.querySelectorAll('.summary__card')].find((element) => element.querySelector('h4')?.textContent === 'Guardrails')!;
    const items = [...card.querySelectorAll('li')].map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
    expect(items).toEqual([
      'Cushion Breaks in 2027-01 Tightest 2027-02, $4,545.36 short',
      'Later Does not apply',
    ]);
    expect(card.querySelector('.is-negative')?.textContent).toBe('Breaks in 2027-01');
  });

  it('has no guardrails card for a plan without them', () => {
    show(results([undefined]));
    expect([...host.querySelectorAll('.summary__card h4')].map((h) => h.textContent)).not.toContain('Guardrails');
  });
});

describe('guardrails in the flip panel', () => {
  const subject: FlipSubject = {
    scenarioId: 'sc',
    choices: [{ id: 'ch', name: 'Job', current: { id: 'stay', name: 'Stay' }, others: [{ id: 'go', name: 'Go freelance' }] }],
  };
  const flip = (guardrails?: GuardrailResult[]): FlipComparison => ({
    scenario: 0,
    choice: 'Job',
    option: 'Go freelance',
    name: 'as we are (Job: Go freelance)',
    cash: { difference: [0, 0], breakEven: [] },
    total: { difference: [0, 0], breakEven: [] },
    ...(guardrails ? { guardrails } : {}),
  });

  async function pickAndShow(data: ForecastResults, answer: FlipComparison): Promise<void> {
    act(() => {
      render(<Flip results={data} scenario={0} subject={subject} run={async () => answer} onKeep={() => null} />, host);
    });
    await act(async () => {
      const select = host.querySelectorAll('select')[1]!;
      select.value = 'go';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('shows the flipped path’s results beside the scenario’s', async () => {
    await pickAndShow(results([[holds]]), flip([breaks]));
    expect(table()).toEqual([
      ['Path', 'Cushion'],
      ['as we are', 'Cushion Holds Tightest 2026-01, $5,000.00 to spare'],
      ['as we are (Job: Go freelance)', 'Cushion Breaks in 2027-01 Tightest 2027-02, $4,545.36 short'],
    ]);
  });

  it('shows none for a plan without guardrails', async () => {
    await pickAndShow(results([undefined]), flip());
    expect(host.querySelector('.guardrails')).toBeNull();
  });
});
