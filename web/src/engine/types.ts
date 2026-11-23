/**
 * The results JSON contract from spec/02-architecture.md, transcribed verbatim
 * as types. `liquid`/`total` are omitted (null or absent) for dates a scenario
 * has no value for; numbers are raw float64 values and formatting is our job.
 */

export interface EmergencyFundMetrics {
  targetMonths: number;
  averageMonthlyExpenses: number;
  targetAmount: number;
  initialLiquid: number;
  fundedMonths: number;
  shortfall: number;
  surplus: number;
}

export interface OptimizationSummary {
  targetName: string;
  field: string;
  /**
   * The raw numbers the optimizer searched: currency for `amount`, a count for
   * `frequency`, a month index for the date fields — whose `YYYY-MM` form lives
   * only in the display strings.
   */
  original: number;
  value: number;
  originalDisplay: string;
  valueDisplay: string;
  /**
   * The floor the value was held to, the least balance it was checked
   * against and their difference. Absent for a target held to a debt-free
   * guardrail, which has no dollar floor.
   */
  floor?: number;
  minimumCash?: number;
  headroom?: number;
  /** The result of the guardrail the target is held to; absent for the emergency fund. */
  guardrail?: GuardrailResult;
  iterations: number;
  converged: boolean;
  notes?: string[] | null;
}

/** Decided by the engine; `lowestCashDate` is the `YYYY-MM` month of `lowestCash`. */
export interface KeyFigureMetrics {
  lowestCash: number;
  lowestCashDate: string;
  endingCash: number;
  endingTotal: number;
  /** Total less what is owed, in the last month. */
  endingNetWorth?: number;
}

/**
 * One guardrail read from one path, decided by the engine. `firstBreachDate`
 * is present only when it breaks. For a cash floor or a lasts, `tightestDate`
 * and `margin` (the balance less the floor there) are present unless it does
 * not apply. For a debt-free, `tightestDate` is the month the debt is cleared
 * and `marginMonths` the months to spare, both absent while debt remains at the
 * window's end, and `owed` is what is owed at a breach.
 */
export interface GuardrailResult {
  name: string;
  kind: string;
  result: 'holds' | 'breaks' | 'doesNotApply';
  firstBreachDate?: string;
  tightestDate?: string;
  margin?: number;
  marginMonths?: number;
  owed?: number;
}

export interface ScenarioMetrics {
  keyFigures?: KeyFigureMetrics | null;
  /** In the plan's order; absent when the plan has no guardrails. */
  guardrails?: GuardrailResult[] | null;
  emergencyFund?: EmergencyFundMetrics | null;
  optimizations?: OptimizationSummary[] | null;
}

/** A month in which the lead changes hands; `leader` indexes `scenarios`. */
export interface BreakEvenMonth {
  date: string;
  leader: number;
}

/** `difference` is index-aligned with `rows`. */
export interface SeriesComparison {
  difference: number[];
  breakEven: BreakEvenMonth[];
}

/** `scenario` minus `against`, both indexes into `scenarios`; decided by the engine. */
export interface ScenarioComparison {
  scenario: number;
  against: number;
  cash: SeriesComparison;
  total: SeriesComparison;
  netWorth?: SeriesComparison;
}

/** What to flip: an active scenario, one of the plan's choices, and the option to switch it to. */
export interface FlipRequest {
  scenario: string;
  choice: string;
  option: string;
}

/** A month in which the lead changes hands; `flipped` when the flipped path moves ahead. */
export interface FlipBreakEvenMonth {
  date: string;
  flipped: boolean;
}

/** `difference` is index-aligned with `rows`. */
export interface FlipSeries {
  difference: number[];
  breakEven: FlipBreakEvenMonth[];
}

/**
 * A scenario's flipped path minus the scenario; decided by the engine.
 * `scenario` indexes `scenarios`, and `name` is the flipped path's name.
 */
export interface FlipComparison {
  scenario: number;
  choice: string;
  option: string;
  name: string;
  cash: FlipSeries;
  total: FlipSeries;
  netWorth?: FlipSeries;
  /** The flipped path's own guardrail results; absent when the plan has none. */
  guardrails?: GuardrailResult[] | null;
}

/**
 * The earliest month one entry of a scenario's path can take with every
 * chosen guardrail holding. `entry` is the entry's place in the plan as
 * written (`common.loans.0`); `field` is `startDate`, or `endDate` for an
 * event; `from` and `to` bound the range, inclusive.
 */
export interface EarliestRequest {
  scenario: string;
  entry: string;
  field: 'startDate' | 'endDate';
  from: string;
  to: string;
  guardrails: string[];
}

/** Consecutive months, inclusive at both ends. */
export interface MonthSpan {
  from: string;
  to: string;
}

/**
 * The engine's answer to an earliest-month question. `month` is absent when
 * no month works; `decidedBy` holds the chosen guardrails that break a month
 * before it, and is absent when it is the range's first month.
 */
export interface EarliestAnswer {
  scenario: number;
  entry: string;
  name: string;
  field: string;
  from: string;
  to: string;
  /** The chosen guardrails, in the plan's order. */
  guardrails: string[];
  configured: string;
  month?: string;
  works: MonthSpan[];
  holds: { name: string; months: MonthSpan[] }[];
  decidedBy?: GuardrailResult[] | null;
  atEarliest?: GuardrailResult[] | null;
}

/**
 * One month of one scenario. `liabilities` is what its loans still owe, and
 * `netWorth` is `total` less that.
 */
export interface ScenarioValue {
  liquid?: number | null;
  total?: number | null;
  liabilities?: number | null;
  netWorth?: number | null;
  notes?: string[] | null;
}

export interface ResultRow {
  date: string;
  values: (ScenarioValue | null)[];
}

/**
 * The run read in today's dollars: the plan's start month's prices, present
 * only when the plan has an inflation rate. Every month, result and note
 * repeats the nominal results; only the amounts are converted, by the engine.
 */
export interface TodaysDollars {
  /** `YYYY-MM`, the month whose prices these amounts are in. */
  today: string;
  rows: ResultRow[];
  metrics: ScenarioMetrics[];
  comparisons?: ScenarioComparison[] | null;
  flip?: FlipComparison | null;
  earliest?: EarliestAnswer | null;
}

/** How amounts are read: as they will be paid, or in today's dollars. */
export type Reading = 'nominal' | 'today';

/** One answer in both readings; `today` is null when the plan has no inflation rate. */
export interface Readings<T> {
  nominal: T;
  today: T | null;
}

export interface ForecastResults {
  version: string;
  scenarios: string[];
  rows: ResultRow[];
  csv: string;
  metrics: ScenarioMetrics[];
  /** Every ordered pair of scenarios; empty with fewer than two. */
  comparisons?: ScenarioComparison[] | null;
  /** Present only when the run was asked for a flip. */
  flip?: FlipComparison | null;
  /** Present only when the run was asked an earliest-month question. */
  earliest?: EarliestAnswer | null;
  /** Present only when the plan's inflation rate is set and not 0. */
  todaysDollars?: TodaysDollars | null;
  warnings?: string[] | null;
  configYaml: string;
}

export interface ForecastOptions {
  optimize?: boolean;
  /** `YYYY-MM`; pins the engine's idea of the current month. */
  now?: string;
  /** Also compare one scenario with its flipped path. */
  flip?: FlipRequest;
  /** Also ask for the earliest month an entry can take. */
  earliest?: EarliestRequest;
}

/**
 * One thing wrong with a plan, or one warning about it. `path` is the field's
 * place in the config document (`common.loans.0.term`), `where` that place in
 * words, and `message` a sentence that does not repeat the place.
 */
export interface Problem {
  level: 'error' | 'warning';
  path: string;
  where: string;
  message: string;
}

/** A problem as text on its own: the place, then the sentence. */
export function problemText(problem: Problem): string {
  return problem.where ? `${problem.where}: ${problem.message}` : problem.message;
}

/** An error surfaced by the engine bridge (`{"error": "..."}`) or by loading. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface Engine {
  /** The build version string from `moneypathVersion()`. */
  version(): string;
  forecast(configYaml: string, options: ForecastOptions): Promise<ForecastResults>;
  /** Checks a plan without running it. Quick enough to call on every edit. */
  validate(configYaml: string, options: { now?: string }): Problem[];
}
