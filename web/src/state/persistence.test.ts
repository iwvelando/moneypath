import { describe, expect, it } from 'vitest';
import { EDITOR_STATE_VERSION, decodeEditorState, encodeEditorState } from './persistence';
import { starterConfig } from '../config/starter';
import { toConfigDocument } from '../config/serialize';

describe('editor state persistence', () => {
  it('round-trips a saved config', () => {
    const config = starterConfig('2025-06');
    const outcome = decodeEditorState(encodeEditorState(config));
    expect(outcome.source).toBe('restored');
    expect(toConfigDocument(outcome.config)).toEqual(toConfigDocument(config));
  });

  it('falls back to the starter config when nothing is stored', () => {
    const outcome = decodeEditorState(null);
    expect(outcome.source).toBe('starter');
    expect(outcome.config.scenarios.length).toBeGreaterThan(0);
  });

  it('falls back when the stored JSON is corrupt', () => {
    const outcome = decodeEditorState('{not json');
    expect(outcome.source).toBe('starter');
    if (outcome.source === 'starter') expect(outcome.reason).toMatch(/could not be read/);
  });

  it('falls back when the stored version does not match', () => {
    const stale = JSON.stringify({
      version: EDITOR_STATE_VERSION + 1,
      config: starterConfig('2025-06'),
    });
    const outcome = decodeEditorState(stale);
    expect(outcome.source).toBe('starter');
    if (outcome.source === 'starter') expect(outcome.reason).toMatch(/older version/);
  });

  it('falls back when the stored config is structurally wrong', () => {
    const broken = JSON.stringify({ version: EDITOR_STATE_VERSION, config: { simulation: {} } });
    const outcome = decodeEditorState(broken);
    expect(outcome.source).toBe('starter');
    if (outcome.source === 'starter') expect(outcome.reason).toMatch(/incomplete/);
  });

  it('backfills simulation settings that an older save predates, keeping the rest', () => {
    // A draft saved before cashInterestRate existed has no such key at all.
    const saved = JSON.parse(encodeEditorState(starterConfig('2025-06')));
    delete saved.config.simulation.cashInterestRate;
    saved.config.simulation.startingCash = 12345;

    const outcome = decodeEditorState(JSON.stringify(saved));

    expect(outcome.source).toBe('restored');
    expect(outcome.config.simulation.cashInterestRate).toBeNull();
    expect(outcome.config.simulation.startingCash).toBe(12345);
    expect(outcome.config.simulation.startDate).toBe('2025-06');
  });

  it('keeps a saved cash interest rate', () => {
    const config = starterConfig('2025-06');
    config.simulation.cashInterestRate = 4.5;
    const outcome = decodeEditorState(encodeEditorState(config));
    expect(outcome.config.simulation.cashInterestRate).toBe(4.5);
  });

  it('re-keys restored rows so ids stay unique', () => {
    const config = starterConfig('2025-06');
    const outcome = decodeEditorState(encodeEditorState(config));
    const ids = outcome.config.common.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
