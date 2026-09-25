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

export interface ScenarioMetrics {
  emergencyFund?: EmergencyFundMetrics | null;
  optimizations?: OptimizationSummary[] | null;
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
  warnings?: string[] | null;
  configYaml: string;
}

export interface MigrateResult {
  configYaml: string;
  notices: string[];
}

export interface ForecastOptions {
  optimize?: boolean;
  /** `YYYY-MM`; pins the engine's idea of the current month. */
  now?: string;
}

/** An error surfaced by the engine bridge (`{"error": "..."}`) or by loading. */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export type EngineKind = 'wasm' | 'mock';

export interface Engine {
  readonly kind: EngineKind;
  /** The build version string from `moneypathVersion()`. */
  version(): string;
  forecast(configYaml: string, options: ForecastOptions): Promise<ForecastResults>;
  migrate(legacyYaml: string): Promise<MigrateResult>;
}
