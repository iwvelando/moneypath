/**
 * localStorage persistence (spec/06: persistence is localStorage-only): editor state under
 * a versioned key, theme choice, optimizer toggle. Nothing else, no cookies,
 * no external storage.
 *
 * Corrupt or version-mismatched saved editor state falls back to the starter
 * config rather than failing to boot.
 */

import { ENTRY_KINDS, SET_FIELDS } from '../config/choices';
import {
  emptyChoice,
  emptyEvent,
  emptyGuardrail,
  emptyInvestment,
  emptyLoan,
  emptyOptimize,
  emptyOption,
  emptyScenario,
  emptySimulation,
  type ChoiceModel,
  type CommonModel,
  type ConfigModel,
  type EntryKind,
  type EventModel,
  type GuardrailModel,
  type InvestmentModel,
  type LoanModel,
  type OptionModel,
  type ScenarioModel,
  type TargetRef,
} from '../config/types';
import { refreshIds } from '../config/serialize';
import { starterConfig } from '../config/starter';

/**
 * Bump when the editor model shape changes incompatibly (a field renamed,
 * removed, or changing meaning). Adding a field is compatible: restoring lays
 * each saved entry over its empty* constructor in config/types.ts, so the new
 * field arrives blank. A bump would only throw away people's saved drafts.
 */
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

/** A list a save may predate (backfilled empty) but must not hold as something else. */
function listsAreArrays(section: unknown, keys: readonly string[]): boolean {
  if (typeof section !== 'object' || section === null) return false;
  const record = section as Record<string, unknown>;
  return keys.every((key) => record[key] === undefined || Array.isArray(record[key]));
}

const SECTION_LISTS = ['events', 'loans', 'investments'] as const;

/**
 * The structure withModelDefaults can rely on. Missing lists and fields are
 * fine (that is what backfilling is for); the wrong kind of value is not.
 */
function looksLikeConfig(value: unknown): value is ConfigModel {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ConfigModel>;
  if (typeof candidate.simulation !== 'object' || candidate.simulation === null) return false;
  if (!listsAreArrays(candidate.common, SECTION_LISTS)) return false;
  if (candidate.choices !== undefined && !Array.isArray(candidate.choices)) return false;
  if (candidate.guardrails !== undefined && !Array.isArray(candidate.guardrails)) return false;
  if (!Array.isArray(candidate.scenarios)) return false;
  return candidate.scenarios.every((scenario) => listsAreArrays(scenario, SECTION_LISTS));
}

// A saved draft may predate any field in the model, at any depth. Each helper
// lays the saved object over the blank one (saved values win, nothing is
// dropped) and does the same for the entries nested inside it. The inputs are
// Partial because that is what an older save really is.
type Saved<T> = Partial<T>;

function withEventDefaults(saved: Saved<EventModel>): EventModel {
  return {
    ...emptyEvent(),
    ...saved,
    optimize: saved.optimize ? { ...emptyOptimize(), ...saved.optimize } : null,
  };
}

function withLoanDefaults(saved: Saved<LoanModel>): LoanModel {
  return {
    ...emptyLoan(),
    ...saved,
    extraPrincipalPayments: (saved.extraPrincipalPayments ?? []).map(withEventDefaults),
  };
}

function withInvestmentDefaults(saved: Saved<InvestmentModel>): InvestmentModel {
  return {
    ...emptyInvestment(),
    ...saved,
    contributions: (saved.contributions ?? []).map(withEventDefaults),
    withdrawals: (saved.withdrawals ?? []).map(withEventDefaults),
  };
}

function withSectionDefaults(saved: Saved<CommonModel>): CommonModel {
  return {
    events: (saved.events ?? []).map(withEventDefaults),
    loans: (saved.loans ?? []).map(withLoanDefaults),
    investments: (saved.investments ?? []).map(withInvestmentDefaults),
  };
}

function withTargetDefaults(saved: Saved<TargetRef>): TargetRef {
  return { id: '', targetId: '', targetName: '', ...saved };
}

/** The fields a change carries stay exactly those it had; only a list's entries are filled in. */
function withSetDefaults(kind: EntryKind, saved: object | undefined): Record<string, unknown> {
  const set: Record<string, unknown> = { ...saved };
  for (const field of SET_FIELDS[kind]) {
    if (field.format !== 'list' || !(field.key in set)) continue;
    set[field.key] = ((set[field.key] ?? []) as Saved<EventModel>[]).map(withEventDefaults);
  }
  return set;
}

function withOptionDefaults(saved: Saved<OptionModel>): OptionModel {
  const option: OptionModel = { ...emptyOption(''), ...saved, ...withSectionDefaults(saved) };
  const change: Record<string, unknown> = {};
  const remove: Record<string, unknown> = {};
  for (const kind of ENTRY_KINDS) {
    const changes: Saved<TargetRef & { set: object }>[] = saved.change?.[kind] ?? [];
    change[kind] = changes.map((entry) => ({
      ...withTargetDefaults(entry),
      set: withSetDefaults(kind, entry.set),
    }));
    remove[kind] = (saved.remove?.[kind] ?? []).map(withTargetDefaults);
  }
  return { ...option, change: change as unknown as OptionModel['change'], remove: remove as OptionModel['remove'] };
}

function withChoiceDefaults(saved: Saved<ChoiceModel>): ChoiceModel {
  return { ...emptyChoice(''), ...saved, options: (saved.options ?? []).map(withOptionDefaults) };
}

function withScenarioDefaults(saved: Saved<ScenarioModel>): ScenarioModel {
  return { ...emptyScenario(''), ...saved, ...withSectionDefaults(saved) };
}

function withModelDefaults(saved: ConfigModel): ConfigModel {
  return {
    simulation: { ...emptySimulation(), ...saved.simulation },
    // A draft saved before guardrails existed is a plan with none.
    guardrails: ((saved as Saved<ConfigModel>).guardrails ?? []).map((guardrail: Saved<GuardrailModel>) => ({
      ...emptyGuardrail(),
      ...guardrail,
    })),
    common: withSectionDefaults(saved.common),
    // A draft saved before choices existed is a plan with none.
    choices: ((saved as Saved<ConfigModel>).choices ?? []).map(withChoiceDefaults),
    scenarios: saved.scenarios.map(withScenarioDefaults),
  };
}

const UNREADABLE_STATE_REASON = 'Saved editor state could not be read, so the starter config was loaded.';

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
      reason: UNREADABLE_STATE_REASON,
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
  try {
    return { source: 'restored', config: refreshIds(withModelDefaults(stored.config)) };
  } catch {
    // Damage below the shallow check (a null entry, a list holding the wrong
    // kind of value): discard the whole draft rather than fail to boot.
    return {
      source: 'starter',
      config: starterConfig(),
      reason: UNREADABLE_STATE_REASON,
    };
  }
}

export function encodeEditorState(config: ConfigModel): string {
  return JSON.stringify({ version: EDITOR_STATE_VERSION, config } satisfies StoredEditorState);
}

export function loadEditorState(): RestoreOutcome {
  const store = storage();
  if (!store) return { source: 'starter', config: starterConfig() };
  return decodeEditorState(store.getItem(KEYS.editorState));
}

/** Saves the draft, and says whether it was saved: storage can be full, or denied. */
export function saveEditorState(config: ConfigModel): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(KEYS.editorState, encodeEditorState(config));
    return true;
  } catch {
    // Quota or disabled storage — persistence is optional to the engine.
    return false;
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
