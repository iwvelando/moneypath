/**
 * Choices: a decision the plan faces, its options, and each scenario's pick
 * (spec/03, "Choices"). Everything here edits or describes the plan; resolving
 * a scenario into what is simulated is the engine's job alone.
 *
 * The format refuses a baseline entry changed or removed by two choices, twice
 * by one option, or one it cannot identify by name. `targetCandidates` is how
 * the editor keeps those out of reach instead of only reporting them.
 */

import { formatMoney } from '../util/format';
import {
  cloneScenario,
  emptyChoice,
  emptyOption,
  newId,
  type ChoiceModel,
  type CommonModel,
  type ConfigModel,
  type EntryKind,
  type EventKind,
  type OptionModel,
  type ScenarioModel,
  type TargetRef,
} from './types';

export const ENTRY_KINDS: readonly EntryKind[] = ['events', 'loans', 'investments'];

const KIND_NOUN: Record<EntryKind, string> = { events: 'event', loans: 'loan', investments: 'investment' };

/** "1 event", "2 loans". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/* ------------------------------------------------------------------ */
/* the fields an option can change                                      */
/* ------------------------------------------------------------------ */

export type SetFieldFormat = 'money' | 'percent' | 'months' | 'month' | 'flag' | 'list';

export interface SetField {
  key: string;
  /** The field's label in its form. */
  label: string;
  format: SetFieldFormat;
  /** For a list: what its entries are. */
  eventKind?: EventKind;
}

/** Every field `set` may carry, per kind, in form order. Never `name` or `optimize`. */
export const SET_FIELDS: Record<EntryKind, readonly SetField[]> = {
  events: [
    { key: 'amount', label: 'Amount', format: 'money' },
    { key: 'frequency', label: 'Frequency', format: 'months' },
    { key: 'startDate', label: 'Start month', format: 'month' },
    { key: 'endDate', label: 'End month', format: 'month' },
  ],
  loans: [
    { key: 'principal', label: 'Principal', format: 'money' },
    { key: 'downPayment', label: 'Down payment', format: 'money' },
    { key: 'interestRate', label: 'Interest rate', format: 'percent' },
    { key: 'term', label: 'Term', format: 'months' },
    { key: 'startDate', label: 'First payment', format: 'month' },
    { key: 'escrow', label: 'Escrow', format: 'money' },
    { key: 'mortgageInsurance', label: 'Mortgage insurance', format: 'money' },
    { key: 'mortgageInsuranceCutoff', label: 'MI cutoff', format: 'percent' },
    { key: 'earlyPayoffThreshold', label: 'Early payoff threshold', format: 'money' },
    { key: 'earlyPayoffDate', label: 'Early payoff month', format: 'month' },
    { key: 'sellProperty', label: 'Sell the property at payoff', format: 'flag' },
    { key: 'sellPrice', label: 'Sale price', format: 'money' },
    { key: 'sellCostsNet', label: 'Net selling costs', format: 'money' },
    {
      key: 'extraPrincipalPayments',
      label: 'Extra principal payments',
      format: 'list',
      eventKind: 'extraPrincipalPayment',
    },
  ],
  investments: [
    { key: 'startingValue', label: 'Starting value', format: 'money' },
    { key: 'annualReturnRate', label: 'Annual return', format: 'percent' },
    { key: 'taxRate', label: 'Growth tax rate', format: 'percent' },
    { key: 'withdrawalTaxRate', label: 'Withdrawal tax rate', format: 'percent' },
    { key: 'contributionsFromCash', label: 'Contributions come out of simulated cash', format: 'flag' },
    { key: 'fundLoanPayoffs', label: 'Can fund loan payoffs', format: 'flag' },
    { key: 'contributions', label: 'Contributions', format: 'list', eventKind: 'contribution' },
    { key: 'withdrawals', label: 'Withdrawals', format: 'list', eventKind: 'withdrawal' },
  ],
};

type Fields = Record<string, unknown>;

/** The baseline entry as it stands on a path whose option changes `set`. */
export function effectiveEntry<T extends object>(base: T, set: Partial<T>): T {
  return { ...base, ...set };
}

/**
 * The changed fields after the entry's form reports `next`: every field that
 * moved joins the change, and one already in it stays until it is reset, even
 * when it equals the baseline again.
 */
export function applyEdit<T extends object, S extends Partial<T>>(kind: EntryKind, base: T, set: S, next: T): S {
  const before = effectiveEntry(base, set) as Fields;
  const out: Fields = { ...(set as Fields) };
  for (const field of SET_FIELDS[kind]) {
    const value = (next as Fields)[field.key];
    if (value !== before[field.key]) out[field.key] = value;
  }
  return out as S;
}

/** Hand a field back to the baseline. */
export function resetField<S extends object>(set: S, key: string): S {
  const out: Fields = { ...(set as Fields) };
  delete out[key];
  return out as S;
}

function display(field: SetField, value: unknown): string {
  if (field.format === 'flag') return value === true ? 'Yes' : 'No';
  if (field.format === 'list') {
    const length = Array.isArray(value) ? value.length : 0;
    return length === 0 ? 'None' : length === 1 ? '1 entry' : `${length} entries`;
  }
  if (value === null || value === undefined || value === '') return 'Not set';
  if (field.format === 'money') return formatMoney(value as number);
  if (field.format === 'percent') return `${String(value)}%`;
  if (field.format === 'months') return count(value as number, 'month');
  return String(value);
}

export interface ChangedField {
  key: string;
  label: string;
  /** The value on this path, and the baseline's, as entered. */
  value: string;
  baseline: string;
}

export function changedFields<T extends object>(kind: EntryKind, base: T, set: Partial<T>): ChangedField[] {
  const changed = set as Fields;
  return SET_FIELDS[kind]
    .filter((field) => field.key in changed)
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: display(field, changed[field.key]),
      baseline: display(field, (base as Fields)[field.key]),
    }));
}

/* ------------------------------------------------------------------ */
/* targets                                                              */
/* ------------------------------------------------------------------ */

interface Named {
  id: string;
  name: string;
}

function refsOf(option: OptionModel, kind: EntryKind): TargetRef[] {
  return [...option.change[kind], ...option.remove[kind]];
}

/** The baseline entry a reference points at, if the baseline still has it. */
export function targetEntry<T extends Named>(entries: T[], ref: TargetRef): T | null {
  return ref.targetId === '' ? null : (entries.find((entry) => entry.id === ref.targetId) ?? null);
}

/** The name a reference is written under: the entry's own while it exists. */
export function targetName(common: CommonModel, kind: EntryKind, ref: TargetRef): string {
  return targetEntry<Named>(common[kind], ref)?.name.trim() ?? ref.targetName;
}

function linkRef<R extends TargetRef>(entries: Named[], ref: R): R {
  const entry = targetEntry(entries, ref);
  if (entry) {
    const name = entry.name.trim();
    return name === ref.targetName ? ref : { ...ref, targetName: name };
  }
  // Not in the baseline (deleted, or misspelt in a file): adopt an entry that
  // has exactly this name, otherwise keep the name for the engine to report.
  const matches = ref.targetName === '' ? [] : entries.filter((e) => e.name.trim() === ref.targetName);
  const targetId = matches.length === 1 ? matches[0]!.id : '';
  return targetId === ref.targetId ? ref : { ...ref, targetId };
}

/**
 * Bring every option's targets in step with the baseline: remember the current
 * name of each entry they point at, and point a dangling one at the entry that
 * now carries its name. Run after reading a plan and after the baseline changes.
 */
export function linkTargets(config: ConfigModel): ConfigModel {
  const link = <R extends TargetRef>(kind: EntryKind, refs: R[]): R[] =>
    refs.map((ref) => linkRef(config.common[kind], ref));
  return {
    ...config,
    choices: config.choices.map((choice) => ({
      ...choice,
      options: choice.options.map((option) => ({
        ...option,
        change: {
          events: link('events', option.change.events),
          loans: link('loans', option.change.loans),
          investments: link('investments', option.change.investments),
        },
        remove: {
          events: link('events', option.remove.events),
          loans: link('loans', option.remove.loans),
          investments: link('investments', option.remove.investments),
        },
      })),
    })),
  };
}

export interface TargetCandidate {
  kind: EntryKind;
  id: string;
  /** The entry's name, or its position when it has none. */
  name: string;
  /** Why this option cannot change or remove the entry, or null when it can. */
  unavailable: string | null;
}

const POSITION_LABEL: Record<EntryKind, string> = { events: 'Event', loans: 'Loan', investments: 'Investment' };

/** Every baseline entry, with the reason it cannot be targeted by this option, if any. */
export function targetCandidates(config: ConfigModel, choiceId: string, optionId: string): TargetCandidate[] {
  const out: TargetCandidate[] = [];
  for (const kind of ENTRY_KINDS) {
    const entries: Named[] = config.common[kind];
    const ownedBy = new Map<string, ChoiceModel>();
    const mine = new Set<string>();
    for (const choice of config.choices) {
      for (const option of choice.options) {
        for (const ref of refsOf(option, kind)) {
          if (!targetEntry(entries, ref)) continue;
          if (option.id === optionId) mine.add(ref.targetId);
          if (choice.id !== choiceId) ownedBy.set(ref.targetId, choice);
        }
      }
    }
    entries.forEach((entry, index) => {
      const name = entry.name.trim();
      const owner = ownedBy.get(entry.id);
      let unavailable: string | null = null;
      if (name === '') {
        unavailable = 'Give it a name in the baseline first.';
      } else if (entries.filter((other) => other.name.trim() === name).length > 1) {
        unavailable = `The baseline has more than one ${KIND_NOUN[kind]} with this name.`;
      } else if (mine.has(entry.id)) {
        unavailable = 'This option already changes or removes it.';
      } else if (owner) {
        unavailable = `The choice ${owner.name.trim() || 'without a name'} already changes or removes it.`;
      }
      out.push({ kind, id: entry.id, name: name || `${POSITION_LABEL[kind]} ${index + 1}`, unavailable });
    });
  }
  return out;
}

/** A fresh reference to a baseline entry, for a new change or removal. */
export function newTarget(entry: Named): TargetRef {
  return { id: newId('tg'), targetId: entry.id, targetName: entry.name.trim() };
}

/* ------------------------------------------------------------------ */
/* choices, options and who selects them                                */
/* ------------------------------------------------------------------ */

function freshName(prefix: string, taken: string[]): string {
  let n = taken.length + 1;
  while (taken.includes(`${prefix} ${n}`)) n += 1;
  return `${prefix} ${n}`;
}

/**
 * A new choice with one option that changes nothing, selected by every
 * scenario: each scenario must pick for every choice, and this way no
 * forecast moves until the choice is given something to do.
 */
export function addChoice(config: ConfigModel): ConfigModel {
  const choice = emptyChoice(freshName('Choice', config.choices.map((c) => c.name.trim())));
  const option = emptyOption('Option 1');
  choice.options = [option];
  return {
    ...config,
    choices: [...config.choices, choice],
    scenarios: config.scenarios.map((scenario) => ({
      ...scenario,
      select: { ...scenario.select, [choice.id]: option.id },
    })),
  };
}

export function removeChoice(config: ConfigModel, choiceId: string): ConfigModel {
  return {
    ...config,
    choices: config.choices.filter((choice) => choice.id !== choiceId),
    scenarios: config.scenarios.map((scenario) => {
      const select = { ...scenario.select };
      delete select[choiceId];
      return { ...scenario, select };
    }),
  };
}

export function addOption(config: ConfigModel, choiceId: string): ConfigModel {
  return {
    ...config,
    choices: config.choices.map((choice) =>
      choice.id === choiceId
        ? {
            ...choice,
            options: [
              ...choice.options,
              emptyOption(freshName('Option', choice.options.map((o) => o.name.trim()))),
            ],
          }
        : choice,
    ),
  };
}

/** The scenarios that pick this option, in the plan's order. */
export function optionUsers(config: ConfigModel, choiceId: string, optionId: string): ScenarioModel[] {
  return config.scenarios.filter((scenario) => scenario.select[choiceId] === optionId);
}

/** Whether the option can go: a choice keeps one option, and a scenario's pick is never pulled from under it. */
export function canRemoveOption(config: ConfigModel, choiceId: string, optionId: string): boolean {
  const choice = config.choices.find((candidate) => candidate.id === choiceId);
  if (!choice || choice.options.length <= 1) return false;
  return optionUsers(config, choiceId, optionId).length === 0;
}

export function removeOption(config: ConfigModel, choiceId: string, optionId: string): ConfigModel {
  if (!canRemoveOption(config, choiceId, optionId)) return config;
  return {
    ...config,
    choices: config.choices.map((choice) =>
      choice.id === choiceId
        ? { ...choice, options: choice.options.filter((option) => option.id !== optionId) }
        : choice,
    ),
  };
}

/** "Used by: sell, later (inactive)", or that nothing picks the option. */
export function usedBy(config: ConfigModel, choiceId: string, optionId: string): string {
  const users = optionUsers(config, choiceId, optionId);
  if (users.length === 0) return 'No scenario picks this yet';
  const names = users.map((scenario) => {
    const name = scenario.name.trim() || `Scenario ${config.scenarios.indexOf(scenario) + 1}`;
    return scenario.active ? name : `${name} (inactive)`;
  });
  return `Used by: ${names.join(', ')}`;
}

export interface OptionSummary {
  primary: string;
  detail: string;
  attention: boolean;
}

/** What an option does and who uses it, for its collapsed entry. */
export function describeOption(config: ConfigModel, choiceId: string, option: OptionModel): OptionSummary {
  const adds = ENTRY_KINDS.filter((kind) => option[kind].length > 0).map((kind) =>
    count(option[kind].length, KIND_NOUN[kind]),
  );
  const names = (refs: (kind: EntryKind) => TargetRef[]) =>
    ENTRY_KINDS.flatMap((kind) => refs(kind).map((ref) => targetName(config.common, kind, ref) || 'an unnamed entry'));
  const changes = names((kind) => option.change[kind]);
  const removes = names((kind) => option.remove[kind]);
  const parts = [
    adds.length ? `Adds ${adds.join(', ')}` : '',
    changes.length ? `Changes ${changes.join(', ')}` : '',
    removes.length ? `Removes ${removes.join(', ')}` : '',
  ].filter(Boolean);
  const dangling = ENTRY_KINDS.some((kind) =>
    refsOf(option, kind).some((ref) => !targetEntry<Named>(config.common[kind], ref)),
  );
  return {
    primary: parts.length ? parts.join(' · ') : 'Changes nothing',
    detail: usedBy(config, choiceId, option.id),
    attention: dangling || option.name.trim() === '',
  };
}

/* ------------------------------------------------------------------ */
/* flipping one choice                                                  */
/* ------------------------------------------------------------------ */

export interface FlipOption {
  id: string;
  /** As the engine reads it. */
  name: string;
}

/** A choice a scenario could take differently: what it picks now, and what else there is. */
export interface FlipChoice {
  id: string;
  name: string;
  current: FlipOption;
  others: FlipOption[];
}

export interface FlipSubject {
  scenarioId: string;
  choices: FlipChoice[];
}

/**
 * What can be flipped for one scenario of a forecast. The engine reports the
 * plan's active scenarios in plan order, so `activeIndex` is the scenario's
 * position in the results. Names are trimmed as the plan is written, since
 * they are what a flip is asked for by.
 */
export function flipSubject(plan: ConfigModel, activeIndex: number): FlipSubject | null {
  const scenario = plan.scenarios.filter((candidate) => candidate.active)[activeIndex];
  if (!scenario) return null;
  const choices: FlipChoice[] = [];
  for (const choice of plan.choices) {
    const current = choice.options.find((option) => option.id === scenario.select[choice.id]);
    if (!current) continue;
    const others = choice.options
      .filter((option) => option !== current)
      .map((option) => ({ id: option.id, name: option.name.trim() }));
    if (others.length === 0) continue;
    choices.push({
      id: choice.id,
      name: choice.name.trim(),
      current: { id: current.id, name: current.name.trim() },
      others,
    });
  }
  return { scenarioId: scenario.id, choices };
}

/**
 * The plan with a scenario's flipped path added after it: a copy of the
 * scenario picking `optionId` for `choiceId`. `name` gains a number when
 * another scenario already has it. Null when the scenario, the choice or the
 * option is no longer in the plan.
 */
export function keepFlippedScenario(
  config: ConfigModel,
  scenarioId: string,
  choiceId: string,
  optionId: string,
  name: string,
): ConfigModel | null {
  const index = config.scenarios.findIndex((scenario) => scenario.id === scenarioId);
  const scenario = config.scenarios[index];
  const choice = config.choices.find((candidate) => candidate.id === choiceId);
  if (!scenario || !choice || !choice.options.some((option) => option.id === optionId)) return null;

  const taken = new Set(config.scenarios.map((candidate) => candidate.name.trim()));
  let unique = name;
  for (let n = 2; taken.has(unique); n += 1) unique = `${name} ${n}`;

  const kept: ScenarioModel = {
    ...cloneScenario(scenario),
    name: unique,
    select: { ...scenario.select, [choiceId]: optionId },
  };
  return {
    ...config,
    scenarios: [...config.scenarios.slice(0, index + 1), kept, ...config.scenarios.slice(index + 1)],
  };
}
