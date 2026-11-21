/**
 * Editor model <-> v2 config document.
 *
 * The engine is the only thing that produces canonical YAML (`configYaml` in
 * the results), so the editor only ever *builds* a plain JS document and hands
 * it to the bridge. JSON is a subset of YAML, so `JSON.stringify` of the
 * document below is a valid config for `moneypathForecast`.
 */

import { ENTRY_KINDS, SET_FIELDS, linkTargets, targetName } from './choices';
import {
  type ChoiceModel,
  type CommonModel,
  type ConfigModel,
  type EntryKind,
  type EventKind,
  type EventModel,
  type GrowthModel,
  type GuardrailModel,
  type InvestmentModel,
  type LoanModel,
  type OptimizeField,
  type OptimizeModel,
  type OptionModel,
  type ScenarioModel,
  type TargetRef,
  emptyChoice,
  emptyEvent,
  emptyGrowth,
  emptyGuardrail,
  emptyInvestment,
  emptyLoan,
  emptyOption,
  emptyScenario,
  cloneGuardrail,
  newId,
} from './types';

export const CONFIG_VERSION = 2;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/* ------------------------------------------------------------------ */
/* model -> document                                                    */
/* ------------------------------------------------------------------ */

function put(target: JsonObject, key: string, value: Json | null | undefined): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' && value === '') return;
  target[key] = value;
}

/**
 * A growth as the document writes it: left out when fixed, the word for
 * inflation, the rate as a number, and anything else as written. A rate not
 * yet entered is left out too; its field reports that, and holds the run.
 */
export function serializeGrowth(growth: GrowthModel): Json | null {
  switch (growth.mode) {
    case 'fixed':
      return null;
    case 'inflation':
      return 'inflation';
    case 'rate':
      return growth.rate;
    default:
      return growth.mode;
  }
}

/** A growth as written in a document; an absent one is fixed. */
export function parseGrowth(value: unknown): GrowthModel {
  if (value === undefined || value === null || value === 'fixed') return emptyGrowth();
  if (value === 'inflation') return { mode: 'inflation', rate: null };
  if (typeof value === 'number' && Number.isFinite(value)) return { mode: 'rate', rate: value };
  return { mode: typeof value === 'string' ? value : JSON.stringify(value), rate: null };
}

function serializeOptimize(optimize: OptimizeModel): JsonObject {
  const out: JsonObject = { field: optimize.field };
  if (optimize.field === 'amount' || optimize.field === 'frequency') {
    put(out, 'min', optimize.min);
    put(out, 'max', optimize.max);
  } else {
    put(out, 'minDate', optimize.minDate);
    put(out, 'maxDate', optimize.maxDate);
  }
  put(out, 'tolerance', optimize.tolerance);
  put(out, 'maxIterations', optimize.maxIterations);
  put(out, 'guardrail', optimize.guardrail.trim());
  return out;
}

export function serializeEvent(event: EventModel, kind: EventKind): JsonObject {
  const out: JsonObject = {};
  put(out, 'name', event.name.trim());
  if (kind === 'withdrawal' && event.percentage !== null) {
    put(out, 'percentage', event.percentage);
  } else {
    put(out, 'amount', event.amount);
  }
  put(out, 'growth', serializeGrowth(event.growth));
  put(out, 'frequency', event.frequency);
  put(out, 'startDate', event.startDate.trim());
  put(out, 'endDate', event.endDate.trim());
  if (kind === 'cashflow' && event.optimize) {
    out['optimize'] = serializeOptimize(event.optimize);
  }
  return out;
}

export function serializeLoan(loan: LoanModel): JsonObject {
  const out: JsonObject = {};
  put(out, 'name', loan.name.trim());
  put(out, 'principal', loan.principal);
  put(out, 'downPayment', loan.downPayment);
  put(out, 'interestRate', loan.interestRate);
  put(out, 'term', loan.term);
  put(out, 'startDate', loan.startDate.trim());
  put(out, 'escrow', loan.escrow);
  put(out, 'escrowGrowth', serializeGrowth(loan.escrowGrowth));
  put(out, 'mortgageInsurance', loan.mortgageInsurance);
  put(out, 'mortgageInsuranceCutoff', loan.mortgageInsuranceCutoff);
  put(out, 'earlyPayoffThreshold', loan.earlyPayoffThreshold);
  put(out, 'earlyPayoffDate', loan.earlyPayoffDate.trim());
  if (loan.sellProperty) {
    out['sellProperty'] = true;
    put(out, 'sellPrice', loan.sellPrice);
    put(out, 'sellCostsNet', loan.sellCostsNet);
  }
  if (loan.extraPrincipalPayments.length > 0) {
    out['extraPrincipalPayments'] = loan.extraPrincipalPayments.map((e) =>
      serializeEvent(e, 'extraPrincipalPayment'),
    );
  }
  return out;
}

export function serializeInvestment(investment: InvestmentModel): JsonObject {
  const out: JsonObject = {};
  put(out, 'name', investment.name.trim());
  put(out, 'startingValue', investment.startingValue);
  put(out, 'annualReturnRate', investment.annualReturnRate);
  put(out, 'taxRate', investment.taxRate);
  put(out, 'withdrawalTaxRate', investment.withdrawalTaxRate);
  if (investment.contributionsFromCash) out['contributionsFromCash'] = true;
  if (investment.fundLoanPayoffs) out['fundLoanPayoffs'] = true;
  if (investment.contributions.length > 0) {
    out['contributions'] = investment.contributions.map((e) => serializeEvent(e, 'contribution'));
  }
  if (investment.withdrawals.length > 0) {
    out['withdrawals'] = investment.withdrawals.map((e) => serializeEvent(e, 'withdrawal'));
  }
  return out;
}

/** A guardrail's keys in canonical order (spec/03, Guardrails). */
export function serializeGuardrail(guardrail: GuardrailModel): JsonObject {
  const out: JsonObject = {};
  put(out, 'name', guardrail.name.trim());
  put(out, 'kind', guardrail.kind.trim());
  put(out, 'amount', guardrail.amount);
  put(out, 'growth', serializeGrowth(guardrail.growth));
  if (guardrail.investments !== null) out['investments'] = [...guardrail.investments];
  if (guardrail.loans !== null) out['loans'] = [...guardrail.loans];
  put(out, 'startDate', guardrail.startDate.trim());
  put(out, 'endDate', guardrail.endDate.trim());
  return out;
}

/** The fields an option changes, with an emptied field written as null: taken away. */
function serializeSet(kind: EntryKind, set: object): JsonObject {
  const values = set as Record<string, unknown>;
  const out: JsonObject = {};
  for (const field of SET_FIELDS[kind]) {
    if (!(field.key in values)) continue;
    const value = values[field.key];
    if (field.format === 'list') {
      out[field.key] = (value as EventModel[]).map((e) => serializeEvent(e, field.eventKind!));
    } else if (field.format === 'flag') {
      out[field.key] = value === true;
    } else if (field.format === 'month') {
      out[field.key] = (value as string).trim() || null;
    } else if (field.format === 'growth') {
      out[field.key] = serializeGrowth(value as GrowthModel);
    } else {
      out[field.key] = (value as number | null) ?? null;
    }
  }
  return out;
}

function serializeOption(option: OptionModel, common: CommonModel): JsonObject {
  const out: JsonObject = { name: option.name.trim() };
  if (option.events.length > 0) out['events'] = option.events.map((e) => serializeEvent(e, 'cashflow'));
  if (option.loans.length > 0) out['loans'] = option.loans.map(serializeLoan);
  if (option.investments.length > 0) out['investments'] = option.investments.map(serializeInvestment);

  const change: JsonObject = {};
  const remove: JsonObject = {};
  for (const kind of ENTRY_KINDS) {
    const changes: (TargetRef & { set: object })[] = option.change[kind];
    if (changes.length > 0) {
      change[kind] = changes.map((entry) => ({
        name: targetName(common, kind, entry),
        set: serializeSet(kind, entry.set),
      }));
    }
    if (option.remove[kind].length > 0) {
      remove[kind] = option.remove[kind].map((ref) => targetName(common, kind, ref));
    }
  }
  if (Object.keys(change).length > 0) out['change'] = change;
  if (Object.keys(remove).length > 0) out['remove'] = remove;
  return out;
}

function serializeScenario(scenario: ScenarioModel, choices: ChoiceModel[]): JsonObject {
  const out: JsonObject = { name: scenario.name.trim(), active: scenario.active };
  // Written in choice order. A choice the scenario picks nothing for is left
  // out, so the engine names it; the editor never guesses a pick.
  const select: JsonObject = Object.create(null) as JsonObject;
  for (const choice of choices) {
    const option = choice.options.find((candidate) => candidate.id === scenario.select[choice.id]);
    if (option) select[choice.name.trim()] = option.name.trim();
  }
  if (Object.keys(select).length > 0) out['select'] = select;
  if (scenario.events.length > 0) {
    out['events'] = scenario.events.map((e) => serializeEvent(e, 'cashflow'));
  }
  if (scenario.loans.length > 0) out['loans'] = scenario.loans.map(serializeLoan);
  if (scenario.investments.length > 0) {
    out['investments'] = scenario.investments.map(serializeInvestment);
  }
  return out;
}

/** Build the v2 config document the engine will parse. */
export function toConfigDocument(model: ConfigModel): JsonObject {
  const simulation: JsonObject = {};
  put(simulation, 'startDate', model.simulation.startDate.trim());
  put(simulation, 'endDate', model.simulation.endDate.trim());
  put(simulation, 'startingCash', model.simulation.startingCash);
  put(simulation, 'cashInterestRate', model.simulation.cashInterestRate);
  put(simulation, 'inflationRate', model.simulation.inflationRate);

  const doc: JsonObject = { version: CONFIG_VERSION, simulation };

  if (model.simulation.emergencyFundMonths !== null) {
    doc['recommendations'] = { emergencyFundMonths: model.simulation.emergencyFundMonths };
  }

  if (model.guardrails.length > 0) doc['guardrails'] = model.guardrails.map(serializeGuardrail);

  const common: JsonObject = {};
  if (model.common.events.length > 0) {
    common['events'] = model.common.events.map((e) => serializeEvent(e, 'cashflow'));
  }
  if (model.common.loans.length > 0) common['loans'] = model.common.loans.map(serializeLoan);
  if (model.common.investments.length > 0) {
    common['investments'] = model.common.investments.map(serializeInvestment);
  }
  if (Object.keys(common).length > 0) doc['common'] = common;

  if (model.choices.length > 0) {
    doc['choices'] = model.choices.map((choice) => ({
      name: choice.name.trim(),
      options: choice.options.map((option) => serializeOption(option, model.common)),
    }));
  }

  doc['scenarios'] = model.scenarios.map((scenario) => serializeScenario(scenario, model.choices));
  return doc;
}

/** The config string handed to `moneypathForecast` (JSON is valid YAML). */
export function toConfigYaml(model: ConfigModel): string {
  return JSON.stringify(toConfigDocument(model), null, 2);
}

/* ------------------------------------------------------------------ */
/* document -> model                                                    */
/* ------------------------------------------------------------------ */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) {
    return `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(
      value.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
  }
  return '';
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(true|yes|on)$/i.test(value)) return true;
    if (/^(false|no|off)$/i.test(value)) return false;
  }
  return fallback;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const OPTIMIZE_FIELDS: Record<string, OptimizeField> = {
  amount: 'amount',
  frequency: 'frequency',
  startdate: 'startDate',
  start_date: 'startDate',
  'start-date': 'startDate',
  enddate: 'endDate',
  end_date: 'endDate',
  'end-date': 'endDate',
};

/** Chapter 03 accepts several spellings of the date fields, case-insensitively. */
export function normalizeOptimizeField(raw: string): OptimizeField | null {
  return OPTIMIZE_FIELDS[raw.trim().toLowerCase()] ?? null;
}

function parseOptimize(value: unknown): OptimizeModel | null {
  if (!isObject(value)) return null;
  const field = normalizeOptimizeField(readString(value['field'])) ?? 'amount';
  return {
    field,
    min: readNumber(value['min']),
    max: readNumber(value['max']),
    minDate: readString(value['minDate']),
    maxDate: readString(value['maxDate']),
    tolerance: readNumber(value['tolerance']),
    maxIterations: readNumber(value['maxIterations']),
    guardrail: readString(value['guardrail']),
  };
}

export function parseEvent(value: unknown, kind: EventKind): EventModel {
  const event = emptyEvent();
  if (!isObject(value)) return event;
  event.name = readString(value['name']);
  event.amount = readNumber(value['amount']);
  event.growth = parseGrowth(value['growth']);
  event.percentage = kind === 'withdrawal' ? readNumber(value['percentage']) : null;
  event.frequency = readNumber(value['frequency']);
  event.startDate = readString(value['startDate']);
  event.endDate = readString(value['endDate']);
  event.optimize = kind === 'cashflow' ? parseOptimize(value['optimize']) : null;
  return event;
}

export function parseLoan(value: unknown): LoanModel {
  const loan = emptyLoan();
  if (!isObject(value)) return loan;
  loan.name = readString(value['name']);
  loan.principal = readNumber(value['principal']);
  loan.downPayment = readNumber(value['downPayment']);
  loan.interestRate = readNumber(value['interestRate']);
  loan.term = readNumber(value['term']);
  loan.startDate = readString(value['startDate']);
  loan.escrow = readNumber(value['escrow']);
  loan.escrowGrowth = parseGrowth(value['escrowGrowth']);
  loan.mortgageInsurance = readNumber(value['mortgageInsurance']);
  loan.mortgageInsuranceCutoff = readNumber(value['mortgageInsuranceCutoff']);
  loan.earlyPayoffThreshold = readNumber(value['earlyPayoffThreshold']);
  loan.earlyPayoffDate = readString(value['earlyPayoffDate']);
  loan.sellProperty = readBool(value['sellProperty']);
  loan.sellPrice = readNumber(value['sellPrice']);
  loan.sellCostsNet = readNumber(value['sellCostsNet']);
  loan.extraPrincipalPayments = readArray(value['extraPrincipalPayments']).map((e) =>
    parseEvent(e, 'extraPrincipalPayment'),
  );
  return loan;
}

export function parseInvestment(value: unknown): InvestmentModel {
  const investment = emptyInvestment();
  if (!isObject(value)) return investment;
  investment.name = readString(value['name']);
  investment.startingValue = readNumber(value['startingValue']);
  investment.annualReturnRate = readNumber(value['annualReturnRate']);
  investment.taxRate = readNumber(value['taxRate']);
  investment.withdrawalTaxRate = readNumber(value['withdrawalTaxRate']);
  investment.contributionsFromCash = readBool(value['contributionsFromCash']);
  investment.fundLoanPayoffs = readBool(value['fundLoanPayoffs']);
  investment.contributions = readArray(value['contributions']).map((e) =>
    parseEvent(e, 'contribution'),
  );
  investment.withdrawals = readArray(value['withdrawals']).map((e) => parseEvent(e, 'withdrawal'));
  return investment;
}

/** A list of names as written; null when absent. */
function readNames(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  return readArray(value).map(readString);
}

export function parseGuardrail(value: unknown): GuardrailModel {
  const guardrail = emptyGuardrail();
  if (!isObject(value)) return guardrail;
  guardrail.name = readString(value['name']);
  guardrail.kind = readString(value['kind']);
  guardrail.amount = readNumber(value['amount']);
  guardrail.growth = parseGrowth(value['growth']);
  guardrail.investments = readNames(value['investments']);
  guardrail.loans = readNames(value['loans']);
  guardrail.startDate = readString(value['startDate']);
  guardrail.endDate = readString(value['endDate']);
  return guardrail;
}

function parseCommon(value: unknown): CommonModel {
  if (!isObject(value)) return { events: [], loans: [], investments: [] };
  return {
    events: readArray(value['events']).map((e) => parseEvent(e, 'cashflow')),
    loans: readArray(value['loans']).map(parseLoan),
    investments: readArray(value['investments']).map(parseInvestment),
  };
}

function parseSet(kind: EntryKind, value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObject(value)) return out;
  for (const field of SET_FIELDS[kind]) {
    if (!(field.key in value)) continue;
    const raw = value[field.key];
    if (field.format === 'list') {
      out[field.key] = readArray(raw).map((e) => parseEvent(e, field.eventKind!));
    } else if (field.format === 'flag') {
      out[field.key] = readBool(raw);
    } else if (field.format === 'month') {
      out[field.key] = readString(raw);
    } else if (field.format === 'growth') {
      out[field.key] = parseGrowth(raw);
    } else {
      out[field.key] = readNumber(raw);
    }
  }
  return out;
}

/** A target as written: by name only. `linkTargets` finds the entry it means. */
function parseTarget(name: unknown): TargetRef {
  return { id: newId('tg'), targetId: '', targetName: readString(name).trim() };
}

function parseOption(value: unknown, index: number): OptionModel {
  const option = emptyOption(`Option ${index + 1}`);
  if (!isObject(value)) return option;
  option.name = readString(value['name']);
  option.events = readArray(value['events']).map((e) => parseEvent(e, 'cashflow'));
  option.loans = readArray(value['loans']).map(parseLoan);
  option.investments = readArray(value['investments']).map(parseInvestment);
  const change = isObject(value['change']) ? value['change'] : {};
  const remove = isObject(value['remove']) ? value['remove'] : {};
  for (const kind of ENTRY_KINDS) {
    const changes = readArray(change[kind]).map((entry) => ({
      ...parseTarget(isObject(entry) ? entry['name'] : ''),
      set: parseSet(kind, isObject(entry) ? entry['set'] : null),
    }));
    (option.change as Record<EntryKind, unknown>)[kind] = changes;
    option.remove[kind] = readArray(remove[kind]).map(parseTarget);
  }
  return option;
}

function parseChoice(value: unknown, index: number): ChoiceModel {
  const choice = emptyChoice(`Choice ${index + 1}`);
  if (!isObject(value)) return choice;
  choice.name = readString(value['name']);
  choice.options = readArray(value['options']).map(parseOption);
  return choice;
}

/** A scenario's picks, by name as written. A name the plan does not have is left unpicked. */
function parseSelect(value: unknown, choices: ChoiceModel[]): Record<string, string> {
  const select: Record<string, string> = {};
  if (!isObject(value)) return select;
  for (const choice of choices) {
    const picked = value[choice.name];
    if (picked === undefined) continue;
    const option = choice.options.find((candidate) => candidate.name === readString(picked));
    if (option && !(choice.id in select)) select[choice.id] = option.id;
  }
  return select;
}

function parseScenario(value: unknown, index: number, choices: ChoiceModel[]): ScenarioModel {
  const scenario = emptyScenario(`scenario ${index + 1}`);
  if (!isObject(value)) return scenario;
  scenario.select = parseSelect(value['select'], choices);
  scenario.name = readString(value['name']) || scenario.name;
  // v2 default is active: true (spec/03).
  scenario.active = readBool(value['active'], true);
  scenario.events = readArray(value['events']).map((e) => parseEvent(e, 'cashflow'));
  scenario.loans = readArray(value['loans']).map(parseLoan);
  scenario.investments = readArray(value['investments']).map(parseInvestment);
  return scenario;
}

/** Read a parsed v2 YAML document into the editor model. Tolerant by design. */
export function fromConfigDocument(value: unknown): ConfigModel {
  const doc = isObject(value) ? value : {};
  const simulation = isObject(doc['simulation']) ? doc['simulation'] : {};
  const recommendations = isObject(doc['recommendations']) ? doc['recommendations'] : {};
  const choices = readArray(doc['choices']).map(parseChoice);
  const scenarios = readArray(doc['scenarios']).map((scenario, index) =>
    parseScenario(scenario, index, choices),
  );

  return linkTargets({
    simulation: {
      startDate: readString(simulation['startDate']),
      endDate: readString(simulation['endDate']),
      startingCash: readNumber(simulation['startingCash']),
      cashInterestRate: readNumber(simulation['cashInterestRate']),
      inflationRate: readNumber(simulation['inflationRate']),
      emergencyFundMonths: readNumber(recommendations['emergencyFundMonths']),
    },
    guardrails: readArray(doc['guardrails']).map(parseGuardrail),
    common: parseCommon(doc['common']),
    choices,
    scenarios: scenarios.length > 0 ? scenarios : [emptyScenario('scenario 1', choices)],
  });
}

/**
 * Whether a document reads as a plan in the older finance-forecast format: it
 * has no `version` field, or it carries `common.deathDate`.
 */
export function isFinanceForecastDocument(value: unknown): boolean {
  if (!isObject(value)) return false;
  const common = value['common'];
  if (isObject(common) && common['deathDate'] !== undefined) return true;
  return value['version'] === undefined;
}

/**
 * Re-key every list row so a freshly loaded config gets stable, unique keys.
 * A selection or a target names another row by its id, so it is carried over
 * to that row's new one.
 */
export function refreshIds(model: ConfigModel): ConfigModel {
  const renamed = new Map<string, string>();
  const fresh = (prefix: string, old: string): string => {
    const id = newId(prefix);
    renamed.set(old, id);
    return id;
  };
  const reEvent = (e: EventModel): EventModel => ({ ...e, id: newId('ev') });
  const reLoan = (l: LoanModel): LoanModel => ({
    ...l,
    id: fresh('ln', l.id),
    extraPrincipalPayments: l.extraPrincipalPayments.map(reEvent),
  });
  const reInvestment = (i: InvestmentModel): InvestmentModel => ({
    ...i,
    id: fresh('in', i.id),
    contributions: i.contributions.map(reEvent),
    withdrawals: i.withdrawals.map(reEvent),
  });

  // The baseline and the choices first: they are what the rest points at.
  const common: CommonModel = {
    events: model.common.events.map((e) => ({ ...e, id: fresh('ev', e.id) })),
    loans: model.common.loans.map(reLoan),
    investments: model.common.investments.map(reInvestment),
  };
  const reTarget = <R extends TargetRef>(ref: R): R => ({
    ...ref,
    id: newId('tg'),
    targetId: renamed.get(ref.targetId) ?? '',
  });
  const reSet = <S extends object>(kind: EntryKind, set: S): S => {
    const out: Record<string, unknown> = { ...(set as Record<string, unknown>) };
    for (const field of SET_FIELDS[kind]) {
      if (field.format === 'list' && Array.isArray(out[field.key])) {
        out[field.key] = (out[field.key] as EventModel[]).map(reEvent);
      }
    }
    return out as S;
  };
  const choices = model.choices.map((choice) => ({
    ...choice,
    id: fresh('ch', choice.id),
    options: choice.options.map((option) => ({
      ...option,
      id: fresh('op', option.id),
      events: option.events.map(reEvent),
      loans: option.loans.map(reLoan),
      investments: option.investments.map(reInvestment),
      change: {
        events: option.change.events.map((c) => ({ ...reTarget(c), set: reSet('events', c.set) })),
        loans: option.change.loans.map((c) => ({ ...reTarget(c), set: reSet('loans', c.set) })),
        investments: option.change.investments.map((c) => ({
          ...reTarget(c),
          set: reSet('investments', c.set),
        })),
      },
      remove: {
        events: option.remove.events.map(reTarget),
        loans: option.remove.loans.map(reTarget),
        investments: option.remove.investments.map(reTarget),
      },
    })),
  }));

  return {
    simulation: { ...model.simulation },
    guardrails: model.guardrails.map(cloneGuardrail),
    common,
    choices,
    scenarios: model.scenarios.map((s) => {
      const select: Record<string, string> = {};
      for (const [choiceId, optionId] of Object.entries(s.select)) {
        const choice = renamed.get(choiceId);
        const option = renamed.get(optionId);
        if (choice && option) select[choice] = option;
      }
      return {
        ...s,
        id: newId('sc'),
        select,
        events: s.events.map(reEvent),
        loans: s.loans.map(reLoan),
        investments: s.investments.map(reInvestment),
      };
    }),
  };
}
