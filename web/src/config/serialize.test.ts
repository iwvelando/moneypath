import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  fromConfigDocument,
  isLegacyDocument,
  normalizeOptimizeField,
  serializeEvent,
  serializeInvestment,
  serializeLoan,
  toConfigDocument,
  toConfigYaml,
} from './serialize';
import { emptyEvent, emptyInvestment, emptyLoan, type ConfigModel } from './types';
import { starterConfig } from './starter';

function model(): ConfigModel {
  return starterConfig('2025-06');
}

describe('editor model -> config document', () => {
  it('always declares version 2 and a simulation block', () => {
    const doc = toConfigDocument(model());
    expect(doc['version']).toBe(2);
    expect(doc['simulation']).toMatchObject({ startDate: '2025-06', startingCash: 25000 });
  });

  it('emits the cash interest rate under simulation, and omits it when blank', () => {
    const withRate = model();
    withRate.simulation.cashInterestRate = 4.25;
    expect(toConfigDocument(withRate)['simulation']).toMatchObject({ cashInterestRate: 4.25 });

    const blank = model();
    blank.simulation.cashInterestRate = null;
    expect(toConfigDocument(blank)['simulation']).not.toHaveProperty('cashInterestRate');
  });

  it('keeps an explicit zero cash interest rate, which is meaningful', () => {
    const zero = model();
    zero.simulation.cashInterestRate = 0;
    expect(toConfigDocument(zero)['simulation']).toMatchObject({ cashInterestRate: 0 });
  });

  it('reads the cash interest rate back, treating an absent one as blank', () => {
    const read = fromConfigDocument({
      version: 2,
      simulation: { endDate: '2030-01', startingCash: 100, cashInterestRate: 3.5 },
      scenarios: [{ name: 'a' }],
    });
    expect(read.simulation.cashInterestRate).toBe(3.5);

    const absent = fromConfigDocument({
      version: 2,
      simulation: { endDate: '2030-01', startingCash: 100 },
      scenarios: [{ name: 'a' }],
    });
    expect(absent.simulation.cashInterestRate).toBeNull();
  });

  it('round-trips the cash interest rate through YAML text', () => {
    const original = model();
    original.simulation.cashInterestRate = 4.5;
    const again = fromConfigDocument(parseYaml(toConfigYaml(original)));
    expect(again.simulation.cashInterestRate).toBe(4.5);
  });

  it('omits blank and null fields rather than emitting empty values', () => {
    const event = emptyEvent();
    event.amount = -35;
    expect(serializeEvent(event, 'cashflow')).toEqual({ amount: -35 });
  });

  it('keeps zero, which is meaningful, while dropping null', () => {
    const investment = emptyInvestment();
    investment.name = 'Roth';
    investment.startingValue = 0;
    investment.annualReturnRate = null;
    expect(serializeInvestment(investment)).toEqual({ name: 'Roth', startingValue: 0 });
  });

  it('emits optimize only for scenario cash-flow events', () => {
    const event = emptyEvent();
    event.amount = 1000;
    event.optimize = {
      field: 'startDate',
      min: null,
      max: null,
      minDate: '2025-01',
      maxDate: '2026-01',
      tolerance: 1,
      maxIterations: 50,
    };
    expect(serializeEvent(event, 'cashflow')['optimize']).toEqual({
      field: 'startDate',
      minDate: '2025-01',
      maxDate: '2026-01',
      tolerance: 1,
      maxIterations: 50,
    });
    expect(serializeEvent(event, 'extraPrincipalPayment')['optimize']).toBeUndefined();
    expect(serializeEvent(event, 'contribution')['optimize']).toBeUndefined();
  });

  it('emits only the bound pair that belongs to the picked optimize field', () => {
    const event = emptyEvent();
    event.optimize = {
      field: 'amount',
      min: 0,
      max: 2500,
      minDate: '2025-01',
      maxDate: '2026-01',
      tolerance: 0.01,
      maxIterations: 50,
    };
    const optimize = serializeEvent(event, 'cashflow')['optimize'] as Record<string, unknown>;
    expect(optimize['min']).toBe(0);
    expect(optimize['max']).toBe(2500);
    expect(optimize['minDate']).toBeUndefined();
    expect(optimize['maxDate']).toBeUndefined();
  });

  it('uses percentage instead of amount for percentage-style withdrawals', () => {
    const event = emptyEvent();
    event.amount = 2000;
    event.percentage = 4;
    expect(serializeEvent(event, 'withdrawal')).toEqual({ percentage: 4 });
    event.percentage = null;
    expect(serializeEvent(event, 'withdrawal')).toEqual({ amount: 2000 });
  });

  it('only emits sale fields when the property is actually sold', () => {
    const loan = emptyLoan();
    loan.name = 'House';
    loan.principal = 150000;
    loan.sellPrice = 195000;
    loan.sellCostsNet = 9500;
    expect(serializeLoan(loan)['sellPrice']).toBeUndefined();
    loan.sellProperty = true;
    expect(serializeLoan(loan)).toMatchObject({ sellProperty: true, sellPrice: 195000, sellCostsNet: 9500 });
  });

  it('produces a string that parses as YAML (JSON is valid YAML)', () => {
    const yaml = toConfigYaml(model());
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed['version']).toBe(2);
    expect(Array.isArray(parsed['scenarios'])).toBe(true);
  });
});

describe('config document -> editor model', () => {
  it('round-trips the starter config without losing data', () => {
    const original = model();
    const restored = fromConfigDocument(toConfigDocument(original));
    expect(toConfigDocument(restored)).toEqual(toConfigDocument(original));
  });

  it('defaults scenario.active to true in v2', () => {
    const restored = fromConfigDocument({ scenarios: [{ name: 'a' }, { name: 'b', active: false }] });
    expect(restored.scenarios[0]?.active).toBe(true);
    expect(restored.scenarios[1]?.active).toBe(false);
  });

  it('reads unquoted YAML months as strings', () => {
    const parsed = parseYaml('simulation:\n  startDate: 2025-06\n  endDate: 2090-01\n');
    const restored = fromConfigDocument(parsed);
    expect(restored.simulation.startDate).toBe('2025-06');
    expect(restored.simulation.endDate).toBe('2090-01');
  });

  it('never produces a scenario-less model', () => {
    expect(fromConfigDocument({}).scenarios).toHaveLength(1);
    expect(fromConfigDocument(null).scenarios).toHaveLength(1);
  });

  it('gives every list row a unique id', () => {
    const restored = fromConfigDocument(toConfigDocument(model()));
    const ids = [
      ...restored.common.events.map((e) => e.id),
      ...restored.common.loans.map((l) => l.id),
      ...restored.common.investments.map((i) => i.id),
      ...restored.scenarios.map((s) => s.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('optimize field spellings', () => {
  it('accepts the documented aliases case-insensitively', () => {
    expect(normalizeOptimizeField('startDate')).toBe('startDate');
    expect(normalizeOptimizeField('START_DATE')).toBe('startDate');
    expect(normalizeOptimizeField('end-date')).toBe('endDate');
    expect(normalizeOptimizeField('Amount')).toBe('amount');
    expect(normalizeOptimizeField('nonsense')).toBeNull();
  });
});

describe('legacy detection', () => {
  it('flags a config with no version field', () => {
    expect(isLegacyDocument({ common: { startingValue: 1 } })).toBe(true);
  });

  it('flags a config carrying common.deathDate even if versioned', () => {
    expect(isLegacyDocument({ version: 2, common: { deathDate: '2090-01' } })).toBe(true);
  });

  it('does not flag a plain v2 config', () => {
    expect(isLegacyDocument({ version: 2, common: { events: [] } })).toBe(false);
  });
});
