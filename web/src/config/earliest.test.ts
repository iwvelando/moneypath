import { describe, expect, it } from 'vitest';
import { earliestSubject } from './earliest';
import { fromConfigDocument } from './serialize';

// One entry of every origin: the baseline (one left alone, one an option
// changes, one an option removes), an option picked and one not picked, and
// each scenario's own, behind an inactive scenario so positions are the plan's.
const plan = () =>
  fromConfigDocument({
    version: 2,
    simulation: { startDate: '2026-01', endDate: '2030-12' },
    guardrails: [{ name: 'Cushion', kind: 'cashFloor', amount: 500 }],
    common: {
      events: [
        { name: 'Salary', amount: 5000, endDate: '2029-06' },
        { name: 'Rent', amount: -1500 },
        { name: 'Gym', amount: -50 },
        { amount: -10, startDate: '2027-03', endDate: '2027-03' },
      ],
      loans: [{ name: 'Mortgage', principal: 1, interestRate: 1, term: 12, startDate: '2026-01' }],
    },
    choices: [
      {
        name: 'Car',
        options: [
          { name: 'No car', remove: { events: ['Gym'] } },
          {
            name: 'Buy',
            loans: [{ name: 'Car', principal: 1, interestRate: 1, term: 12, startDate: '2027-01' }],
            change: { events: [{ name: 'Rent', set: { startDate: '2027-05', endDate: '2027-05' } }] },
          },
        ],
      },
    ],
    scenarios: [
      { name: 'parked', active: false, select: { Car: 'Buy' }, events: [{ name: 'Parked', amount: -1 }] },
      {
        name: 'walk',
        select: { Car: 'No car' },
        events: [{ name: 'Roof', amount: -6000, startDate: '2028-06', endDate: '2028-06' }],
        loans: [{ name: 'Bike', principal: 1, interestRate: 1, term: 6, startDate: '2026-03' }],
      },
      { name: 'drive', select: { Car: 'Buy' } },
    ],
  });

describe('what an earliest-month question can move', () => {
  it('lists the entries on the scenario’s path, by their place in the plan', () => {
    const subject = earliestSubject(plan(), 0)!;
    expect(subject.scenarioName).toBe('walk');
    expect(subject.targets.map((t) => [t.group, t.entry, t.field, t.label])).toEqual([
      ['This scenario', 'scenarios.1.events.0', 'startDate', 'Roof: when it happens'],
      ['This scenario', 'scenarios.1.loans.0', 'startDate', 'Bike: when it starts'],
      ['Baseline', 'common.events.0', 'startDate', 'Salary: when it starts'],
      ['Baseline', 'common.events.0', 'endDate', 'Salary: when it ends'],
      ['Baseline', 'common.events.1', 'startDate', 'Rent: when it starts'],
      ['Baseline', 'common.events.1', 'endDate', 'Rent: when it ends'],
      ['Baseline', 'common.events.3', 'startDate', 'Event 4: when it happens'],
      ['Baseline', 'common.loans.0', 'startDate', 'Mortgage: when it starts'],
    ]);
  });

  it('takes an option’s entries only on a path that picks it, and the baseline as the option changes it', () => {
    const subject = earliestSubject(plan(), 1)!;
    expect(subject.scenarioName).toBe('drive');
    expect(subject.targets.map((t) => [t.group, t.entry, t.field, t.label])).toEqual([
      ['Car: Buy', 'choices.0.options.1.loans.0', 'startDate', 'Car: when it starts'],
      ['Baseline', 'common.events.0', 'startDate', 'Salary: when it starts'],
      ['Baseline', 'common.events.0', 'endDate', 'Salary: when it ends'],
      // A one-off on this path, as the option makes it.
      ['Baseline', 'common.events.1', 'startDate', 'Rent: when it happens'],
      ['Baseline', 'common.events.2', 'startDate', 'Gym: when it starts'],
      ['Baseline', 'common.events.2', 'endDate', 'Gym: when it ends'],
      ['Baseline', 'common.events.3', 'startDate', 'Event 4: when it happens'],
      ['Baseline', 'common.loans.0', 'startDate', 'Mortgage: when it starts'],
    ]);
  });

  it('keeps the months each entry has on the path as written, for the range to start from', () => {
    const subject = earliestSubject(plan(), 1)!;
    const salary = subject.targets.find((t) => t.entry === 'common.events.0' && t.field === 'endDate')!;
    expect([salary.start, salary.end]).toEqual(['', '2029-06']);
    const rent = subject.targets.find((t) => t.entry === 'common.events.1')!;
    expect([rent.start, rent.end]).toEqual(['2027-05', '2027-05']);
  });

  it('has nothing to offer for a position no active scenario has', () => {
    expect(earliestSubject(plan(), 2)).toBeNull();
  });
});
