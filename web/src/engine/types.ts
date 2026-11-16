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
  floor: number;
  minimumCash: number;
  headroom: number;
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
}

export interface ScenarioMetrics {
  keyFigures?: KeyFigureMetrics | null;
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
}

export interface ScenarioValue {
  liquid?: number | null;
  total?: number | null;
  notes?: string[] | null;
}

export interface ResultRow {
  date: string;
  values: (ScenarioValue | null)[];
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
  warnings?: string[] | null;
  configYaml: string;
}

export interface ForecastOptions {
  optimize?: boolean;
  /** `YYYY-MM`; pins the engine's idea of the current month. */
  now?: string;
  /** Also compare one scenario with its flipped path. */
  flip?: FlipRequest;
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
