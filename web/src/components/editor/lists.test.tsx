import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyEvent,
  emptyInvestment,
  emptyLoan,
  type EventModel,
  type InvestmentModel,
  type LoanModel,
  type SimulationModel,
} from '../../config/types';
import { EventList } from './EventList';
import { InvestmentList } from './InvestmentList';
import { LoanList } from './LoanList';

const simulation: SimulationModel = {
  startDate: '',
  endDate: '2030-12',
  startingCash: 0,
  emergencyFundMonths: null,
};

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

function click(label: string): void {
  const found = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled "${label}"`);
  found.click();
}

describe('add buttons insert at the top of the list', () => {
  it('EventList prepends the new event', async () => {
    const existing: EventModel = { ...emptyEvent(), name: 'Rent' };
    const onChange = vi.fn<(events: EventModel[]) => void>();
    await act(async () => {
      render(
        <EventList
          title="Events"
          kind="cashflow"
          events={[existing]}
          simulation={simulation}
          onChange={onChange}
        />,
        container,
      );
    });
    await act(async () => click('Add event'));

    const next = onChange.mock.calls[0]![0]!;
    expect(next).toHaveLength(2);
    expect(next[1]!.id).toBe(existing.id);
    expect(next[0]!.name).toBe('');
  });

  it('InvestmentList prepends the new investment', async () => {
    const existing: InvestmentModel = { ...emptyInvestment(), name: 'Index fund' };
    const onChange = vi.fn<(investments: InvestmentModel[]) => void>();
    await act(async () => {
      render(
        <InvestmentList investments={[existing]} simulation={simulation} onChange={onChange} />,
        container,
      );
    });
    await act(async () => click('Add investment'));

    const next = onChange.mock.calls[0]![0]!;
    expect(next).toHaveLength(2);
    expect(next[1]!.id).toBe(existing.id);
  });

  it('LoanList prepends the new loan', async () => {
    const existing: LoanModel = { ...emptyLoan(), name: 'Mortgage' };
    const onChange = vi.fn<(loans: LoanModel[]) => void>();
    await act(async () => {
      render(<LoanList loans={[existing]} simulation={simulation} onChange={onChange} />, container);
    });
    await act(async () => click('Add loan'));

    const next = onChange.mock.calls[0]![0]!;
    expect(next).toHaveLength(2);
    expect(next[1]!.id).toBe(existing.id);
  });
});
