import { describe, expect, it } from 'vitest';
import { EDITOR_STATE_VERSION, decodeEditorState, encodeEditorState } from './persistence';
import { starterConfig } from '../config/starter';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { fromConfigDocument, toConfigDocument } from '../config/serialize';

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
      // A draft without the key is held to the emergency fund.
      guardrail: '',
    });
    expect(outcome.config.simulation.startingCash).toBeNull();
  });

  it('restores entries saved before growth existed as fixed, and the inflation rate as blank', () => {
    const draft = sparseDraft() as { version: number; config: Record<string, unknown> };
    draft.config['guardrails'] = [{ id: 'g0', name: 'Cushion', kind: 'cashFloor', amount: 500 }];
    const outcome = decodeEditorState(JSON.stringify(draft));
    expect(outcome.source).toBe('restored');
    const { common, scenarios, guardrails, simulation } = outcome.config;
    const fixed = { mode: 'fixed', rate: null };
    expect(simulation.inflationRate).toBeNull();
    expect(common.events[0]!.growth).toEqual(fixed);
    expect(scenarios[0]!.events[0]!.growth).toEqual(fixed);
    expect(scenarios[0]!.loans[0]!.escrowGrowth).toEqual(fixed);
    expect(guardrails[0]!.growth).toEqual(fixed);
    const doc = JSON.stringify(toConfigDocument(outcome.config));
    expect(doc).not.toContain('rowth');
    expect(doc).not.toContain('inflationRate');
  });

  it('keeps everything the editor held, including what a config export would drop', () => {
    const { common, scenarios } = decodeEditorState(JSON.stringify(sparseDraft())).config;
    // Not a config round trip: an unticked "sell" keeps its price, and a
    // half-typed name keeps its trailing space.
    expect(scenarios[0]!.loans[0]!.sellPrice).toBe(500);
    expect(scenarios[0]!.loans[0]!.sellProperty).toBe(false);
    expect(common.events[0]!.name).toBe('Rent ');
  });

  it('restores a draft saved before guardrails existed as a plan with none', () => {
    const outcome = decodeEditorState(JSON.stringify(sparseDraft()));
    expect(outcome.source).toBe('restored');
    expect(outcome.config.guardrails).toEqual([]);
    expect(toConfigDocument(outcome.config)).not.toHaveProperty('guardrails');
  });

  it('restores guardrails, backfilling what a saved one predates', () => {
    const draft = sparseDraft() as { version: number; config: Record<string, unknown> };
    draft.config['guardrails'] = [{ id: 'g0', name: 'Cushion', kind: 'cashFloor', amount: 500 }];
    const outcome = decodeEditorState(JSON.stringify(draft));
    expect(outcome.source).toBe('restored');
    expect(outcome.config.guardrails).toMatchObject([
      { name: 'Cushion', kind: 'cashFloor', amount: 500, startDate: '', endDate: '', investments: null, loans: null },
    ]);
    expect(outcome.config.guardrails[0]!.id).not.toBe('g0');
  });

  it('falls back when the saved guardrails are not a list', () => {
    const draft = sparseDraft() as { version: number; config: Record<string, unknown> };
    draft.config['guardrails'] = { name: 'Cushion' };
    expect(decodeEditorState(JSON.stringify(draft)).source).toBe('starter');
  });

  describe('choices', () => {
    // vitest runs from web/.
    const withChoices = () =>
      fromConfigDocument(parseYaml(readFileSync(resolve(process.cwd(), '../examples/choices.yaml'), 'utf8')));

    it('restores a draft saved before choices existed as a plan with none', () => {
      const outcome = decodeEditorState(JSON.stringify(sparseDraft()));
      expect(outcome.source).toBe('restored');
      expect(outcome.config.choices).toEqual([]);
      expect(outcome.config.scenarios[0]!.select).toEqual({});
      expect(toConfigDocument(outcome.config)).not.toHaveProperty('choices');
    });

    it('restores choices, selections and targets', () => {
      const config = withChoices();
      const outcome = decodeEditorState(encodeEditorState(config));
      expect(outcome.source).toBe('restored');
      expect(toConfigDocument(outcome.config)).toEqual(toConfigDocument(config));
    });

    it('backfills what an option or a change predates', () => {
      const draft = sparseDraft() as { version: number; config: Record<string, unknown> };
      draft.config['choices'] = [
        {
          id: 'c0',
          name: 'Housing',
          options: [
            { id: 'o0', name: 'Keep' },
            {
              id: 'o1',
              name: 'Sell',
              loans: [{ id: 'l9', name: 'New loan' }],
              change: { investments: [{ id: 't0', targetId: 'i0', targetName: 'Fund', set: { contributions: [{ id: 'e9', amount: 5 }] } }] },
              remove: { events: [{ id: 't1', targetId: 'e0', targetName: 'Rent' }] },
            },
          ],
        },
      ];
      (draft.config['scenarios'] as Record<string, unknown>[])[0]!['select'] = { c0: 'o1' };

      const outcome = decodeEditorState(JSON.stringify(draft));
      expect(outcome.source).toBe('restored');
      const [keep, sell] = outcome.config.choices[0]!.options;
      expect(keep).toMatchObject({ events: [], change: { events: [], loans: [], investments: [] }, remove: { loans: [] } });
      expect(sell!.loans[0]!.extraPrincipalPayments).toEqual([]);
      expect(sell!.change.investments[0]!.set.contributions![0]!.endDate).toBe('');
      expect(sell!.change.investments[0]!.targetId).toBe(outcome.config.common.investments[0]!.id);
      expect(sell!.remove.events[0]!.targetId).toBe(outcome.config.common.events[0]!.id);
      expect(outcome.config.scenarios[0]!.select).toEqual({ [outcome.config.choices[0]!.id]: sell!.id });
    });

    it('falls back when the saved choices are not a list', () => {
      const draft = sparseDraft() as { version: number; config: Record<string, unknown> };
      draft.config['choices'] = 'x';
      expect(decodeEditorState(JSON.stringify(draft)).source).toBe('starter');
    });

    it('falls back when an option holds something that is not a list', () => {
      const draft = sparseDraft() as { version: number; config: Record<string, unknown> };
      draft.config['choices'] = [{ id: 'c0', name: 'x', options: [{ id: 'o0', name: 'y', change: { loans: 3 } }] }];
      expect(decodeEditorState(JSON.stringify(draft)).source).toBe('starter');
    });
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
