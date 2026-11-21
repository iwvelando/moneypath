/**
 * Shared decoding of the WASM bridge's string-in/string-out protocol
 * (spec/02): every call returns either the documented payload or
 * `{"error": "..."}` with a human-readable message.
 */

import { EngineError, type ForecastResults, type Problem, type TodaysDollars } from './types';

function parseJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new EngineError(`The engine returned a ${what} response that could not be read.`);
  }
}

function errorMessage(value: unknown): string | null {
  if (typeof value === 'object' && value !== null && 'error' in value) {
    const message = (value as { error: unknown }).error;
    if (typeof message === 'string' && message.trim() !== '') return message;
    return 'The engine reported an unknown error.';
  }
  return null;
}

export function decodeForecast(raw: string): ForecastResults {
  const parsed = parseJson(raw, 'forecast');
  const message = errorMessage(parsed);
  if (message !== null) throw new EngineError(message);
  const results = parsed as Partial<ForecastResults>;
  if (!Array.isArray(results.scenarios) || !Array.isArray(results.rows)) {
    throw new EngineError('The engine returned results in an unexpected shape.');
  }
  return {
    version: results.version ?? '',
    scenarios: results.scenarios,
    rows: results.rows,
    csv: results.csv ?? '',
    metrics: Array.isArray(results.metrics) ? results.metrics : [],
    comparisons: Array.isArray(results.comparisons) ? results.comparisons : [],
    flip: results.flip ?? null,
    earliest: results.earliest ?? null,
    todaysDollars: decodeTodaysDollars(results.todaysDollars),
    warnings: Array.isArray(results.warnings) ? results.warnings : [],
    configYaml: results.configYaml ?? '',
  };
}

/** The today's-dollars set, or null when there is none to read. */
function decodeTodaysDollars(raw: unknown): TodaysDollars | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const set = raw as Partial<TodaysDollars>;
  if (typeof set.today !== 'string' || !Array.isArray(set.rows) || !Array.isArray(set.metrics)) return null;
  return { ...set, today: set.today, rows: set.rows, metrics: set.metrics, comparisons: set.comparisons ?? [] };
}

/** Everything the engine found wrong with a plan; empty for a sound one. */
export function decodeProblems(raw: string): Problem[] {
  const parsed = parseJson(raw, 'validation');
  const message = errorMessage(parsed);
  if (message !== null) throw new EngineError(message);
  const problems = (parsed as { problems?: unknown }).problems;
  if (!Array.isArray(problems)) return [];
  return problems.map((entry) => {
    const problem = entry as Partial<Problem>;
    return {
      level: problem.level === 'warning' ? 'warning' : 'error',
      path: problem.path ?? '',
      where: problem.where ?? '',
      message: problem.message ?? '',
    };
  });
}
