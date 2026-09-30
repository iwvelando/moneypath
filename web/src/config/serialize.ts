/**
 * Editor model <-> v2 config document.
 *
 * The engine is the only thing that produces canonical YAML (`configYaml` in
 * the results), so the editor only ever *builds* a plain JS document and hands
 * it to the bridge. JSON is a subset of YAML, so `JSON.stringify` of the
 * document below is a valid config for `moneypathForecast`.
 */

import {
  type CommonModel,
  type ConfigModel,
  type EventKind,
  type EventModel,
  type InvestmentModel,
  type LoanModel,
  type OptimizeField,
  type OptimizeModel,
  type ScenarioModel,
  emptyEvent,
  emptyInvestment,
  emptyLoan,
  emptyScenario,
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

function serializeScenario(scenario: ScenarioModel): JsonObject {
  const out: JsonObject = { name: scenario.name.trim(), active: scenario.active };
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

  const doc: JsonObject = { version: CONFIG_VERSION, simulation };

  if (model.simulation.emergencyFundMonths !== null) {
    doc['recommendations'] = { emergencyFundMonths: model.simulation.emergencyFundMonths };
  }

  const common: JsonObject = {};
  if (model.common.events.length > 0) {
    common['events'] = model.common.events.map((e) => serializeEvent(e, 'cashflow'));
  }
  if (model.common.loans.length > 0) common['loans'] = model.common.loans.map(serializeLoan);
  if (model.common.investments.length > 0) {
    common['investments'] = model.common.investments.map(serializeInvestment);
  }
  if (Object.keys(common).length > 0) doc['common'] = common;

  doc['scenarios'] = model.scenarios.map(serializeScenario);
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
  };
}

export function parseEvent(value: unknown, kind: EventKind): EventModel {
  const event = emptyEvent();
  if (!isObject(value)) return event;
  event.name = readString(value['name']);
  event.amount = readNumber(value['amount']);
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

function parseCommon(value: unknown): CommonModel {
  if (!isObject(value)) return { events: [], loans: [], investments: [] };
  return {
    events: readArray(value['events']).map((e) => parseEvent(e, 'cashflow')),
    loans: readArray(value['loans']).map(parseLoan),
    investments: readArray(value['investments']).map(parseInvestment),
  };
}

function parseScenario(value: unknown, index: number): ScenarioModel {
  const scenario = emptyScenario(`scenario ${index + 1}`);
  if (!isObject(value)) return scenario;
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
  const scenarios = readArray(doc['scenarios']).map(parseScenario);

  return {
    simulation: {
      startDate: readString(simulation['startDate']),
      endDate: readString(simulation['endDate']),
      startingCash: readNumber(simulation['startingCash']),
      cashInterestRate: readNumber(simulation['cashInterestRate']),
      emergencyFundMonths: readNumber(recommendations['emergencyFundMonths']),
    },
    common: parseCommon(doc['common']),
    scenarios: scenarios.length > 0 ? scenarios : [emptyScenario('scenario 1')],
  };
}

/**
 * Legacy (v1) detection, per spec/05: "a v1 config (detected by a missing
 * `version` field or `common.deathDate` present)".
 */
export function isLegacyDocument(value: unknown): boolean {
  if (!isObject(value)) return false;
  const common = value['common'];
  if (isObject(common) && common['deathDate'] !== undefined) return true;
  return value['version'] === undefined;
}

/** Re-key every list row so a freshly loaded config gets stable, unique keys. */
export function refreshIds(model: ConfigModel): ConfigModel {
  const reEvent = (e: EventModel): EventModel => ({ ...e, id: newId('ev') });
  return {
    simulation: { ...model.simulation },
    common: {
      events: model.common.events.map(reEvent),
      loans: model.common.loans.map((l) => ({
        ...l,
        id: newId('ln'),
        extraPrincipalPayments: l.extraPrincipalPayments.map(reEvent),
      })),
      investments: model.common.investments.map((i) => ({
        ...i,
        id: newId('in'),
        contributions: i.contributions.map(reEvent),
        withdrawals: i.withdrawals.map(reEvent),
      })),
    },
    scenarios: model.scenarios.map((s) => ({
      ...s,
      id: newId('sc'),
      events: s.events.map(reEvent),
      loans: s.loans.map((l) => ({
        ...l,
        id: newId('ln'),
        extraPrincipalPayments: l.extraPrincipalPayments.map(reEvent),
      })),
      investments: s.investments.map((i) => ({
        ...i,
        id: newId('in'),
        contributions: i.contributions.map(reEvent),
        withdrawals: i.withdrawals.map(reEvent),
      })),
    })),
  };
}
