/**
 * "Upload Config" decision logic (spec/06): the file is read locally and never
 * uploaded anywhere. A version 2 config loads straight into the editor; a plan
 * in the older finance-forecast format is refused, since nothing converts it.
 *
 * This module is pure — parsing YAML is not finance math, and the decision is
 * unit-tested without a browser or an engine.
 */

import { parse as parseYaml } from 'yaml';
import { isFinanceForecastDocument } from './serialize';

export type UploadPlan =
  | { action: 'load'; document: unknown }
  | { action: 'error'; message: string };

export function planUpload(text: string): UploadPlan {
  if (text.trim() === '') {
    return { action: 'error', message: 'That file is empty.' };
  }

  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (error) {
    return {
      action: 'error',
      message: `That file is not valid YAML: ${(error as Error).message}`,
    };
  }

  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return { action: 'error', message: 'That file does not contain a moneypath config.' };
  }

  const record = document as Record<string, unknown>;

  if (isFinanceForecastDocument(record)) {
    const message =
      typeof record['version'] === 'undefined'
        ? 'This file has no `version` field, so it is not a moneypath plan. Plans in the older finance-forecast format are no longer converted.'
        : 'This file uses `common.deathDate`, which belongs to the older finance-forecast format. Plans in that format are no longer converted.';
    return { action: 'error', message };
  }

  if (record['version'] !== 2) {
    return {
      action: 'error',
      message: `Unsupported config version: ${JSON.stringify(record['version'])}. moneypath reads version 2.`,
    };
  }

  return { action: 'load', document: record };
}
