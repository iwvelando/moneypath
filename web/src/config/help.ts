/**
 * Per-field help text, worded from spec/03-config-v2.md (and the per-context
 * rules it lays out). Every editor field renders one of these through the help
 * affordance.
 */

import type { EventKind } from './types';

export const HELP = {
  /* simulation */
  startDate:
    'Optional. The first month the simulation reports. When omitted the simulation starts at the current month.',
  endDate:
    'Required. The simulation runs through this month, inclusive. It must not be before the start month.',
  startingCash:
    'Required. Cash balance as of the end of the month preceding the start month. It may be zero or negative (debt); leaving it blank is treated as 0.00 with a warning.',
  emergencyFundMonths:
    'Months of average expenses to target for the emergency-fund recommendation. Default 6; 0 disables the recommendation.',

  /* scenario */
  scenarioName:
    'Required, and must be unique among scenarios. It labels the scenario in results, notes and CSV columns.',
  scenarioActive:
    'Default on. Inactive scenarios are skipped entirely — no results, no CSV columns.',

  /* event */
  eventName: 'Optional but recommended. Used in notes and warnings so you can tell entries apart.',
  eventFrequency:
    'Months between occurrences. Default 1 (every month); must be at least 1. Ignored when the start and end months are the same.',
  eventStartDate:
    'Optional. The month of the first occurrence. Defaults to the simulation start month.',
  eventEndDate:
    'Optional. Occurrences continue while they fall on or before this month. Defaults to the simulation end month. Setting it equal to the start month makes this a one-time event.',
  eventAmountCashflow:
    'Signed money value: positive is income (increases cash), negative is spending. ' +
    'Enter income post-tax — the simulation applies no income tax of its own, so estimate what ' +
    'actually lands in your account. For example, a $1,000 grant at a 25% marginal tax rate ' +
    'should be entered as 750.',
  eventAmountExtraPrincipal:
    'Must be greater than zero. Money paid toward the loan principal — it leaves your cash.',
  eventAmountContribution:
    'Must be greater than zero. Money added to the account. Percentages are not allowed for contributions.',
  eventAmountWithdrawal:
    'Must be greater than zero. A fixed amount taken out of the account.',
  eventPercentageWithdrawal:
    'Percent of the current balance to withdraw (after that month’s growth). Use either an amount or a percentage — never both, and never a mix of the two styles within one investment.',

  /* loan */
  loanName: 'Required, non-empty. Identifies the loan in notes and warnings.',
  loanPrincipal: 'Required. The original principal, before the down payment is applied.',
  loanDownPayment:
    'Optional, default 0. Paid at the loan start month; must be at least 0 and less than the principal.',
  loanInterestRate: 'Required. Annual percentage — 6.5 means 6.5 % per year. Zero is allowed.',
  loanTerm: 'Required. Loan length in months; at least 1.',
  loanStartDate:
    'Required. Month of the first payment. Loans may start before the simulation window — payments dated before it simply never enter the ledger.',
  loanEscrow: 'Optional, default 0. Monthly escrow added to each payment; must be at least 0.',
  loanMortgageInsurance:
    'Optional, default 0. Monthly mortgage insurance added to payments while the remaining/original principal ratio exceeds the cutoff. With no cutoff set it applies for the whole life of the loan (which raises a warning).',
  loanMortgageInsuranceCutoff:
    'Optional. Percent between 0 and 100. Mortgage insurance stops once remaining principal falls to this share of the original.',
  loanEarlyPayoffThreshold:
    'Optional, at least 0. Pay the loan off in the first month cash exceeds the remaining principal by at least this much.',
  loanEarlyPayoffDate: 'Optional. Pay the loan off at this month. It should be after the loan start month.',
  loanSellProperty:
    'Optional. Only meaningful together with an early payoff — on its own it has no effect and raises a warning.',
  loanSellPrice: 'Optional. Defaults to the loan principal when omitted.',
  loanSellCostsNet: 'Optional and signed: positive means closing costs paid at the sale.',
  loanExtraPrincipalPayments:
    'Optional list of events, each with an amount greater than zero, paid toward principal.',

  /* investment */
  investmentName: 'Required, and unique within its list.',
  investmentStartingValue: 'Optional, default 0. Balance at the simulation start; must be at least 0.',
  investmentAnnualReturnRate:
    'Optional, default 0. Annual percent, compounded monthly. It may be negative.',
  investmentTaxRate:
    'Optional, default 0. Percent applied to positive monthly growth, modelling tax drag on gains. Must be at least 0 and less than 100.',
  investmentWithdrawalTaxRate:
    'Optional, default 0. Percent applied to the growth portion of withdrawals. Must be at least 0 and less than 100.',
  investmentContributionsFromCash:
    'Default off. When on, contributions are deducted from simulated cash (post-tax money). When off they come from outside the simulation, e.g. a payroll deduction.',
  investmentFundLoanPayoffs:
    'Default off. When on, this account’s after-tax liquidation value counts toward loan early-payoff threshold checks, and the account is liquidated to cover what cash cannot. Intended for taxable accounts — do not flag retirement accounts, since the engine applies only the withdrawal tax rate and no penalties.',

  /* optimizer */
  optimizeBlock:
    'Available on scenario events only. With the optimizer on, the chosen field is adjusted to the value needing the smallest change from what you configured while keeping cash at or above the emergency-fund floor.',
  optimizeField: 'Which field to adjust: amount, frequency, start month or end month.',
  optimizeMin: 'Required lower bound for amount or frequency. For frequency it must be an integer of at least 1.',
  optimizeMax: 'Required upper bound for amount or frequency; it must be greater than the lower bound.',
  optimizeMinDate: 'Required inclusive lower bound month for a start- or end-month search.',
  optimizeMaxDate: 'Required inclusive upper bound month; it must not be before the lower bound.',
  optimizeTolerance:
    'Optional. How close the search must get before stopping. Defaults to 0.01 for amount and 1 (month or count) otherwise. Amounts are searched in whole cents, so asking for less than a cent changes nothing.',
  optimizeMaxIterations: 'Optional, default 50. Caps how many candidate values the search evaluates.',
} as const;

export type HelpKey = keyof typeof HELP;

export function eventAmountHelp(kind: EventKind): string {
  switch (kind) {
    case 'extraPrincipalPayment':
      return HELP.eventAmountExtraPrincipal;
    case 'contribution':
      return HELP.eventAmountContribution;
    case 'withdrawal':
      return HELP.eventAmountWithdrawal;
    default:
      return HELP.eventAmountCashflow;
  }
}

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  cashflow: 'Event',
  extraPrincipalPayment: 'Extra principal payment',
  contribution: 'Contribution',
  withdrawal: 'Withdrawal',
};
