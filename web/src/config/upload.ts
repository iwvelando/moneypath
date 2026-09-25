/**
 * "Upload Config" decision logic (spec/06): the file is read locally and never
 * uploaded anywhere. v2 configs load straight into the editor; a legacy v1
 * config is routed to `moneypathMigrate` and its notices shown.
 *
 * This module is pure — parsing YAML is not finance math, and the decision is
 * unit-tested without a browser or an engine.
 */

import { parse as parseYaml } from 'yaml';
import { isLegacyDocument } from './serialize';

export type UploadPlan =
  | { action: 'load'; document: unknown }
  | { action: 'migrate'; reason: string }
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

  if (isLegacyDocument(record)) {
    const reason =
      typeof record['version'] === 'undefined'
        ? 'The file has no `version` field, so it was read as a legacy (v1) config and migrated.'
        : 'The file uses `common.deathDate`, so it was read as a legacy (v1) config and migrated.';
    return { action: 'migrate', reason };
  }

  if (record['version'] !== 2) {
    return {
      action: 'error',
      message: `Unsupported config version: ${JSON.stringify(record['version'])}. moneypath reads version 2.`,
    };
  }

  return { action: 'load', document: record };
}

/** Parse the YAML the migrator handed back so it can populate the editor. */
export function parseMigratedYaml(configYaml: string): unknown {
  return parseYaml(configYaml);
}
