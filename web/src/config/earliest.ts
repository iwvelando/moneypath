import { effectiveEntry } from './choices';
import type { ConfigModel, EventModel, LoanModel } from './types';

/**
 * One month an earliest-month question can move: an event's start or end, a
 * one-off event as a whole, or a loan's start. `entry` is the entry's place
 * in the plan as written, as the engine expects it.
 */
export interface EarliestTarget {
  key: string;
  /** Where the entry comes from on the path, for grouping the choices. */
  group: string;
  entry: string;
  field: 'startDate' | 'endDate';
  label: string;
  /** The entry's months on the path as written; '' where the plan leaves one out. */
  start: string;
  end: string;
}

export interface EarliestSubject {
  scenarioName: string;
  targets: EarliestTarget[];
}

/** An entry as the path has it, with its position in the list it is written in. */
interface Placed<T> {
  entry: T;
  index: number;
}

function entryName(name: string, noun: string, index: number): string {
  return name.trim() || `${noun} ${index + 1}`;
}

function eventTargets(group: string, base: string, events: Placed<EventModel>[]): EarliestTarget[] {
  return events.flatMap(({ entry: event, index }) => {
    const name = entryName(event.name, 'Event', index);
    const entry = `${base}.events.${index}`;
    const common = { group, entry, start: event.startDate, end: event.endDate };
    // The engine moves a one-off as a whole, whichever month is asked.
    if (event.startDate !== '' && event.startDate === event.endDate) {
      return [{ ...common, key: `${entry}|startDate`, field: 'startDate' as const, label: `${name}: when it happens` }];
    }
    return [
      { ...common, key: `${entry}|startDate`, field: 'startDate' as const, label: `${name}: when it starts` },
      { ...common, key: `${entry}|endDate`, field: 'endDate' as const, label: `${name}: when it ends` },
    ];
  });
}

function loanTargets(group: string, base: string, loans: Placed<LoanModel>[]): EarliestTarget[] {
  return loans.map(({ entry: loan, index }) => {
    const entry = `${base}.loans.${index}`;
    return {
      key: `${entry}|startDate`,
      group,
      entry,
      field: 'startDate',
      label: `${entryName(loan.name, 'Loan', index)}: when it starts`,
      start: loan.startDate,
      end: '',
    };
  });
}

const placed = <T,>(list: T[]): Placed<T>[] => list.map((entry, index) => ({ entry, index }));

/**
 * The events and loans on an active scenario's path, in the order the path
 * gathers them: its own, those of the options it picks, then the baseline's
 * that no picked option removes, as a picked option changes them. Null when
 * no active scenario is at that position. Nothing here decides an answer;
 * the engine checks the question again.
 */
export function earliestSubject(plan: ConfigModel, activeIndex: number): EarliestSubject | null {
  const scenario = plan.scenarios.filter((candidate) => candidate.active)[activeIndex];
  if (!scenario) return null;
  const own = `scenarios.${plan.scenarios.indexOf(scenario)}`;
  const targets: EarliestTarget[] = [
    ...eventTargets('This scenario', own, placed(scenario.events)),
    ...loanTargets('This scenario', own, placed(scenario.loans)),
  ];

  const picked = plan.choices.flatMap((choice, c) => {
    const o = choice.options.findIndex((option) => option.id === scenario.select[choice.id]);
    const option = choice.options[o];
    return option ? [{ group: `${choice.name.trim()}: ${option.name.trim()}`, option, base: `choices.${c}.options.${o}` }] : [];
  });
  for (const { group, option, base } of picked) {
    targets.push(...eventTargets(group, base, placed(option.events)));
    targets.push(...loanTargets(group, base, placed(option.loans)));
  }

  // The baseline as the picked options leave it.
  const removed = (kind: 'events' | 'loans', id: string) =>
    picked.some(({ option }) => option.remove[kind].some((target) => target.targetId === id));
  const baselineEvents: Placed<EventModel>[] = [];
  plan.common.events.forEach((event, index) => {
    if (removed('events', event.id)) return;
    let entry = event;
    for (const { option } of picked) {
      const change = option.change.events.find((candidate) => candidate.targetId === event.id);
      if (change) entry = effectiveEntry<EventModel>(entry, change.set);
    }
    baselineEvents.push({ entry, index });
  });
  const baselineLoans: Placed<LoanModel>[] = [];
  plan.common.loans.forEach((loan, index) => {
    if (removed('loans', loan.id)) return;
    let entry = loan;
    for (const { option } of picked) {
      const change = option.change.loans.find((candidate) => candidate.targetId === loan.id);
      if (change) entry = effectiveEntry<LoanModel>(entry, change.set);
    }
    baselineLoans.push({ entry, index });
  });
  targets.push(...eventTargets('Baseline', 'common', baselineEvents));
  targets.push(...loanTargets('Baseline', 'common', baselineLoans));
  return { scenarioName: scenario.name.trim(), targets };
}
