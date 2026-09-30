import { render } from 'preact';
import { useState } from 'preact/hooks';
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
  cashInterestRate: null, emergencyFundMonths: null,
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


function EventHarness() {
  const [events, setEvents] = useState<EventModel[]>([
    { ...emptyEvent(), name: 'Rent', amount: -2000 },
    { ...emptyEvent(), name: 'Pay', amount: 4000 },
  ]);
  return <EventList title="Events" kind="cashflow" events={events} simulation={simulation} onChange={setEvents} />;
}

function card(name: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>('.editor-card'))
    .find((el) => el.querySelector('.editor-card__title')?.textContent === name);
  if (!found) throw new Error(`Missing card ${name}`);
  return found;
}

async function toggleCard(name: string) {
  await act(async () => card(name).querySelector<HTMLButtonElement>('.editor-card__toggle')!.click());
}

describe('summary-first editors', () => {
  it('starts compact and allows several forms to stay open independently', async () => {
    await act(async () => render(<EventHarness />, container));
    expect(card('Rent').querySelector<HTMLElement>('.editor-card__body')!.hidden).toBe(true);
    expect(card('Rent').querySelector('.editor-card__summary')?.textContent).toContain('-$2,000.00');
    await toggleCard('Rent');
    await toggleCard('Pay');
    expect(container.querySelectorAll('.editor-card__body:not([hidden])')).toHaveLength(2);
    await toggleCard('Rent');
    expect(card('Pay').querySelector<HTMLElement>('.editor-card__body')!.hidden).toBe(false);
  });
  it('treats expanding and collapsing as presentation only', async () => {
    const onChange = vi.fn();
    await act(async () => render(<EventList title="Events" kind="cashflow" events={[{ ...emptyEvent(), name: 'Rent' }]} simulation={simulation} onChange={onChange} />, container));
    await toggleCard('Rent');
    await act(async () => click('Collapse all'));
    await act(async () => click('Expand all'));
    expect(onChange).not.toHaveBeenCalled();
  });
  it('supports expanding and collapsing the whole list', async () => {
    await act(async () => render(<EventHarness />, container));
    await act(async () => click('Expand all'));
    expect(container.querySelectorAll('.editor-card__body:not([hidden])')).toHaveLength(2);
    await act(async () => click('Collapse all'));
    expect(container.querySelectorAll('.editor-card__body:not([hidden])')).toHaveLength(0);
  });
  it('opens a new item and focuses its name without expanding its neighbours', async () => {
    await act(async () => render(<EventHarness />, container));
    await act(async () => click('Add event'));
    const first = container.querySelector('.editor-card')!;
    expect(first.querySelector<HTMLElement>('.editor-card__body')!.hidden).toBe(false);
    expect(document.activeElement).toBe(first.querySelector('input'));
    expect(card('Rent').querySelector<HTMLElement>('.editor-card__body')!.hidden).toBe(true);
  });
  it('opens a duplicate with independent identity and focuses its name', async () => {
    await act(async () => render(<EventHarness />, container));
    await toggleCard('Rent');
    await act(async () => card('Rent').querySelector<HTMLButtonElement>('[aria-label="Duplicate Rent"]')!.click());
    const cards = container.querySelectorAll('.editor-card');
    expect(cards).toHaveLength(3);
    expect(cards[0]!.id).not.toBe(cards[1]!.id);
    expect(document.activeElement).toBe(cards[1]!.querySelector('input'));
    expect(cards[1]!.querySelector<HTMLElement>('.editor-card__body')!.hidden).toBe(false);
  });
  it('reveals a collapsed event when an optimizer jump requests it', async () => {
    await act(async () => render(<EventHarness />, container));
    await act(async () => {
      card('Rent').dispatchEvent(new Event('editor:reveal'));
      card('Rent').focus();
    });
    expect(card('Rent').querySelector<HTMLElement>('.editor-card__body')!.hidden).toBe(false);
  });
  it('keeps edits when collapsing and reopening', async () => {
    await act(async () => render(<EventHarness />, container));
    await toggleCard('Rent');
    const input = card('Rent').querySelectorAll('input')[1]!;
    await act(async () => {
      input.value = '-2500';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await toggleCard('Rent');
    expect(card('Rent').querySelector('.editor-card__summary')?.textContent).toContain('-$2,500.00');
    await toggleCard('Rent');
    expect(card('Rent').querySelectorAll('input')[1]!.value).toBe('-2500');
  });
});
