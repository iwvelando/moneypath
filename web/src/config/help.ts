/**
 * Per-field help text, worded from spec/03-config-v2.md (and the per-context
 * rules it lays out). Every editor field, and every field of the earliest-month
 * form, renders one of these through the help affordance.
 */

import type { EventKind } from './types';

/**
 * Help in two tiers (AGENTS.md, "User-facing text"): the brief, one short line
 * that opens with the help and says what the field does, and the more, behind
 * Show more, for every assumption and limit the simulation applies. A help
 * whose essentials fit the brief is a plain string.
 */
export interface Tiered {
  brief: string;
  more: string;
}
export type Help = string | Tiered;

/** The most words a brief, or a help on one line, may have. */
export const BRIEF_WORDS = 20;
/** The most words a help's more may have. */
export const MORE_WORDS = 80;

export const tiered = (brief: string, more: string): Tiered => ({ brief, more });

export function isTiered(help: Help): help is Tiered {
  return typeof help !== 'string';
}

/** Adds to a help's more, so its brief stays first. */
export function withMore(help: Help, more: string): Tiered {
  return isTiered(help) ? tiered(help.brief, `${help.more} ${more}`) : tiered(help, more);
}

/** The whole text of a help, both tiers in order. */
export function helpText(help: Help): string {
  return isTiered(help) ? `${help.brief} ${help.more}` : help;
}

export const HELP = {
  /* simulation */
  startDate:
    'Optional. The first month the simulation reports. When omitted the simulation starts at the current month.',
  endDate:
    'Required. The simulation runs through this month, inclusive. It must not be before the start month.',
  startingCash: tiered(
    'Required. Your cash balance at the end of the month before the start month.',
    'Everything dated in the start month is counted from it. It may be zero or negative (debt); leaving it blank is treated as 0.00 with a warning.',
  ),
  cashInterestRate: tiered(
    'Optional, default 0. The yearly interest rate your cash earns after tax, entered as an APR (4.5 means 4.5%).',
    'One twelfth is added every month to the cash you had at the end of the previous month, so it ' +
      'compounds: 4.5 works out to about 4.59% a year, the APY a bank would advertise. ' +
      'Leave it at 0 for an account that pays nothing, or enter a high-yield savings rate. ' +
      'Only a positive balance earns interest, and it must be at least 0. ' +
      'The rate is nominal: the plan’s inflation rate is applied separately, so do not subtract it.',
  ),
  inflationRate: tiered(
    'Optional, default 0. How much prices rise each year, in percent: 3 means 3% higher a year later.',
    'Only amounts set to grow with inflation follow it. Amounts are in the start month’s prices and ' +
      'step once a year, on its anniversaries; an amount that stays the same keeps the dollars written. ' +
      'It is a yearly change, not an APR. Interest and return rates stay nominal, so do not subtract ' +
      'inflation from them. Any rate but 0 also lets you read results in today’s dollars. ' +
      'It must be more than -100.',
  ),
  emergencyFundMonths:
    'Months of average expenses to target for the emergency-fund recommendation. Default 6; 0 disables the recommendation.',

  /* guardrails */
  guardrailName:
    'Required, and must be unique among guardrails. It labels this guardrail’s result in every scenario.',
  guardrailKind: tiered(
    'What the guardrail checks.',
    'A cash floor checks that your cash never falls below an amount. Debt-free checks that nothing is owed on your loans from a month on. Investments last checks that the investments you pick are never emptied, or never fall below an amount. A guardrail never stops a forecast: each scenario reports whether it holds, the first month it breaks, and the month it comes closest to breaking.',
  ),
  guardrailAmount: tiered(
    'Required for a cash floor. Your cash must hold at least this much at every month-end the guardrail covers.',
    'Cash is compared with it to the cent, in the start month too, after that month’s own income and spending. The same amount applies in every month unless it is set to grow. It may be negative, to mean “never more than this much overdrawn”.',
  ),
  guardrailGrowth: tiered(
    'How the floor changes each year: it stays the same, follows inflation, or grows at its own rate.',
    'Write the amount in the start month’s prices. The floor steps once a year, on the anniversaries ' +
      'of the plan’s start month, counted from the plan’s start even when the guardrail starts ' +
      'checking later. A floor that stays the same holds the same dollars, so it is worth less as ' +
      'prices rise. Growth rates are yearly changes, not APRs.',
  ),
  guardrailStartDate: tiered(
    'Optional. The first month checked. Defaults to the simulation start month.',
    'If the balance is something you are still building up, start from the month you expect to have it: the result then tells you whether you got there and kept it.',
  ),
  guardrailDeadline: tiered(
    'Required for a debt-free guardrail. From this month on, the loans must owe nothing at the end of every month.',
    'That holds through the end month, so a loan taken out after this month breaks it too. The result gives the month the debt was cleared and how many months early or late that was.',
  ),
  guardrailLoans: tiered(
    'The loans that must be paid off. Leave every box unticked to check every loan a scenario has.',
    'A loan a scenario does not have owes nothing there. A loan owes nothing before it starts, and nothing once it is paid off or sold; escrow you keep paying afterwards is not debt.',
  ),
  guardrailInvestments: tiered(
    'Required for an investments-last guardrail. Tick at least one investment.',
    'Their values are added together at the end of every month the guardrail covers. A scenario with none of them is reported as “does not apply”.',
  ),
  guardrailLastsAmount: tiered(
    'Optional. The least the ticked investments together must hold at the end of every month the guardrail covers.',
    'Their total is compared with it to the cent. Leave it empty to mean they must never be emptied. It must be more than 0.',
  ),
  guardrailEndDate: tiered(
    'Optional. The last month checked, inclusive. Defaults to the simulation end month.',
    'Months outside the simulation are not checked, and a guardrail with no month inside it does not apply.',
  ),
  guardrailUnusedNames: tiered(
    'These names from the plan you loaded have no effect, because this kind of guardrail does not use them.',
    'Take them away to tidy the plan.',
  ),
  guardrailUnusedAmount: tiered(
    'This amount from the plan you loaded has no effect, because a debt-free guardrail does not use it.',
    'Take it away to tidy the plan.',
  ),

  /* scenario */
  scenarioName:
    'Required, and must be unique among scenarios. It labels the scenario in results, notes and CSV columns.',
  scenarioActive:
    'Default on. Inactive scenarios are skipped entirely — no results, no CSV columns.',

  /* choices */
  choiceName:
    'Required, and must be unique among choices. A choice is a decision the plan faces, such as where to live.',
  optionName: tiered(
    'Required, and must be unique within its choice. An option is one way the decision can go.',
    'An option that adds, changes and removes nothing is a valid one: it leaves the baseline as it is.',
  ),
  selection: tiered(
    'The option this scenario takes for this choice. Every scenario picks one option for every choice.',
    'Editing an option changes every scenario that picks it.',
  ),
  baselineTarget: tiered(
    'A baseline entry for this option to change or remove on the paths that pick it.',
    'Type any part of its name to narrow the list. One entry can be changed or removed by the options of one choice only, so an entry another choice already uses is listed but cannot be picked. An entry needs a name that no other baseline entry of its kind shares.',
  ),

  /* event */
  eventName: 'Optional but recommended. Used in notes and warnings so you can tell entries apart.',
  eventFrequency: tiered(
    'Months between occurrences. Default 1 (every month); must be at least 1.',
    'Ignored when the start and end months are the same.',
  ),
  eventStartDate:
    'Optional. The month of the first occurrence. Defaults to the simulation start month.',
  eventEndDate: tiered(
    'Optional. Occurrences continue while they fall on or before this month. Defaults to the simulation end month.',
    'Setting it equal to the start month makes this a one-time event.',
  ),
  eventAmountCashflow: tiered(
    'Signed money value: positive is income (increases cash), negative is spending. Enter income post-tax.',
    'The simulation applies no income tax of its own, so estimate what ' +
      'actually lands in your account. For example, a $1,000 grant at a 25% marginal tax rate ' +
      'should be entered as 750.',
  ),
  growth: tiered(
    'How the amount changes each year: it stays the same, follows inflation, or grows at its own rate.',
    'Write the amount in the start month’s prices. A growing amount steps once a year, on the ' +
      'anniversaries of the plan’s start month, counted from the plan’s start even when this entry ' +
      'starts later. An amount that stays the same keeps the dollars written, so rising prices wear ' +
      'it down. Growth rates are yearly changes, not APRs. Growth has no effect on a percentage withdrawal.',
  ),
  growthRate: tiered(
    'The percent the amount changes each year: 4 means 4% more a year later. A negative rate shrinks it.',
    'It is a yearly change, not an APR, and must be more than -100. The amount is written in the ' +
      'start month’s prices and steps once a year, on the anniversaries of the plan’s start month, ' +
      'counted from the plan’s start. At 0 it stays the same.',
  ),
  eventAmountExtraPrincipal:
    'Must be greater than zero. Money paid toward the loan principal — it leaves your cash.',
  eventAmountContribution:
    'Must be greater than zero. Money added to the account. Percentages are not allowed for contributions.',
  eventAmountWithdrawal:
    'Must be greater than zero. A fixed amount taken out of the account.',
  eventPercentageWithdrawal: tiered(
    'Percent of the current balance to withdraw (after that month’s growth).',
    'Use either an amount or a percentage — never both, and never a mix of the two styles within one investment.',
  ),

  /* loan */
  loanName: 'Required, non-empty. Identifies the loan in notes and warnings.',
  loanPrincipal: 'Required. The original principal, before the down payment is applied.',
  loanDownPayment:
    'Optional, default 0. Paid at the loan start month; must be at least 0 and less than the principal.',
  loanInterestRate: tiered(
    'Required. The loan’s yearly rate (APR): 6.5 means 6.5% a year, charged one twelfth each month.',
    'Zero is allowed. The rate is nominal: the plan’s inflation rate is applied separately and never changes it.',
  ),
  loanTerm: 'Required. Loan length in months; at least 1.',
  loanStartDate: tiered(
    'Required. Month of the first payment.',
    'Loans may start before the simulation window — payments dated before it simply never enter the ledger.',
  ),
  loanEscrow: 'Optional, default 0. Monthly escrow added to each payment; must be at least 0.',
  escrowGrowth: tiered(
    'How the escrow changes each year. Property tax and insurance usually rise with inflation.',
    'Write the escrow in the start month’s prices. It steps once a year, on the anniversaries of the ' +
      'plan’s start month, in every payment and in each December’s bill after a payoff that keeps the ' +
      'property. Escrow that stays the same keeps the dollars written. Growth rates are yearly changes, not APRs.',
  ),
  loanMortgageInsurance: tiered(
    'Optional, default 0. Monthly mortgage insurance added to payments while the remaining/original principal ratio exceeds the cutoff.',
    'With no cutoff set it applies for the whole life of the loan (which raises a warning).',
  ),
  loanMortgageInsuranceCutoff:
    'Optional. Percent between 0 and 100. Mortgage insurance stops once remaining principal falls to this share of the original.',
  loanEarlyPayoffThreshold: tiered(
    'Optional, at least 0. Pays the loan off once cash is at least this much more than the payoff amount.',
    'The payoff amount is the remaining principal plus that month’s interest.',
  ),
  loanEarlyPayoffDate: tiered(
    'Optional. Pay the loan off at this month, for the remaining principal plus that month’s interest.',
    'It should be after the loan start month.',
  ),
  loanSellProperty:
    'Optional. Only meaningful together with an early payoff — on its own it has no effect and raises a warning.',
  loanSellPrice: 'Optional. Defaults to the loan principal when omitted.',
  loanSellCostsNet: 'Optional and signed: positive means closing costs paid at the sale.',
  loanExtraPrincipalPayments:
    'Optional list of events, each with an amount greater than zero, paid toward principal.',

  /* investment */
  investmentName: 'Required, and unique within its list.',
  investmentStartingValue: tiered(
    'Optional, default 0, at least 0. The balance at the end of the month before the start month.',
    'Like starting cash, it grows from the start month on.',
  ),
  investmentAnnualReturnRate: tiered(
    'Optional, default 0. The yearly return, entered like an APR. It may be negative.',
    'One twelfth is applied each month, so it compounds to slightly more over a year (7 grows about 7.23% a year). To model an average annual return of exactly 7%, enter 6.78. The rate is nominal: the plan’s inflation rate is applied separately, so do not subtract inflation from it.',
  ),
  investmentTaxRate: tiered(
    'Optional, default 0. Percent applied to positive monthly growth, modelling tax drag on gains.',
    'Must be at least 0 and less than 100.',
  ),
  investmentWithdrawalTaxRate:
    'Optional, default 0. Percent applied to the growth portion of withdrawals. Must be at least 0 and less than 100.',
  investmentContributionsFromCash: tiered(
    'Default off. When on, contributions are deducted from simulated cash (post-tax money).',
    'When off they come from outside the simulation, e.g. a payroll deduction.',
  ),
  investmentFundLoanPayoffs: tiered(
    'Default off. When on, this account helps pay loans off early: it is liquidated to cover what cash cannot.',
    'Its after-tax liquidation value counts toward loan early-payoff threshold checks. Intended for taxable accounts — do not flag retirement accounts, since the engine applies only the withdrawal tax rate and no penalties.',
  ),

  /* optimizer */
  optimizeBlock: tiered(
    'Available on scenario events only.',
    'When adjusting a negative amount, the optimizer finds the largest affordable expense within your bounds while the scenario stays within what the value is held to: the emergency-fund floor, or a guardrail you choose. For other targets, it finds the smallest change from what you configured that keeps to it.',
  ),
  optimizeField: tiered(
    'Which field to adjust: amount, frequency, start month or end month.',
    'For a negative amount, finds the largest affordable expense within your bounds. For other targets, finds the smallest change needed to keep to what the value is held to.',
  ),
  optimizeMin: 'Required lower bound for amount or frequency. For frequency it must be an integer of at least 1.',
  optimizeMax: 'Required upper bound for amount or frequency; it must be greater than the lower bound.',
  optimizeMinDate: 'Required inclusive lower bound month for a start- or end-month search.',
  optimizeMaxDate: 'Required inclusive upper bound month; it must not be before the lower bound.',
  optimizeTolerance: tiered(
    'Optional. How close the search must get before stopping.',
    'Defaults to 0.01 for amount and 1 (month or count) otherwise. Amounts are searched in whole cents, so asking for less than a cent changes nothing.',
  ),
  optimizeMaxIterations: 'Optional, default 50. Caps how many candidate values the search evaluates.',
  optimizeGuardrail: tiered(
    'What the value is held to.',
    'The emergency fund keeps cash at or above this scenario’s emergency-fund target once it is reached. A guardrail must hold in every month it checks, on this scenario.',
  ),

  /* earliest month */
  earliestTarget: tiered(
    'The month to move.',
    'An event’s start or end moves on its own; a one-off event moves as a whole; a loan’s start moves its whole schedule. Everything else stays as your plan has it.',
  ),
  earliestFrom: 'The first month to try. Every month from here to the last one is tried in turn.',
  earliestTo: 'The last month to try.',
  earliestGuardrails: tiered(
    'A month works when every guardrail ticked here holds in it.',
    'A guardrail that does not apply to this scenario starts unticked.',
  ),

  /* results */
  netWorth: 'Net worth is cash and investments less what your loans still owe. It counts no home, car or other property.',
} satisfies Record<string, Help>;

export type HelpKey = keyof typeof HELP;

export function eventAmountHelp(kind: EventKind): Help {
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
