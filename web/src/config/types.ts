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
  /** The name of the guardrail the value is held to; `''` holds it to the emergency fund. */
  guardrail: string;
}

/** How an amount changes over the plan's years (spec/03, Growth). */
export type GrowthMode = 'fixed' | 'inflation' | 'rate';

/**
 * A growth as the editor holds it. `mode` is kept as written when it is none
 * of the three, so a value the engine refuses stays on screen with its error.
 * `rate` is the yearly percent for `rate`; it is kept while another mode is
 * picked, so picking `rate` again brings it back.
 */
export interface GrowthModel {
  mode: GrowthMode | (string & {});
  rate: number | null;
}

export interface EventModel {
  id: string;
  name: string;
  amount: number | null;
  growth: GrowthModel;
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
  escrowGrowth: GrowthModel;
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

/** The lists an option can add to, and the kinds of baseline entry it can target. */
export type EntryKind = 'events' | 'loans' | 'investments';

/**
 * The fields an option changes on a baseline entry. A key that is present is
 * changed, whatever its value: an empty value takes the field away on that
 * path. A key that is absent follows the baseline.
 */
export type EventSet = Partial<Pick<EventModel, 'amount' | 'growth' | 'frequency' | 'startDate' | 'endDate'>>;
export type LoanSet = Partial<Omit<LoanModel, 'id' | 'name'>>;
export type InvestmentSet = Partial<Omit<InvestmentModel, 'id' | 'name'>>;

/**
 * A baseline entry an option changes or removes. `targetId` is the entry's
 * client-only id, so a rename needs no rewrite; it is '' when the baseline has
 * no such entry, and `targetName` then holds the name as written.
 */
export interface TargetRef {
  id: string;
  targetId: string;
  targetName: string;
}

export interface ChangeModel<S> extends TargetRef {
  set: S;
}

export interface OptionChanges {
  events: ChangeModel<EventSet>[];
  loans: ChangeModel<LoanSet>[];
  investments: ChangeModel<InvestmentSet>[];
}

export type OptionRemovals = Record<EntryKind, TargetRef[]>;

/** One way a choice can go: entries it adds, and baseline entries it changes or removes. */
export interface OptionModel {
  id: string;
  name: string;
  events: EventModel[];
  loans: LoanModel[];
  investments: InvestmentModel[];
  change: OptionChanges;
  remove: OptionRemovals;
}

export interface ChoiceModel {
  id: string;
  name: string;
  options: OptionModel[];
}

export interface ScenarioModel {
  id: string;
  name: string;
  active: boolean;
  /** The option picked for each choice: a choice's id to one of its options' ids. */
  select: Record<string, string>;
  events: EventModel[];
  loans: LoanModel[];
  investments: InvestmentModel[];
}

export interface SimulationModel {
  startDate: string;
  endDate: string;
  startingCash: number | null;
  cashInterestRate: number | null;
  inflationRate: number | null;
  emergencyFundMonths: number | null;
}

export interface CommonModel {
  events: EventModel[];
  loans: LoanModel[];
  investments: InvestmentModel[];
}

/** The kinds of guardrail the engine can check. */
export type GuardrailKind = 'cashFloor' | 'debtFree' | 'lasts';

/**
 * A condition every path is checked against. `kind` is kept as written, so a
 * kind the engine cannot check stays on screen with its error. `investments`
 * and `loans` are null when absent. A debt-free uses `loans`, and a lasts
 * `investments`; a value a kind does not use stays until the reader takes it
 * away.
 */
export interface GuardrailModel {
  id: string;
  name: string;
  kind: GuardrailKind | (string & {});
  amount: number | null;
  growth: GrowthModel;
  investments: string[] | null;
  loans: string[] | null;
  startDate: string;
  endDate: string;
}

export interface ConfigModel {
  simulation: SimulationModel;
  /** Checked on every path; empty when the plan has none. */
  guardrails: GuardrailModel[];
  common: CommonModel;
  choices: ChoiceModel[];
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

/** Fixed: the amount stays as written, which is what leaving growth out means. */
export function emptyGrowth(): GrowthModel {
  return { mode: 'fixed', rate: null };
}

/** A blank optimizer block, for backfilling one a saved draft only partly has. */
export function emptyOptimize(): OptimizeModel {
  return {
    field: 'amount',
    min: null,
    max: null,
    minDate: '',
    maxDate: '',
    tolerance: null,
    maxIterations: null,
    guardrail: '',
  };
}

/** A blank simulation block: every setting unset, which the engine reads as its default. */
export function emptySimulation(): SimulationModel {
  return {
    startDate: '',
    endDate: '',
    startingCash: null,
    cashInterestRate: null,
    inflationRate: null,
    emergencyFundMonths: null,
  };
}

/** A new guardrail is a cash floor with nothing entered yet. */
export function emptyGuardrail(): GuardrailModel {
  return {
    id: newId('gr'),
    name: '',
    kind: 'cashFloor',
    amount: null,
    growth: emptyGrowth(),
    investments: null,
    loans: null,
    startDate: '',
    endDate: '',
  };
}

export function cloneGuardrail(guardrail: GuardrailModel): GuardrailModel {
  return {
    ...guardrail,
    id: newId('gr'),
    growth: { ...guardrail.growth },
    investments: guardrail.investments ? [...guardrail.investments] : null,
    loans: guardrail.loans ? [...guardrail.loans] : null,
  };
}

export function emptyEvent(): EventModel {
  return {
    id: newId('ev'),
    name: '',
    amount: null,
    growth: emptyGrowth(),
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
    escrowGrowth: emptyGrowth(),
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

export function emptyOption(name: string): OptionModel {
  return {
    id: newId('op'),
    name,
    events: [],
    loans: [],
    investments: [],
    change: { events: [], loans: [], investments: [] },
    remove: { events: [], loans: [], investments: [] },
  };
}

export function emptyChoice(name: string): ChoiceModel {
  return { id: newId('ch'), name, options: [] };
}

/** A new scenario picks the first option of each choice, so it is valid as it stands. */
export function emptyScenario(name: string, choices: ChoiceModel[] = []): ScenarioModel {
  const select: Record<string, string> = {};
  for (const choice of choices) {
    const first = choice.options[0];
    if (first) select[choice.id] = first.id;
  }
  return {
    id: newId('sc'),
    name,
    active: true,
    select,
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
    growth: { ...event.growth },
    optimize: event.optimize ? { ...event.optimize } : null,
  };
}

export function cloneLoan(loan: LoanModel): LoanModel {
  return {
    ...loan,
    id: newId('ln'),
    escrowGrowth: { ...loan.escrowGrowth },
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
    select: { ...scenario.select },
    events: scenario.events.map(cloneEvent),
    loans: scenario.loans.map(cloneLoan),
    investments: scenario.investments.map(cloneInvestment),
  };
}
