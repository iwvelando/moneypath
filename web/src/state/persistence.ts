/**
 * localStorage persistence (spec/06: persistence is localStorage-only): editor state under
 * a versioned key, theme choice, optimizer toggle. Nothing else, no cookies,
 * no external storage.
 *
 * Corrupt or version-mismatched saved editor state falls back to the starter
 * config rather than failing to boot.
 */

import type { ConfigModel } from '../config/types';
import { refreshIds } from '../config/serialize';
import { starterConfig } from '../config/starter';

/** Bump when the editor model shape changes incompatibly. */
export const EDITOR_STATE_VERSION = 1;

export const KEYS = {
  editorState: `moneypath.editor.v${EDITOR_STATE_VERSION}`,
  theme: 'moneypath.theme',
  optimize: 'moneypath.optimize',
} as const;

export type RestoreOutcome =
  | { source: 'restored'; config: ConfigModel }
  | { source: 'starter'; config: ConfigModel; reason?: string };

interface StoredEditorState {
  version: number;
  config: unknown;
}

function storage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    const global = globalThis as { localStorage?: Storage };
    return global.localStorage ?? null;
  } catch {
    // Private-mode / disabled storage: the app still works, just without persistence.
    return null;
  }
}

function looksLikeConfig(value: unknown): value is ConfigModel {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ConfigModel>;
  if (typeof candidate.simulation !== 'object' || candidate.simulation === null) return false;
  if (typeof candidate.common !== 'object' || candidate.common === null) return false;
  if (!Array.isArray(candidate.scenarios)) return false;
  if (!Array.isArray(candidate.common.events)) return false;
  if (!Array.isArray(candidate.common.loans)) return false;
  if (!Array.isArray(candidate.common.investments)) return false;
  return true;
}

/** Pure decision function, unit-tested independently of the DOM. */
export function decodeEditorState(raw: string | null): RestoreOutcome {
  if (raw === null) return { source: 'starter', config: starterConfig() };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      source: 'starter',
      config: starterConfig(),
      reason: 'Saved editor state could not be read, so the starter config was loaded.',
    };
  }
  const stored = parsed as Partial<StoredEditorState>;
  if (stored?.version !== EDITOR_STATE_VERSION) {
    return {
      source: 'starter',
      config: starterConfig(),
      reason: 'Saved editor state was written by an older version, so the starter config was loaded.',
    };
  }
  if (!looksLikeConfig(stored.config)) {
    return {
      source: 'starter',
      config: starterConfig(),
      reason: 'Saved editor state was incomplete, so the starter config was loaded.',
    };
  }
  return { source: 'restored', config: refreshIds(stored.config) };
}

export function encodeEditorState(config: ConfigModel): string {
  return JSON.stringify({ version: EDITOR_STATE_VERSION, config } satisfies StoredEditorState);
}

export function loadEditorState(): RestoreOutcome {
  const store = storage();
  if (!store) return { source: 'starter', config: starterConfig() };
  return decodeEditorState(store.getItem(KEYS.editorState));
}

export function saveEditorState(config: ConfigModel): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEYS.editorState, encodeEditorState(config));
  } catch {
    // Quota or disabled storage — persistence is optional to the engine.
  }
}

export function clearEditorState(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEYS.editorState);
  } catch {
    /* ignore */
  }
}

export function readFlag(key: string, fallback: boolean): boolean {
  const store = storage();
  if (!store) return fallback;
  const raw = store.getItem(key);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

export function writeFlag(key: string, value: boolean): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

export function readString(key: string): string | null {
  const store = storage();
  if (!store) return null;
  return store.getItem(key);
}

export function writeString(key: string, value: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    /* ignore */
  }
}
