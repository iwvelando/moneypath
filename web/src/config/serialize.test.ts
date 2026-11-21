import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  fromConfigDocument,
  isFinanceForecastDocument,
  normalizeOptimizeField,
  serializeEvent,
  serializeInvestment,
  serializeLoan,
  toConfigDocument,
  toConfigYaml,
} from './serialize';
import { emptyEvent, emptyGuardrail, emptyInvestment, emptyLoan, type ConfigModel } from './types';
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

  it('reads the guardrail an optimizer target is held to, treating an absent one as blank', () => {
    const read = fromConfigDocument({
      version: 2,
      simulation: { endDate: '2030-01', startingCash: 100 },
      scenarios: [
        {
          name: 'a',
          events: [
            { amount: -1, optimize: { field: 'amount', min: -1, max: 0, guardrail: 'Cushion' } },
            { amount: -1, optimize: { field: 'amount', min: -1, max: 0 } },
          ],
        },
      ],
    });
    const [held, fund] = read.scenarios[0]!.events;
    expect(held!.optimize?.guardrail).toBe('Cushion');
    expect(fund!.optimize?.guardrail).toBe('');
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
      guardrail: '',
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
      guardrail: '',
    };
    const optimize = serializeEvent(event, 'cashflow')['optimize'] as Record<string, unknown>;
    expect(optimize['min']).toBe(0);
    expect(optimize['max']).toBe(2500);
    expect(optimize['minDate']).toBeUndefined();
    expect(optimize['maxDate']).toBeUndefined();
  });

  it('writes the guardrail a target is held to last, and leaves out none', () => {
    const event = emptyEvent();
    event.optimize = {
      field: 'amount',
      min: -500,
      max: 0,
      minDate: '',
      maxDate: '',
      tolerance: 0.01,
      maxIterations: 50,
      guardrail: 'Cushion',
    };
    const optimize = serializeEvent(event, 'cashflow')['optimize'] as Record<string, unknown>;
    expect(Object.keys(optimize)).toEqual(['field', 'min', 'max', 'tolerance', 'maxIterations', 'guardrail']);
    expect(optimize['guardrail']).toBe('Cushion');
    event.optimize.guardrail = '';
    expect(serializeEvent(event, 'cashflow')['optimize']).not.toHaveProperty('guardrail');
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

describe('finance-forecast detection', () => {
  it('flags a config with no version field', () => {
    expect(isFinanceForecastDocument({ common: { startingValue: 1 } })).toBe(true);
  });

  it('flags a config carrying common.deathDate even if versioned', () => {
    expect(isFinanceForecastDocument({ version: 2, common: { deathDate: '2090-01' } })).toBe(true);
  });

  it('does not flag a plain v2 config', () => {
    expect(isFinanceForecastDocument({ version: 2, common: { events: [] } })).toBe(false);
  });
});

describe('guardrails', () => {
  const written = {
    version: 2,
    simulation: { startDate: '2026-01', endDate: '2031-01', startingCash: 20000 },
    recommendations: { emergencyFundMonths: 6 },
    guardrails: [
      { name: 'Cushion', kind: 'cashFloor', amount: 15000 },
      { name: 'Later', kind: 'cashFloor', amount: -250, startDate: '2027-01', endDate: '2030-12' },
      { name: 'Mortgage gone', kind: 'debtFree', loans: ['Mortgage'], startDate: '2030-01' },
    ],
    common: { events: [{ name: 'Pay', amount: 100 }] },
    scenarios: [{ name: 'a', active: true }],
  };

  it('reads them and writes them back as written, after recommendations and before common', () => {
    const read = fromConfigDocument(written);
    expect(read.guardrails.map((g) => g.name)).toEqual(['Cushion', 'Later', 'Mortgage gone']);
    expect(read.guardrails[1]).toMatchObject({ kind: 'cashFloor', amount: -250, startDate: '2027-01', endDate: '2030-12' });
    const doc = toConfigDocument(read);
    expect(Object.keys(doc)).toEqual(['version', 'simulation', 'recommendations', 'guardrails', 'common', 'scenarios']);
    expect(doc['guardrails']).toEqual(written.guardrails);
    expect(Object.keys((doc['guardrails'] as object[])[2]!)).toEqual(['name', 'kind', 'loans', 'startDate']);
  });

  it('keeps a kind it cannot check and the names a kind does not use, for the engine to report', () => {
    const read = fromConfigDocument({
      ...written,
      guardrails: [{ name: 'Odd', kind: 'cashfloor', amount: 1, investments: ['Fund'], loans: [] }],
    });
    expect(toConfigDocument(read)['guardrails']).toEqual([
      { name: 'Odd', kind: 'cashfloor', amount: 1, investments: ['Fund'], loans: [] },
    ]);
  });

  it('leaves them out of a plan that has none', () => {
    const read = fromConfigDocument({ ...written, guardrails: undefined });
    expect(read.guardrails).toEqual([]);
    expect(toConfigDocument(read)).not.toHaveProperty('guardrails');
  });

  it('writes a new guardrail as a cash floor with what has been entered', () => {
    const config = model();
    config.guardrails = [{ ...emptyGuardrail(), name: ' Cushion ', amount: 0 }];
    expect(toConfigDocument(config)['guardrails']).toEqual([{ name: 'Cushion', kind: 'cashFloor', amount: 0 }]);
  });
});

describe('growth', () => {
  const written = {
    version: 2,
    simulation: { startDate: '2026-06', endDate: '2036-05', startingCash: 0, cashInterestRate: 4, inflationRate: 3 },
    guardrails: [{ name: 'Cushion', kind: 'cashFloor', amount: 20000, growth: 'inflation' }],
    common: {
      events: [
        { name: 'Salary', amount: 5000, growth: 4 },
        { name: 'Rent', amount: -2000, growth: 'inflation' },
        { name: 'Phone', amount: -80 },
        { name: 'Shrinking', amount: -100, growth: -10 },
      ],
      loans: [
        {
          name: 'Home',
          principal: 100000,
          interestRate: 4,
          term: 360,
          startDate: '2026-06',
          escrow: 300,
          escrowGrowth: 'inflation',
          extraPrincipalPayments: [{ amount: 100, growth: 2 }],
        },
      ],
      investments: [
        {
          name: '401k',
          contributions: [{ amount: 500, growth: 3 }],
          withdrawals: [{ amount: 1000, growth: 'inflation', startDate: '2040-01' }],
        },
      ],
    },
    choices: [
      {
        name: 'Growth',
        options: [
          { name: 'As written' },
          {
            name: 'Fixed',
            change: {
              events: [{ name: 'Rent', set: { growth: null } }, { name: 'Salary', set: { growth: 2 } }],
              loans: [{ name: 'Home', set: { escrowGrowth: 'inflation' } }],
            },
          },
        ],
      },
    ],
    scenarios: [{ name: 'a', active: true, select: { Growth: 'As written' } }],
  };

  it('reads every growth and writes it back as written, in canonical order', () => {
    const read = fromConfigDocument(written);
    expect(read.simulation.inflationRate).toBe(3);
    expect(read.common.events.map((e) => e.growth)).toEqual([
      { mode: 'rate', rate: 4 },
      { mode: 'inflation', rate: null },
      { mode: 'fixed', rate: null },
      { mode: 'rate', rate: -10 },
    ]);
    const doc = toConfigDocument(read);
    expect(doc).toEqual(written);
    expect(Object.keys(doc['simulation'] as object)).toEqual([
      'startDate',
      'endDate',
      'startingCash',
      'cashInterestRate',
      'inflationRate',
    ]);
    const common = doc['common'] as { events: object[]; loans: object[] };
    expect(Object.keys(common.events[0]!)).toEqual(['name', 'amount', 'growth']);
    expect(Object.keys(common.loans[0]!).slice(5, 7)).toEqual(['escrow', 'escrowGrowth']);
    expect(Object.keys((doc['guardrails'] as object[])[0]!)).toEqual(['name', 'kind', 'amount', 'growth']);
  });

  it('writes fixed by leaving growth out, and reads the word fixed as fixed', () => {
    const read = fromConfigDocument({ ...written, common: { events: [{ name: 'Phone', amount: -80, growth: 'fixed' }] }, choices: undefined });
    expect(read.common.events[0]!.growth).toEqual({ mode: 'fixed', rate: null });
    expect(serializeEvent(read.common.events[0]!, 'cashflow')).toEqual({ name: 'Phone', amount: -80 });
  });

  it('keeps a growth it cannot use, for the engine to report', () => {
    const read = fromConfigDocument({
      ...written,
      common: { events: [{ name: 'Typo', amount: 1, growth: 'inflaton' }, { name: 'Quoted', amount: 1, growth: '3' }] },
      choices: undefined,
    });
    expect(read.common.events.map((e) => serializeEvent(e, 'cashflow')['growth'])).toEqual(['inflaton', '3']);
  });

  it('leaves out an own rate not yet entered', () => {
    const event = { ...emptyEvent(), amount: 1, growth: { mode: 'rate', rate: null } };
    expect(serializeEvent(event, 'cashflow')).not.toHaveProperty('growth');
  });
});
