# 03 — Configuration format (v2)

*Status: **Contract** — this format is a promise to YAML files users already have.
Change this chapter before the code. See SPEC.md.*

A moneypath config is a single YAML document. This chapter is normative. See
`examples/example.yaml` for a commented example, and `examples/choices.yaml` for one
with choices.

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
  `withdrawalTaxRate`), and the user-facing help for a cash-flow event's amount MUST say
  so.
- **Rates** are percentages (e.g. `6.5` means 6.5 % per year), never fractions.
- **Annual rates are APRs.** `interestRate`, `annualReturnRate` and `cashInterestRate`
  are nominal yearly rates: the engine applies one twelfth each month (chapter 04
  preamble). For a loan that is the rate on the statement. For cash and investments the
  monthly compounding yields slightly more over a year than the number entered — the
  APY: `4.0` yields about 4.07 %, `7.0` about 7.23 %. A figure quoted as an APY (most
  savings accounts) or as an average annual return can be entered exactly as
  `1200 · ((1 + APY/100)^(1/12) − 1)`; for an APY of 7 that is `6.78`. User-facing help
  for these fields MUST name the convention, and MUST say that the rate is nominal: the
  plan's inflation rate is applied separately, so it is not subtracted from the rate as
  well.
- **Growth and inflation rates are yearly changes, not APRs.** `inflationRate` and a
  numeric `growth` or `escrowGrowth` (see Growth) are the percent by which a price or an
  amount is higher a year later, as inflation and raises are quoted: `3.0` means 3 %
  higher. Nothing about them is applied a twelfth at a time.
- Unknown top-level or nested keys SHOULD produce a validation warning naming the key
  (catches typos), but MUST NOT be a hard error.
- **Whole numbers** (`version`, `frequency`, `term`, `maxIterations`) take no fraction:
  `1.5` where a whole number belongs is a validation error, never rounded.
- **Validation reports everything it finds.** Every rule below that a config breaks is
  reported, each with the field it concerns, not only the first (chapter 02, "Problems
  JSON"). A config with any hard error is not run.

## Top level

```yaml
version: 2            # required, must be the integer 2

simulation:
  startDate: 2025-06  # optional; default: the current month at run time
  endDate: 2090-01    # required; the simulation stops at this month (inclusive)
  startingCash: 30000.00   # required; cash balance as of the END of the month
                           # preceding startDate
  cashInterestRate: 4.0    # optional; default 0; APR earned on positive cash,
                           # compounded monthly — about 4.07 % a year (chapter 04 §1)
  inflationRate: 3.0       # optional; default 0; percent a year, year over year — what
                           # growth: inflation follows (see Growth)

recommendations:      # optional block
  emergencyFundMonths: 6   # optional; default 6; 0 disables the recommendation

guardrails: []        # optional; conditions every path is checked against — see
                      # Guardrails

common:               # optional; shared by every scenario (the baseline)
  events: []
  loans: []
  investments: []

choices: []           # optional; decisions with named options — see Choices

scenarios:            # required; at least one
  - name: current path     # required, must be unique among scenarios
    active: true           # optional; default true; inactive scenarios are skipped
    select: {}             # one option for every choice in the plan — see Choices
    events: []
    loans: []
    investments: []
```

Validation (hard errors): missing/wrong `version`; missing `simulation.endDate`;
`endDate` before `startDate`; no scenarios; a scenario without a name; duplicate scenario
names; `cashInterestRate` below zero; `inflationRate` that is not a number, or is −100 or
less. `startingCash` MAY be zero or negative (debt) — absent is treated as `0.00` with a
warning.

`cashInterestRate` models where the cash is kept: the default `0` is the worst case (a
non-interest-bearing account), and a higher rate models keeping most or all cash in, say,
a high-yield savings account. It is one rate for the whole simulation, applies to every
scenario, and is entered **after tax** like every other money figure (see Conventions).
Only a positive balance earns it; the engine has no overdraft rate (chapter 04 §1).

`inflationRate` is the one rate at which prices rise, for the whole plan and every
scenario. It changes nothing on its own: only an amount whose growth is `inflation`
follows it (see Growth). It may be negative, for falling prices. There is no inflation
rate per scenario or per option.

Validation (warnings, not errors): an event that starts at/after `simulation.endDate`, or
ends after it; unknown keys; `startingCash` absent.

## Event

Used in `events` lists, and (same shape, minus `optimize`) for loan
`extraPrincipalPayments` and investment `contributions`/`withdrawals`.

```yaml
- name: Social security   # optional but recommended; used in notes/warnings
  amount: 1000.00         # signed; + income, − expense (see per-context rules below)
  growth: inflation       # optional; default fixed — see Growth
  frequency: 1            # optional; months between occurrences; default 1; must be ≥ 1
  startDate: 2050-01      # optional; default: simulation start month
  endDate: 2060-01        # optional; default: simulation end month
  optimize: {…}           # optional; a scenario's own events only — see below
```

Occurrence rule (normative): the event occurs at `startDate`, then every `frequency`
months (`startDate + k*frequency` for k = 0,1,2,…) for as long as the occurrence is
≤ `endDate`. If `startDate == endDate` the event occurs exactly once (a one-time event),
regardless of `frequency`.

Per-context rules:

- **Cash-flow events** (`common.events`, scenario `events`, an option's `events`):
  `amount` is signed, and
  post-tax like every other amount (see Conventions).
- **Extra principal payments** (in loans): `amount` must be > 0; it is money paid toward
  loan principal (cash out).
- **Investment contributions**: `amount` must be > 0. `percentage` is not allowed.
- **Investment withdrawals**: specify **either** `amount` (> 0) **or** `percentage`
  (> 0, percent of current balance), never both in one entry, and a single investment
  MUST NOT mix amount-style and percentage-style withdrawal entries. `growth` on a
  percentage withdrawal is a warning: a percentage of the balance already scales, so it
  has no effect.

Every event takes `growth`, in each of these contexts: a cash-flow event, an extra
principal payment, a contribution and a withdrawal by amount.

## Growth

`growth` on an event and on a guardrail, and `escrowGrowth` on a loan, say how an amount
changes over the plan's years. Each takes one of:

- `fixed` — the default, written by leaving the key out: the amount stays the same in
  nominal dollars in every month.
- `inflation` — the amount follows `simulation.inflationRate`.
- a number — the amount's own yearly rate, in percent, year over year (Conventions): `4`
  means 4 % more each year. It may be negative, for an amount that shrinks, and must be
  more than −100. `0` behaves exactly as `fixed`.

The amount written is the amount in the plan's first year, in the start month's prices.
It changes once a year, on the plan's anniversaries — the start month's month in each
later year — counted from the plan's start whenever the entry itself starts (chapter 04
§2). So an amount written in today's prices keeps its value in today's dollars when it
follows inflation, whenever it occurs. Growth adds no note to the results.

What can grow: every event's `amount` (above), a loan's `escrow` (`escrowGrowth`) and a
guardrail's `amount` (Guardrails). Nothing else does: not a loan's principal, payment,
down payment or mortgage insurance, a sale price, a starting balance, a threshold or a
percentage withdrawal.

User-facing help for `inflationRate`, for every `growth` and `escrowGrowth`, MUST state
what the simulation assumes: amounts are written in the start month's prices; an amount
that grows steps once a year on the plan's anniversaries; a fixed amount stays the same
in nominal dollars; and growth rates are yearly changes, not APRs.

Validation, hard errors:

- A `growth` or `escrowGrowth` other than `fixed`, `inflation` or a number, which
  includes a quoted number, a list and a mapping. The words are matched exactly.
- A number of −100 or less.
- The same under an option's `change` → `set` (Choices).

Warnings:

- `inflation` when the plan's `inflationRate` is absent or 0: the amount stays the same.
  The warning is placed at that `growth` or `escrowGrowth`.
- `growth` where it has no effect: on a percentage withdrawal (Event), on a `debtFree`
  guardrail or on a `lasts` with no `amount` (Guardrails), and `escrowGrowth` on a loan
  with no escrow (Loan).

Canonical form: `growth` is written after `amount`, in an event and in a guardrail;
`escrowGrowth` after `escrow`; `inflationRate` after `cashInterestRate`. `fixed` is
written by leaving the key out, and a number is written as a number.

A moneypath build that predates growth warns about the unknown keys and computes every
amount fixed. The format stays at version 2.

## Loan

```yaml
- name: 1234 Street Address   # required, non-empty
  principal: 150000.00        # required; original principal before down payment
  downPayment: 10000.00       # optional; default 0; paid at startDate
  interestRate: 3.75          # required; APR (annual percentage rate); 0 is allowed
  term: 360                   # required; months; ≥ 1
  startDate: 2018-01          # required; month of the first payment
  escrow: 500.00              # optional; monthly escrow added to each payment
  escrowGrowth: inflation     # optional; default fixed — see Growth
  mortgageInsurance: 50.00    # optional; monthly MI added to payments while the
                              # remaining/original principal ratio exceeds the cutoff
  mortgageInsuranceCutoff: 78.0  # optional; percent; see chapter 04 §Loans
  earlyPayoffThreshold: 5000.00  # optional; see chapter 04 §Early payoff by threshold
  earlyPayoffDate: 2022-06    # optional; pay the loan off at this month (the balance
                              # plus that month's interest)
  sellProperty: true          # optional; only meaningful with an early payoff
  sellPrice: 153000.00        # optional; default: principal
  sellCostsNet: 9500.00       # optional; signed; positive = costs paid at sale
  extraPrincipalPayments: []  # optional; list of Events (amount > 0)
```

Loans may start before `simulation.startDate`; payments dated before the simulation
window simply never enter the ledger (the engine bills only simulated months).

Validation: `principal > 0`; `term ≥ 1`; `interestRate ≥ 0`; `downPayment ≥ 0` and
`< principal`; `escrow ≥ 0`; `mortgageInsurance ≥ 0`; cutoff in `[0, 100]`;
`earlyPayoffThreshold ≥ 0`; `escrowGrowth` as Growth says; `earlyPayoffDate`, when
present, must parse and SHOULD be warned about if it is not after `startDate`. `sellProperty` without either early-payoff
mechanism is a warning (it has no effect). `mortgageInsurance > 0` with no
`mortgageInsuranceCutoff` means MI applies for the whole life of the loan (warning).
`escrowGrowth` with no escrow (absent or 0) is a warning: there is nothing to grow.

## Investment

```yaml
- name: Brokerage account    # required, unique within its list
  startingValue: 25000.00    # optional; default 0; balance as of the END of the
                             # month preceding the simulation's startDate
  annualReturnRate: 6.5      # optional; default 0; APR, compounded monthly — about
                             # 6.70 % a year; may be negative
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

## Choices

A choice is a decision the plan faces, and its options are the ways it can go. A scenario
is then a selection, one option per choice, in place of a copy of every entry that the
paths share. `choices` and `select` are optional. A plan without them resolves to
itself: each scenario is its own entries and `common`.

```yaml
choices:
  - name: Housing          # required, unique among choices
    options:               # required, at least one
      - name: Keep the house        # required, unique within the choice
      - name: Sell and rent
        events: []         # entries this option adds
        loans: []
        investments: []
        change:            # common entries this option alters
          loans:
            - name: Mortgage        # which common loan
              set:                  # required; the fields to replace
                earlyPayoffDate: 2027-06
                sellProperty: true
        remove:            # common entries this option takes away
          events: [Gym]

scenarios:
  - name: sell
    select:                # one option for every choice in the plan
      Housing: Sell and rent
    events: []             # a scenario's own entries
```

- `common` is the baseline: what holds on every path unless an option says otherwise.
- An option with no key but its `name` is valid. It is the option that changes nothing.
- An option's `events`, `loans` and `investments` take the same entries, under the same
  rules, as a scenario's, except that an event cannot carry an `optimize` block.
- `select` maps a choice's name to the name of one of its options. Names match exactly.
  A choice named twice in one `select` is an error.
- A scenario keeps its own `events`, `loans` and `investments` for what belongs to that
  path alone.

### Resolution

Each scenario resolves to the two lists the engine simulates (chapter 04 §1). Its
selected options are taken **in the order the choices are listed in the plan**; the
order of the keys in `select` has no effect.

1. **The resolved shared list** starts as `common`. Each selected option's `change` and
   `remove` are applied to it. A changed entry keeps its place in the list; a removed
   one is dropped.
2. **The resolved scenario list** is the scenario's own entries in the order written,
   followed by each selected option's added entries in the order written.

So entries are processed in the order: the scenario's own, then the selected options'
in choice order, then the baseline, from the most specific to the most general. The
order decides numbers, not only presentation: it is the order loans are checked for a
threshold payoff and the order accounts are tapped to fund one (chapter 04 §3.5).

Only the scenarios the plan names are resolved and simulated, never every combination
of options.

### `change` and `remove`

Both name a `common` entry by its kind (`events`, `loans`, `investments`) and its
`name`. Nothing is overridden by a matching name alone: an entry an option adds never
replaces a baseline entry, whatever it is called.

- **`remove`** drops the entry for the scenarios that select the option.
- **`change`** replaces the fields listed under `set` and keeps the rest.
  - A nested list (`extraPrincipalPayments`, `contributions`, `withdrawals`) is replaced
    as a whole.
  - A field set to null (`~`) is taken away, so it falls back to its default.
  - `name` and `optimize` cannot be set.
  - `set` is required and is a mapping; an empty one changes nothing. A value of the
    wrong type for its field is an error.
- Replacing an entry outright is a `remove` and an added entry, both written out.
- Only `common` entries can be targeted, never an entry another option adds, so every
  option is valid on its own, whatever it is selected with.

**When a value depends on more than one choice.** One baseline entry can be changed or
removed by the options of one choice only (see the errors below); otherwise a scenario
selecting two such options would have two answers for one field and only the order of
the choices to pick between them. The format expresses the case in other ways:

- *Make the entry its own choice.* Take it out of `common` and let each option of a new
  choice add its version. Every scenario picks one beside its other selections.
- *Add instead of change.* Amounts sum, so options of different choices can each add
  an event of their own (a top-up, a cut) beside the baseline entry, without touching
  it. This covers amounts only, not a rate or a date.

### Validation

Hard errors:

- A choice with no name, a name another choice has, or no options.
- An option with no name, or a name another option of its choice has.
- A scenario that picks no option for one of the plan's choices, names a choice the
  plan does not have, or names an option its choice does not have. This holds for
  inactive scenarios too.
- A `change` or `remove` whose target `common` does not have, or has more than once
  under that name. A misspelt name is therefore an error, never a silent addition. An
  event without a name cannot be targeted.
- One baseline entry changed or removed twice in one option.
- One baseline entry changed or removed by options of two different choices. This is
  checked once for the plan, whatever the scenarios select.
- A `change` without a `set`, or one that sets `name` or `optimize`.
- An `optimize` block on an option's event.
- Every rule for an event, loan or investment, applied to each option's added entries
  and to each baseline entry **as changed**, whether or not any scenario selects the
  option.
- Every rule for a scenario's lists, applied to each resolved scenario list, active or
  not. An investment's name is unique within its list, so a scenario's own investments
  and those its selected options add cannot share a name. Two options of one choice
  can, since no scenario selects both.

Warnings: the existing ones, each naming the choice and option it concerns. An unknown
key inside `set` is warned about like any other. A warning that a baseline entry
already raises as written in `common` is not repeated for its changed form, and
neither is a hard error. An option that no scenario selects is not warned about.

### Canonical form

The plan as echoed (`--write-config`, `configYaml`) keeps the written form, with
`choices` and `select`, never the resolved lists. Top-level keys are written
`guardrails`, `common`, `choices`, `scenarios` (see Guardrails for where they go); a scenario's keys are `name`, `active`, `select`, then its entry
lists; an option's are `name`, its entry lists, `change`, `remove`; and `select` is
written in the order the choices are listed.

### Reading a plan with choices in an older moneypath

A moneypath build that predates choices follows the rule for unknown keys: it warns
about `choices` and `select`, and forecasts each scenario from `common` and the
scenario's own entries alone. The format stays at version 2 all the same: a new version
would refuse such a file in an old build at the price of a migration for every file
that needs no change.

## Guardrails

A guardrail is a condition the plan's owner wants every path to meet, such as "keep at
least $15,000 in cash". It is checked month by month over a window, on every active
scenario and on a flipped path (chapter 02, Results JSON), and each path reports
whether it holds, the first month it breaks and its tightest month (chapter 04 §10). A
guardrail adds nothing to the simulation and never stops a run: a broken guardrail is
a result, not a problem.

```yaml
guardrails:                # optional; checked on every path
  - name: Keep a cushion   # required, unique among guardrails
    kind: cashFloor        # required: cashFloor | debtFree | lasts
    amount: 15000.00       # cashFloor: required; any number, negative allowed
    growth: inflation      # optional; default fixed — see Growth
    startDate: 2027-01     # optional; first month checked (default: plan start)
    endDate: 2035-12       # optional; last month checked (default: plan end)

  - name: Mortgage gone before I retire
    kind: debtFree
    startDate: 2045-01            # debtFree: required; the deadline
    loans: [Mortgage]             # optional; default: every loan on the path

  - name: Retirement savings last
    kind: lasts
    investments: [401k, Roth IRA] # lasts: required; taken together
    amount: 50000.00              # optional; default: never emptied
    startDate: 2055-01            # e.g. from the month withdrawals begin
```

- The list is plan-wide. Options and scenarios cannot add, change or remove a
  guardrail, so every path is judged against the same conditions.
- `startDate` and `endDate` give every kind the same window, inclusive at both ends, in
  the same `YYYY-MM` form as an event's dates. Months outside the simulation are not
  checked.
- `kind` says what is checked:
  - **`cashFloor`** — cash is at least `amount` in every month of the window. `amount`
    is the same nominal amount in every month, unless `growth` says otherwise. It may be
    negative, which states "never more than this overdrawn", as `startingCash` may be.
  - **`debtFree`** — nothing is owed, from `startDate` through the end of the window,
    on the loans listed in `loans`, or on every loan of the path when `loans` is left
    out. `startDate` is required: it is the deadline. A loan taken out after the
    deadline breaks it, and a listed loan a path does not have owes nothing there.
  - **`lasts`** — the accounts listed in `investments`, taken together, are never
    emptied in any month of the window or, with `amount`, never hold less than
    `amount`. A path that has none of the listed accounts is not judged by it.
- `growth` (see Growth) lets the `amount` of a `cashFloor` or a `lasts` change over the
  plan's years, counted from the plan's start and not from the window's `startDate`, so
  `amount` is in the start month's prices, as an event's is.
- `investments` and `loans` take lists of entry names, for the kinds that use them:
  `investments` for a `lasts`, `loans` for a `debtFree`. Each name must be the name
  of an entry of that kind somewhere in the plan: in `common`, in an option's added
  entries, or in a scenario's own entries, active or not. A name may be listed only
  once. Loans with the same name on one path are counted together.
- There is no severity: all guardrails are equal.

Validation, hard errors:

- A guardrail with no name, or a name another guardrail has.
- No `kind`, or a kind other than the three.
- A `cashFloor` without `amount`.
- A `debtFree` without `startDate`, or with an empty `loans` list (leave the list out
  to check every loan).
- A `lasts` without `investments`, or with an empty list; a `lasts` with an `amount` of
  zero or less. Zero would always hold, and "never emptied" is what an absent amount
  means.
- In the list a kind uses, a name that no entry of that kind in the plan has, or a
  name listed twice. The problem is placed at the name (`loans.<j>`,
  `investments.<j>`), at its second listing for a repeat.
- A `startDate` or `endDate` that does not parse, or an `endDate` before the
  `startDate` when both are given.
- A `growth` as Growth refuses it.
- The usual wrong-type rules.

Warnings:

- A window with no month inside the simulation: the guardrail does not apply on any
  path. The simulation's start can default to the current month, so a window can
  drift out of range on its own, as an event's can. The warning is placed at
  `startDate` when the window starts after the simulation ends, and otherwise at
  `endDate`.
- A key the kind does not use (`investments` or `loans` on a `cashFloor`, `amount`,
  `growth` or `investments` on a `debtFree`, `loans` on a `lasts`), and `growth` on a
  `lasts` with no `amount`: it has no effect. The names in a list the kind does not use
  are not checked against the plan.
- `inflation` as the growth when the plan's inflation rate is absent or 0 (Growth).
- Unknown keys, as everywhere.

Problems are placed at `guardrails.<i>.<field>`, and their place in words is
`Guardrail “<name>”`, numbered from 1 when the guardrail has no name.

Canonical form: `guardrails` is written after `recommendations` and before `common`.
A guardrail's keys are written `name`, `kind`, `amount`, `growth`, `investments`,
`loans`, `startDate`, `endDate`.

A moneypath build that predates guardrails warns about the unknown key and checks
nothing. The format stays at version 2.

## Optimizer block (a scenario's own events only)

```yaml
optimize:
  field: amount         # required: amount | frequency | startDate | endDate
  min: 0                # amount/frequency: required numeric lower bound
  max: 2500             # amount/frequency: required numeric upper bound
  minDate: 2025-10      # startDate/endDate: required lower bound (inclusive)
  maxDate: 2026-08      # startDate/endDate: required upper bound (inclusive)
  tolerance: 0.5        # optional; default 0.01 for amount, 1 (month/count) otherwise
  maxIterations: 60     # optional; default 50
  guardrail: Cushion    # optional; the guardrail the value is held to (default: the emergency fund)
```

Validation: field must be one of the four (accept `startDate`/`start_date`/`start-date`
case-insensitively, and likewise for `endDate`); the relevant bound pair is required with
min < max (for `frequency`, min ≥ 1 and integer-valued); dates must parse with
minDate ≤ maxDate. A target with `growth` keeps it: an `amount` search chooses the amount
written, in the start month's prices, and its bounds are in the same terms. An `optimize`
block on a `common` event or on an option's event is an error: the optimizer chooses a
value against one scenario's floor and writes it into the plan, and those entries are
shared by more than one scenario. A target goes in a scenario's own events. Optimizer semantics are in chapter 04 §Optimizer.

`guardrail` names one of the plan's guardrails (Guardrails, above) by its `name`. The
target is then held to that guardrail instead of the emergency-fund floor. Absent or
empty, it is held to the emergency fund. Errors, each placed at the target's
`optimize.guardrail`:

- A name no guardrail of the plan has.
- A guardrail whose window has no month inside the plan.
- A `lasts` guardrail that names no investment the target's scenario has, among the
  scenario's resolved lists (Choices) — those of its own entries, the options it
  selects and `common`.

In the last two cases the guardrail would not apply to the target's scenario (chapter 04
§10), so it has nothing to hold the value to. The rules apply to every scenario, active or
not, as every other rule does. A plan whose start defaults to the current month can come
to break the second rule as time passes, as a guardrail can drift out of the plan.

Canonical form: an optimizer block's keys are written `field`, `min`, `max`, `minDate`,
`maxDate`, `tolerance`, `maxIterations`, `guardrail`, and an empty `guardrail` is left
out.

## Files that are not version 2

A file with no `version` field is refused. So is a plan written for finance-forecast,
the tool moneypath succeeds, which had no such field; nothing converts one. Both
refusals say so plainly.
