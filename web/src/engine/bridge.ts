/**
 * Shared decoding of the WASM bridge's string-in/string-out protocol
 * (spec/02): every call returns either the documented payload or
 * `{"error": "..."}` with a human-readable message.
 */

import { EngineError, type ForecastResults, type MigrateResult } from './types';

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
    warnings: Array.isArray(results.warnings) ? results.warnings : [],
    configYaml: results.configYaml ?? '',
  };
}

export function decodeMigrate(raw: string): MigrateResult {
  const parsed = parseJson(raw, 'migration');
  const message = errorMessage(parsed);
  if (message !== null) throw new EngineError(message);
  const result = parsed as Partial<MigrateResult>;
  if (typeof result.configYaml !== 'string') {
    throw new EngineError('The engine returned a migration result in an unexpected shape.');
  }
  return {
    configYaml: result.configYaml,
    notices: Array.isArray(result.notices) ? result.notices : [],
  };
}
