# 03 — Configuration format (v2)

*Status: **Contract** — this format is a promise to YAML files users already have.
Change this chapter before the code. See SPEC.md.*

A moneypath config is a single YAML document. This chapter is normative. See
`examples/example.yaml` for a commented example.

## Conventions

- **Dates** are strings in `YYYY-MM` form (calendar month precision). Anything else is a
  validation error.
- **Money** values are decimal numbers in one currency (the tool is currency-agnostic).
  For **events**, positive = income (increases cash), negative = expense. Loan and
  investment monetary fields are positive magnitudes unless stated otherwise.
- **Money amounts are post-tax.** The engine models no income tax, so every amount the
  user enters is what actually lands in (or leaves) their account: income should be net
  of withholding. A $1,000 grant at a 25 % marginal rate is entered as `750.00`. The only
  tax the engine applies is on investment growth and withdrawals (`taxRate`,
  `withdrawalTaxRate`), and any user-facing help for an amount field SHOULD say so.
- **Rates** are percentages (e.g. `6.5` means 6.5 % per year), never fractions.
- Unknown top-level or nested keys SHOULD produce a validation warning naming the key
  (catches typos), but MUST NOT be a hard error.

## Top level

```yaml
version: 2            # required, must be the integer 2

simulation:
  startDate: 2025-06  # optional; default: the current month at run time
  endDate: 2090-01    # required; the simulation stops at this month (inclusive)
  startingCash: 30000.00   # required; cash balance as of the END of the month
                           # preceding startDate

recommendations:      # optional block
  emergencyFundMonths: 6   # optional; default 6; 0 disables the recommendation

common:               # optional; shared by every scenario
  events: []
  loans: []
  investments: []

scenarios:            # required; at least one
  - name: current path     # required, must be unique among scenarios
    active: true           # optional; default true; inactive scenarios are skipped
    events: []
    loans: []
    investments: []
```

Validation (hard errors): missing/wrong `version`; missing `simulation.endDate`;
`endDate` before `startDate`; no scenarios; a scenario without a name; duplicate scenario
names. `startingCash` MAY be zero or negative (debt) — absent is treated as `0.00` with
a warning.

Validation (warnings, not errors): an event that starts at/after `simulation.endDate`, or
ends after it; unknown keys; `startingCash` absent.

## Event

Used in `events` lists, and (same shape, minus `optimize`) for loan
`extraPrincipalPayments` and investment `contributions`/`withdrawals`.

```yaml
- name: Social security   # optional but recommended; used in notes/warnings
  amount: 1000.00         # signed; + income, − expense (see per-context rules below)
  frequency: 1            # optional; months between occurrences; default 1; must be ≥ 1
  startDate: 2050-01      # optional; default: simulation start month
  endDate: 2060-01        # optional; default: simulation end month
  optimize: {…}           # optional; events in scenarios only — see below
```

Occurrence rule (normative): the event occurs at `startDate`, then every `frequency`
months (`startDate + k*frequency` for k = 0,1,2,…) for as long as the occurrence is
≤ `endDate`. If `startDate == endDate` the event occurs exactly once (a one-time event),
regardless of `frequency`.

Per-context rules:

- **Cash-flow events** (`common.events`, scenario `events`): `amount` is signed, and
  post-tax like every other amount (see Conventions).
- **Extra principal payments** (in loans): `amount` must be > 0; it is money paid toward
  loan principal (cash out).
- **Investment contributions**: `amount` must be > 0. `percentage` is not allowed.
- **Investment withdrawals**: specify **either** `amount` (> 0) **or** `percentage`
  (> 0, percent of current balance), never both in one entry, and a single investment
  MUST NOT mix amount-style and percentage-style withdrawal entries.

## Loan

```yaml
- name: 1234 Street Address   # required, non-empty
  principal: 150000.00        # required; original principal before down payment
  downPayment: 10000.00       # optional; default 0; paid at startDate
  interestRate: 3.75          # required; annual percentage; 0 is allowed
  term: 360                   # required; months; ≥ 1
  startDate: 2018-01          # required; month of the first payment
  escrow: 500.00              # optional; monthly escrow added to each payment
  mortgageInsurance: 50.00    # optional; monthly MI added to payments while the
                              # remaining/original principal ratio exceeds the cutoff
  mortgageInsuranceCutoff: 78.0  # optional; percent; see chapter 04 §Loans
  earlyPayoffThreshold: 5000.00  # optional; see chapter 04 §Early payoff by threshold
  earlyPayoffDate: 2022-06    # optional; pay the loan off at this month
  sellProperty: true          # optional; only meaningful with an early payoff
  sellPrice: 153000.00        # optional; default: principal
  sellCostsNet: 9500.00       # optional; signed; positive = costs paid at sale
  extraPrincipalPayments: []  # optional; list of Events (amount > 0)
```

Loans may start before `simulation.startDate`; payments dated before the simulation
window simply never enter the ledger (the engine bills only simulated months).

Validation: `principal > 0`; `term ≥ 1`; `interestRate ≥ 0`; `downPayment ≥ 0` and
`< principal`; `escrow ≥ 0`; `mortgageInsurance ≥ 0`; cutoff in `[0, 100]`;
`earlyPayoffThreshold ≥ 0`; `earlyPayoffDate`, when present, must parse and SHOULD be
warned about if it is not after `startDate`. `sellProperty` without either early-payoff
mechanism is a warning (it has no effect). `mortgageInsurance > 0` with no
`mortgageInsuranceCutoff` means MI applies for the whole life of the loan (warning).

## Investment

```yaml
- name: Brokerage account    # required, unique within its list
  startingValue: 25000.00    # optional; default 0; balance at simulation start
  annualReturnRate: 6.5      # optional; default 0; annual percent, compounded monthly
  taxRate: 15.0              # optional; default 0; percent applied to positive monthly
                             # growth (models tax drag on gains)
  withdrawalTaxRate: 15.0    # optional; default 0; percent applied to the growth
                             # portion of withdrawals
  contributionsFromCash: true # optional; default false; when true, contributions are
                              # deducted from simulated cash (post-tax contributions);
                              # when false they come from outside the simulation
                              # (e.g. payroll deduction)
  fundLoanPayoffs: true      # optional; default false; when true, this account's
                             # after-tax liquidation value counts toward loan
                             # early-payoff threshold checks and the account is
                             # liquidated to cover what cash cannot (chapter 04
                             # §Early payoff). Intended for taxable accounts —
                             # do not flag retirement accounts (the engine applies
                             # only withdrawalTaxRate, no penalties)
  contributions: []          # optional; list of Events (amount > 0)
  withdrawals: []            # optional; list of Events (amount XOR percentage)
```

Validation: `taxRate` and `withdrawalTaxRate` must be in `[0, 100)` (the payoff-funding
gross-up in chapter 04 divides by `1 − withdrawalTaxRate/100`); `annualReturnRate` may
be negative; `startingValue ≥ 0`.

## Optimizer block (events in scenarios only)

```yaml
optimize:
  field: amount         # required: amount | frequency | startDate | endDate
  min: 0                # amount/frequency: required numeric lower bound
  max: 2500             # amount/frequency: required numeric upper bound
  minDate: 2025-10      # startDate/endDate: required lower bound (inclusive)
  maxDate: 2026-08      # startDate/endDate: required upper bound (inclusive)
  tolerance: 0.5        # optional; default 0.01 for amount, 1 (month/count) otherwise
  maxIterations: 60     # optional; default 50
```

Validation: field must be one of the four (accept `startDate`/`start_date`/`start-date`
case-insensitively, and likewise for `endDate`); the relevant bound pair is required with
min < max (for `frequency`, min ≥ 1 and integer-valued); dates must parse with
minDate ≤ maxDate. An `optimize` block on a `common` event is an error. Optimizer
semantics are in chapter 04 §Optimizer.

## What v2 removed relative to v1

`logging:` and `output:` blocks are no longer part of the plan config — they were tool
settings, not plan data, and are now CLI flags (chapter 05). The optimizer `kind` and
`target` keys are gone (there was only ever one supported value of each). See chapter 07.
