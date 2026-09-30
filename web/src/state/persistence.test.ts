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

  it('falls back when a saved list is not a list', () => {
    const draft = sparseDraft();
    (draft.config.scenarios[0] as Record<string, unknown>)['events'] = 'not a list';
    const outcome = decodeEditorState(JSON.stringify(draft));
    expect(outcome.source).toBe('starter');
  });

  describe('damage below the top-level shape', () => {
    const starterNotice = 'Saved editor state could not be read, so the starter config was loaded.';

    function expectStarterFallback(mutate: (draft: ReturnType<typeof sparseDraft>) => void) {
      const draft = sparseDraft();
      mutate(draft);
      const outcome = decodeEditorState(JSON.stringify(draft));
      expect(outcome.source).toBe('starter');
      expect(outcome).toMatchObject({ reason: starterNotice });
    }

    it('falls back when a loan holds extra payments that are not a list', () => {
      expectStarterFallback((draft) => {
        (draft.config.scenarios[0]!.loans[0] as Record<string, unknown>)['extraPrincipalPayments'] = 'x';
      });
    });

    it('falls back when an investment holds contributions that are not a list', () => {
      expectStarterFallback((draft) => {
        (draft.config.common.investments[0] as Record<string, unknown>)['contributions'] = {};
      });
    });

    it('falls back when an events list holds a null entry', () => {
      expectStarterFallback((draft) => {
        (draft.config.common.events as unknown[]).push(null);
      });
    });

    it('falls back when the scenario list holds a null', () => {
      // Already caught by the shallow structure check (with its own notice), so
      // this one never threw; it is pinned here so it stays a fallback.
      const draft = sparseDraft();
      (draft.config.scenarios as unknown[]).push(null);
      expect(decodeEditorState(JSON.stringify(draft)).source).toBe('starter');
    });
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

  // An older save missing settings at every level: entries, their nested lists,
  // an optimizer block, a scenario's lists, and the common block's lists.
  function sparseDraft() {
    return {
      version: EDITOR_STATE_VERSION,
      config: {
        simulation: { startDate: '2025-01', endDate: '2030-01' },
        common: {
          events: [{ id: 'e0', name: 'Rent ', amount: -1500 }],
          investments: [{ id: 'i0', name: 'Fund', startingValue: 100 }],
        },
        scenarios: [
          {
            id: 's0',
            name: 'plan',
            active: true,
            events: [
              {
                id: 'e1',
                name: 'Bonus',
                amount: 500,
                optimize: { field: 'amount', min: 0, max: 900 },
              },
            ],
            loans: [
              {
                id: 'l0',
                name: 'Car',
                principal: 9000,
                sellProperty: false,
                sellPrice: 500,
              },
            ],
          },
        ],
      },
    };
  }

  it('backfills settings missing from nested entries, lists and optimizer blocks', () => {
    const outcome = decodeEditorState(JSON.stringify(sparseDraft()));
    expect(outcome.source).toBe('restored');
    const { common, scenarios } = outcome.config;

    // Lists the save predates are empty lists, not undefined.
    expect(common.loans).toEqual([]);
    expect(scenarios[0]!.investments).toEqual([]);
    expect(common.investments[0]!.contributions).toEqual([]);
    expect(scenarios[0]!.loans[0]!.extraPrincipalPayments).toEqual([]);

    // Fields the save predates are blank, so the inputs render empty.
    expect(common.events[0]!.percentage).toBeNull();
    expect(common.investments[0]!.taxRate).toBeNull();
    expect(scenarios[0]!.loans[0]!.mortgageInsuranceCutoff).toBeNull();
    expect(scenarios[0]!.loans[0]!.earlyPayoffDate).toBe('');
    expect(scenarios[0]!.events[0]!.optimize).toMatchObject({
      field: 'amount',
      min: 0,
      max: 900,
      tolerance: null,
      minDate: '',
    });
    expect(outcome.config.simulation.startingCash).toBeNull();
  });

  it('keeps everything the editor held, including what a config export would drop', () => {
    const { common, scenarios } = decodeEditorState(JSON.stringify(sparseDraft())).config;
    // Not a config round trip: an unticked "sell" keeps its price, and a
    // half-typed name keeps its trailing space.
    expect(scenarios[0]!.loans[0]!.sellPrice).toBe(500);
    expect(scenarios[0]!.loans[0]!.sellProperty).toBe(false);
    expect(common.events[0]!.name).toBe('Rent ');
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
