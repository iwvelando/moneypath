/**
 * The editor's in-memory representation of a moneypath v2 config
 * (spec/03-config-v2.md).
 *
 * Design notes:
 * - Every list item carries a client-only `id` so Preact keys survive
 *   reordering/duplication. Ids never reach the engine.
 * - Numeric fields are `number | null`; `null` means "field omitted" so the
 *   engine applies its documented default.
 * - Month fields are plain strings (`''` means omitted) because the editor must
 *   hold partially typed values like `2025-` while validating as you type.
 */

export type OptimizeField = 'amount' | 'frequency' | 'startDate' | 'endDate';

export interface OptimizeModel {
  field: OptimizeField;
  min: number | null;
  max: number | null;
  minDate: string;
  maxDate: string;
  tolerance: number | null;
  maxIterations: number | null;
}

export interface EventModel {
  id: string;
  name: string;
  amount: number | null;
  /** Only meaningful for investment withdrawals. */
  percentage: number | null;
  frequency: number | null;
  startDate: string;
  endDate: string;
  /** Scenario cash-flow events only; an optimize block on a common event is an error. */
  optimize: OptimizeModel | null;
}

export interface LoanModel {
  id: string;
  name: string;
  principal: number | null;
  downPayment: number | null;
  interestRate: number | null;
  term: number | null;
  startDate: string;
  escrow: number | null;
  mortgageInsurance: number | null;
  mortgageInsuranceCutoff: number | null;
  earlyPayoffThreshold: number | null;
  earlyPayoffDate: string;
  sellProperty: boolean;
  sellPrice: number | null;
  sellCostsNet: number | null;
  extraPrincipalPayments: EventModel[];
}

export interface InvestmentModel {
  id: string;
  name: string;
  startingValue: number | null;
  annualReturnRate: number | null;
  taxRate: number | null;
  withdrawalTaxRate: number | null;
  contributionsFromCash: boolean;
  fundLoanPayoffs: boolean;
  contributions: EventModel[];
  withdrawals: EventModel[];
}

export interface ScenarioModel {
  id: string;
  name: string;
  active: boolean;
  events: EventModel[];
  loans: LoanModel[];
  investments: InvestmentModel[];
}

export interface SimulationModel {
  startDate: string;
  endDate: string;
  startingCash: number | null;
  cashInterestRate: number | null;
  emergencyFundMonths: number | null;
}

export interface CommonModel {
  events: EventModel[];
  loans: LoanModel[];
  investments: InvestmentModel[];
}

export interface ConfigModel {
  simulation: SimulationModel;
  common: CommonModel;
  scenarios: ScenarioModel[];
}

/** Where an event list lives; drives which fields and help text apply. */
export type EventKind =
  | 'cashflow'
  | 'extraPrincipalPayment'
  | 'contribution'
  | 'withdrawal';

let counter = 0;

/** Client-only identity for list rows. Not part of the config. */
export function newId(prefix = 'i'): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A blank simulation block: every setting unset, which the engine reads as its default. */
export function emptySimulation(): SimulationModel {
  return { startDate: '', endDate: '', startingCash: null, cashInterestRate: null, emergencyFundMonths: null };
}

export function emptyEvent(): EventModel {
  return {
    id: newId('ev'),
    name: '',
    amount: null,
    percentage: null,
    frequency: null,
    startDate: '',
    endDate: '',
    optimize: null,
  };
}

export function emptyLoan(): LoanModel {
  return {
    id: newId('ln'),
    name: '',
    principal: null,
    downPayment: null,
    interestRate: null,
    term: null,
    startDate: '',
    escrow: null,
    mortgageInsurance: null,
    mortgageInsuranceCutoff: null,
    earlyPayoffThreshold: null,
    earlyPayoffDate: '',
    sellProperty: false,
    sellPrice: null,
    sellCostsNet: null,
    extraPrincipalPayments: [],
  };
}

export function emptyInvestment(): InvestmentModel {
  return {
    id: newId('in'),
    name: '',
    startingValue: null,
    annualReturnRate: null,
    taxRate: null,
    withdrawalTaxRate: null,
    contributionsFromCash: false,
    fundLoanPayoffs: false,
    contributions: [],
    withdrawals: [],
  };
}

export function emptyScenario(name: string): ScenarioModel {
  return {
    id: newId('sc'),
    name,
    active: true,
    events: [],
    loans: [],
    investments: [],
  };
}

/** Deep copy with fresh ids, for the "duplicate" affordance. */
export function cloneEvent(event: EventModel): EventModel {
  return {
    ...event,
    id: newId('ev'),
    optimize: event.optimize ? { ...event.optimize } : null,
  };
}

export function cloneLoan(loan: LoanModel): LoanModel {
  return {
    ...loan,
    id: newId('ln'),
    extraPrincipalPayments: loan.extraPrincipalPayments.map(cloneEvent),
  };
}

export function cloneInvestment(investment: InvestmentModel): InvestmentModel {
  return {
    ...investment,
    id: newId('in'),
    contributions: investment.contributions.map(cloneEvent),
    withdrawals: investment.withdrawals.map(cloneEvent),
  };
}

export function cloneScenario(scenario: ScenarioModel): ScenarioModel {
  return {
    ...scenario,
    id: newId('sc'),
    events: scenario.events.map(cloneEvent),
    loans: scenario.loans.map(cloneLoan),
    investments: scenario.investments.map(cloneInvestment),
  };
}
