import { describe, expect, it } from 'vitest';
import { emptyEvent, emptyInvestment, emptyLoan } from '../../config/types';
import { eventSummary, investmentSummary, loanSummary } from './summaries';

const simulation = { startDate: '2026-01', endDate: '2030-12', startingCash: 0, emergencyFundMonths: null };

describe('editor summaries reflect entered values and documented defaults', () => {
  it('shows signed cash flow, default monthly cadence, and inherited dates', () => {
    const summary = eventSummary({ ...emptyEvent(), amount: -4400 }, 'cashflow', simulation);
    expect(summary.primary).toBe('-$4,400.00 · Monthly');
    expect(summary.detail).toContain('2026-01 through 2030-12');
  });
  it('recognizes a one-time event even when its frequency says otherwise', () => {
    const summary = eventSummary({ ...emptyEvent(), amount: 500, startDate: '2027-06', endDate: '2027-06', frequency: 12 }, 'cashflow', simulation);
    expect(summary.primary).toContain('Once');
    expect(summary.detail).toBe('2027-06');
  });
  it('describes percentage withdrawals without treating them as money', () => {
    expect(eventSummary({ ...emptyEvent(), percentage: 4, frequency: 12 }, 'withdrawal', simulation).primary)
      .toBe('4% of balance · Every 12 months');
  });
  it('keeps missing values and an omitted simulation start explicit', () => {
    const summary = eventSummary(emptyEvent(), 'cashflow', { ...simulation, startDate: '' });
    expect(summary.primary).toContain('Amount not set');
    expect(summary.detail).toContain('Simulation start');
  });
  it('surfaces optional loan settings rather than silently hiding them', () => {
    const summary = loanSummary({ ...emptyLoan(), principal: 200000, interestRate: 4, term: 360, startDate: '2020-01', escrow: 500, earlyPayoffThreshold: 0, sellProperty: true });
    expect(summary.primary).toContain('$200,000.00 principal');
    expect(summary.detail).toContain('Escrow');
    expect(summary.detail).toContain('Early payoff');
    expect(summary.detail).toContain('Property sale');
  });
  it('keeps existing field errors visible on collapsed entries and their parents', () => {
    expect(eventSummary({ ...emptyEvent(), startDate: '2026-99' }, 'cashflow', simulation).attention).toBe(true);
    expect(loanSummary({ ...emptyLoan(), name: 'Loan', startDate: '' }).attention).toBe(true);
    expect(investmentSummary({ ...emptyInvestment(), name: 'Account', contributions: [{ ...emptyEvent(), endDate: '2027-' }] }).attention).toBe(true);
    expect(investmentSummary({ ...emptyInvestment(), name: 'Account' }).attention).toBe(false);
  });
  it('shows investment defaults, cash source, taxes, and nested schedules', () => {
    const summary = investmentSummary({ ...emptyInvestment(), contributions: [emptyEvent()], withdrawals: [emptyEvent()], taxRate: 15 });
    expect(summary.primary).toBe('$0.00 starting value · 0% annual return');
    expect(summary.detail).toContain('1 contribution');
    expect(summary.detail).toContain('1 withdrawal');
    expect(summary.detail).toContain('Tax settings');
    expect(summary.detail).toContain('Contributions from outside the plan');
  });
});
