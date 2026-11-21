# 04 — Engine semantics (normative)

*Status: **Contract** — this chapter is the record of which money behaviors are
deliberate. Change it before the code, alongside the fixtures that pin the new numbers,
and say so in the commit message. See SPEC.md.*

This chapter defines exactly what the simulator computes. `testdata/conformance/`
fixtures encode these rules numerically; when prose and fixture disagree, treat it as a
spec bug and flag it rather than silently choosing one.

Throughout: `r` denotes a monthly interest rate derived from an annual percentage `A` as
`r = A / 100 / 12`. Every annual rate is therefore an **APR** (a nominal rate): a twelfth
of it applies each month, and for cash and investments the compounding makes the yearly
yield (the APY, `(1 + r)^12 − 1`) slightly higher than the number entered — 7 % APR yields
about 7.23 %. This is the convention loans are quoted in, and one convention for every
rate keeps a loan and an account at the same percentage directly comparable; a user
holding an APY or a long-run average annual return can convert it (chapter 03,
Conventions). "Month arithmetic" means calendar-month stepping (`2025-11` + 3 =
`2026-02`). All internal math is float64; **comparisons that decide behavior** (loan
reaching zero, threshold triggers, the optimizer's cash-floor test, whether an
emergency fund has a shortfall, whether a guardrail holds) round both sides to 2 decimals first
(`round2(x) = math.Round(x*100)/100`), so float noise in a sum of cent amounts never
decides an outcome.

## 1. The simulation loop

Every scenario is simulated from two ordered lists of entries: its **resolved scenario
list** and its **resolved shared list** (chapter 03, Choices). In a plan without choices
these are the scenario's own entries and `common`. With choices, the scenario list is
the scenario's own entries followed by those its selected options add, and the shared
list is `common` as those options change it, so the shared list can differ from one
scenario to the next. In this chapter "scenario" and "common" entries mean the entries
of those two resolved lists, and "scenario, then common" means that order.

For each **active** scenario, independently:

- Let `start` = `simulation.startDate` (or the caller-supplied current month when
  absent), `end` = `simulation.endDate`.
- The months simulated are `start` through `end`, both included, and every one of them is
  recorded. When `start == end` the plan is that one month. A plan whose end is before
  its start is a validation error (chapter 03) and is never simulated.
- State: `cash = simulation.startingCash`, which is the balance at the **end of the month
  before `start`** (chapter 03); `r_cash` = the monthly rate derived from
  `simulation.cashInterestRate` (0 when unset); per-investment states (§4), whose
  `startingValue` is read the same way; loan schedules precomputed (§3) for the loans of
  the resolved scenario list and of the resolved shared list.
- The month before `start` is not recorded. `startingCash` and the starting values are
  where the first simulated month begins, so everything dated in `start` — an event
  occurrence, a loan's down payment and payment, an investment contribution, a month of
  interest and growth — is part of the row recorded at `start`.
- For each month `m` = `start`, `start+1`, … up to and including `end`:

  1. **Events and cash interest**: `eventDelta` = sum of `amount · G(m)` over every
     occurrence (§2) at `m` among the resolved scenario and common events, where `G` is
     the event's growth factor (§2.1). `cashInterest` =
     `max(0, cash) · r_cash`, where `cash` is the balance at the end of `m−1`: the one
     recorded there, or `startingCash` when `m = start` (see §1.1).
  2. **Investments** (§4): process every scenario and common investment for `m`,
     yielding `investmentDelta` (net change in combined investment value),
     `cashContributions` (Σ contributions of investments with
     `contributionsFromCash: true`), and `withdrawalCash` (Σ over investments of
     `withdrawal − withdrawalTax`). Investment activity emits notes (§6).
  3. **Threshold payoff check** (§3.5): for each loan (the resolved scenario list in
     order, then the resolved shared list), check against
     `projectedLiquid = cash + cashInterest + eventDelta − cashContributions + withdrawalCash`.
     A triggered payoff rewrites that loan's schedule at `m`, emits a note, and — when
     `fundLoanPayoffs` investments cover a cash shortfall — performs their withdrawals
     (the proceeds and value changes join `withdrawalCash` and `investmentDelta` for
     steps 5–6). Before the next loan's check, `projectedLiquid` is updated by the
     fired payoff's net cash effect (liquidation proceeds minus the payoff payment).
  4. **Loans**: `loanDelta` = −Σ of every loan's scheduled payment amount at `m`
     (a schedule is a sparse date→payment map; months without entries contribute 0).
  5. **Update cash**:
     `cash += cashInterest + eventDelta + loanDelta − cashContributions + withdrawalCash`.
  6. **Record**: `liquid[m] = cash`;
     `total[m] = cash + (running sum of investment values)`.
  7. Accumulate emergency-fund expense stats (§5) for the first 12 simulated months.

Results per scenario: the date→liquid and date→total series, date→notes lists, and
metrics (§5, §7).

### 1.1 Cash interest

Cash earns interest the way an investment grows (§4 step 1): simple interest at the
monthly rate, compounding month over month because each month's interest is added to the
balance the next month earns on.

- **Base**: the balance at the end of the previous month — before this month's events,
  loan payments, contributions, and withdrawals. Money that arrives in month `m` starts
  earning in `m+1`, exactly as a new investment contribution does. Interest is computed
  on the same balance as the month's other flows regardless of their order, so it can
  never depend on how events happen to be listed.
- **Positive balances only**: a zero or negative balance earns nothing. Negative cash is
  debt, and the engine has no overdraft or borrowing rate; a savings rate MUST NOT be
  charged against it. Model the cost of carrying debt with a loan.
- **Untaxed**: no tax is applied. `cashInterestRate` is understood as an after-tax yield
  (chapter 03, Conventions).
- **Silent**: interest emits no notes (§6) — it would put a line in every month of every
  scenario.
- **Not an expense or an income**: interest is not part of `monthlyExpenses` (§5) and
  does not change `initialLiquid`, which is `startingCash` (§5). It does count in `projectedLiquid` for threshold payoffs (§3.5), because it
  is cash in hand that month.
- The first interest accrues in month `start`, on `startingCash`: that is the balance at
  the end of the month before `start`.
- Unrounded, like investment growth; only the rendered CSV rounds to cents.

## 2. Event occurrences

An event with `startDate` S (default: simulation start), `endDate` E (default:
simulation end), `frequency` f ≥ 1 (default 1) occurs at S, S+f, S+2f, … for every
occurrence ≤ E. If S == E the event occurs exactly once at S. Occurrences are matched by
exact month equality — an event whose stride jumps over `end` simply stops. Events with
S > E (after defaulting) are invalid (validation error). Occurrences outside the
simulated window contribute nothing.

### 2.1 Growth

Growth (chapter 03, Growth) does not change when an event occurs. It scales what occurs.

- For a month `m`, `k = ⌊(m − start) / 12⌋` is the plan year `m` falls in, counting from
  0 at `start` (§1), and rounding down, so a month before `start` falls in a year before
  the first. Only a loan's schedule reaches such a month (§3.2).
- The **growth factor** of an entry is `G(m) = (1 + g/100)^k`, where `g` is the entry's
  own yearly rate, `simulation.inflationRate` (0 when unset) for `inflation`, and 0 for
  `fixed`. `G(m) = 1` in every month of the plan's first year, and exactly 1 in every
  month when `g` is 0.
- An occurrence of an event in month `m` moves `amount · G(m)`. So an event steps on the
  plan's anniversaries, whenever it starts, and a one-off event dated in the plan's
  sixth year moves `amount · (1 + g/100)^5`.
- `G` is an integer power, computed by multiplying `k` times (and taking the reciprocal
  for a negative `k`), so that every build computes the same bits. A grown amount is not
  rounded, like interest and investment growth; comparisons that decide behavior round
  as the preamble says, and the CSV rounds when it renders.
- Growth emits no notes (§6).

## 3. Loans

### 3.1 Amortization basics

- Financed amount `F = principal − downPayment`.
- Monthly payment `M`:
  - `interestRate == 0`: `M = F / term`.
  - else with `r` from `interestRate`: `M = F · r / (1 − (1+r)^−term)`.
- Interest portion in a month = `prevRemaining · r`.

### 3.2 Schedule generation

Each loan is expanded (before the simulation loop) into a sparse `YYYY-MM → payment`
schedule from its `startDate`, stopping at `simulation.endDate` at the latest.
Track `remaining` (principal outstanding after each month) and `escrowPaidThisYear`
(sum of escrow amounts included in payments so far in the current calendar year; resets
when a January is generated). The **escrow** of a month `m` is `escrow · G(m)`, with `G`
from the loan's `escrowGrowth` (§2.1); it is what each payment below includes, and what
`escrowPaidThisYear` sums.

**First month (loan startDate):**
- `extra` = extra-principal occurrences (§2) at startDate, capped per §3.3.
- `interest = F·r`; `principalPaid = min(M − interest + extra, F)`.
- `payment = interest + principalPaid + escrow(m) + downPayment + MI(§3.4)`.
- `remaining = F − principalPaid`.
- Apply the **end check** below with `monthIndex = 1` — a one-month term or a large
  first extra payment ends the loan immediately.

**Each subsequent month, `monthIndex` = 2 … term** (stop early on payoff/maturity/endDate):
- If the month equals `earlyPayoffDate` → §3.5 payoff, then stop.
- `interest = remaining·r`; `extra` per §3.3;
  `principalPaid = min(M − interest + extra, remaining)`.
- `payment = interest + principalPaid + escrow(m) + MI(§3.4)`.
- `remaining −= principalPaid`.
- **End check**: if `round2(remaining) ≤ 0` **or** `monthIndex == term` (maturity):
  `remaining = 0`; this is the final regular payment — because `principalPaid` is
  capped, it charges exactly what is owed, not a full `M`. Subtract the §3.6 escrow
  refund from this payment, apply §3.6 post-loan escrow, and stop.

**Invariant**: the `principalPaid` caps make a negative `remaining` arithmetically
impossible; the `≤` in the end check is defense in depth so that even a defective
state terminates the loan rather than generating payments forever. Implementations
SHOULD treat `round2(remaining) < 0` as an internal error worth surfacing
(assertion/logged error), never as an amount to keep billing.

Payments dated before `simulation.startDate` exist in the schedule but are never billed
(the loop only reads simulated months); a payment dated in the start month is billed. The
down payment is cash-out only if the loan starts inside the simulated window, which
includes the start month.

### 3.3 Extra principal payments

`extraPrincipalPayments` are events (amount > 0) evaluated per §2, each occurrence
moving `amount · G(m)` (§2.1). The total extra for a month is capped at the loan's current `remaining` (before this month's principal) so a
one-off overpayment can never push the balance negative; the `principalPaid` cap in §3.2
further guarantees the final payment charges only what is owed.

### 3.4 Mortgage insurance

If `mortgageInsurance` MI > 0: each generated payment includes MI while
`remaining_before_this_month / principal > mortgageInsuranceCutoff / 100`
(`remaining_before_this_month` is the balance after the previous month's payment; for the
first month use `F`). With cutoff 0 (unset), MI applies to every payment for the life of
the loan. The denominator is the original `principal` (pre-down-payment). Once the ratio
condition fails, MI never resumes for that loan.

### 3.5 Early payoff

Two mechanisms; whichever fires first wins (a payoff removes the loan's future payments).

The **payoff amount** in month `m` is `payoff = remaining_{m−1} · (1 + r)`: the balance
left after the previous month plus the interest it has accrued since. That interest is
exactly what a regular payment in `m` would have carried (§3.1), so retiring a loan
never skips a month of interest.

**By date** (`earlyPayoffDate`, evaluated during schedule generation): at that month,
instead of a regular payment:
- With `sellProperty: true`: `payment = payoff − sellPrice + sellCostsNet − refund`
  (§3.6 escrow refund; `sellPrice` defaults to `principal`; a negative payment is cash
  **in**). The asset is gone: no further payments, no post-sale escrow.
- Without sale: `payment = payoff − refund` (§3.6). Then §3.6 post-loan escrow
  applies.

**By threshold** (`earlyPayoffThreshold` T > 0, evaluated inside the simulation loop —
step 3 of §1 — because it depends on the running balances): let

`eligible = projectedLiquid + Σ netLiquidationValue(i)`

summed over investments `i` (of both resolved lists) with `fundLoanPayoffs: true`, using
investment state after step 2 of §1 for month `m`. An investment's
`netLiquidationValue` is its current `value` minus the withdrawal tax a full
liquidation would incur per §4 step 4:
`value − withdrawalTaxRate/100 · min(value, growthBalance)`.

In month `m`, if the loan started before `m`, still has `round2(remaining) > 0` as of
the end of `m−1`, and `round2(eligible − payoff) ≥ T`, the loan is paid off at
`m`: the scheduled payment at `m` (if any) is replaced by the same payoff payment as the
by-date rule (sale and no-sale variants identical), all later scheduled payments are
removed, §3.6 applies (refund always; post-loan escrow when not selling), and a note is
emitted (§6). A threshold MUST fire at most once and MUST NOT fire once the loan has
already ended.

**Funding the payoff**: with payoff payment `P`, the cash shortfall is
`S = max(0, P − projectedLiquid)`. Walk the `fundLoanPayoffs` investments in processing
order (the resolved scenario list in order, then the resolved shared list) and withdraw
from each until net proceeds
cover `S`: for an investment with available growth `g = min(value, growthBalance)` and
tax fraction `t = withdrawalTaxRate/100`, the gross withdrawal that nets `n` is
`n / (1 − t)` when `n ≤ g·(1 − t)`, else `n + t·g`; cap at the full `value` (which nets
its `netLiquidationValue`) and carry the remainder to the next flagged investment. Each
such withdrawal applies §4 steps 3–4 mechanics (growth-first, withdrawal tax on the
growth portion), adds its net proceeds to the month's `withdrawalCash` and its value
change to `investmentDelta`, and emits a note (§6). The fire condition guarantees the
flagged accounts can cover `S`; a funded payoff leaves the threshold margin `T` inside
cash and the flagged accounts combined (when `S > 0`, the payoff itself zeroes
projected cash and the margin sits in the accounts). With no flagged investments,
`eligible` is plain `projectedLiquid` and `S` is charged to cash like any other
payment.

`fundLoanPayoffs` exists so that someone sweeping all spare cash into a taxable
brokerage can still model an automatic payoff (the engine applies only
`withdrawalTaxRate` — accounts with early-withdrawal penalties or deferred income tax,
i.e. retirement accounts, should not be flagged). Users hedging changing market
expectations should lower `annualReturnRate` rather than expect the engine to model
return regimes.

### 3.6 Loan end: escrow settlement ("the escrow account closes")

When a loan with `escrow` > 0 ends in month `m` — natural maturity, either early
payoff, with or without a sale — the escrow account closes and its current-year accrual
is **refunded**: subtract from the final payment the sum of escrow included in this
loan's payments during `m`'s calendar year, as each was billed (§3.2) (payoff payments contain no escrow of their
own, so for them this is the January–`m−1` accrual; a natural-maturity payment does
include escrow, and that month's escrow is part of the refund).

When the asset is **kept** (any no-sale ending), the cost escrow represents (taxes,
insurance) continues: for every December `d` from `m` **inclusive** through
`simulation.endDate`, add `12 · escrow · G(d)` to that month's schedule entry, with `G`
from `escrowGrowth` (§2.1). Together with the refund, every kept-property calendar year
costs exactly twelve times its December's escrow no matter when the loan ends (an end
month that is itself a December both refunds the year's accrual and bills that
December's `12 · escrow · G(d)`). With fixed escrow that is `12 · escrow`. When the asset is **sold**, nothing
continues — the refund still applies.

Real-world closing mechanics (prorated property-tax settlement between buyer and
seller, insurer premium refunds) are deliberately out of scope; model them with
`sellCostsNet` if they matter.

## 4. Investments

Each investment carries state: `value` (starts at `startingValue`), `basis` (starts at
`startingValue`), `growthBalance` (starts 0). Like `startingCash`, `startingValue` is the
balance at the end of the month before `start`, so the first growth is in month `start`.
For month `m`, in this exact order:

1. **Growth**: `g = value · r` (`r` from `annualReturnRate`), computed on the balance
   **before** this month's contribution — new money starts compounding the following
   month. If `g > 0` and `taxRate > 0`: `tax = g · taxRate/100`, else `tax = 0`.
   `afterTax = g − tax`; `value += afterTax`; `growthBalance += afterTax`. If
   `growthBalance` goes negative, shift the deficit to `basis` (reduce basis by the
   deficit, floor both at 0).
2. **Contribution** `c` = Σ `amount · G(m)` over contribution occurrences (§2, §2.1) at
   `m`:
   `value += c`; `basis += c` (floor basis at 0).
3. **Withdrawal** `w`: fixed = Σ `amount · G(m)` over amount occurrences at `m` (§2.1);
   percentage-style adds
   `value · percentage/100` per occurrence (percentage of the current balance, after
   growth and contribution).
   Clamp `w` to `[0, value]`. Take from growth first:
   `fromGrowth = min(w, growthBalance)`, `fromBasis = w − fromGrowth`; decrement the
   balances accordingly (floor at 0); `value −= w`.
4. **Withdrawal tax**: `wTax = fromGrowth · withdrawalTaxRate/100` (0 if rate unset).
   Cash receives `w − wTax` (the ledger's `withdrawalCash`).
5. The investment's contribution to `investmentDelta` is its net `value` change this
   month. If `contributionsFromCash`, `c` is also charged to cash
   (`cashContributions`).

Note: taxing growth monthly before compounding is a deliberate simplification (tax drag),
as is treating withdrawal tax as levied only on the growth portion.

## 5. Emergency-fund recommendation

Skipped when the target `N` months is 0 (config default 6).

- `monthlyExpenses(m)` = Σ|amount| over **negative** event occurrences at `m` (scenario
  and common, counted individually — income never nets against expenses) + Σ loan
  payments billed at `m` (only positive payments; a cash-in sale month contributes 0)
  + `cashContributions(m)`.
- `avg` = mean of `monthlyExpenses` over the first `min(12, monthsSimulated)` simulated
  months, `start` included. Those months are the plan's first year, in which every
  growth factor is 1 (§2.1), so growth never changes the recommendation: it is already
  a statement in the start month's prices.
- `targetAmount = avg · N`; `initialLiquid = startingCash`, the balance the plan starts
  with, before the start month's own activity;
  `fundedMonths = initialLiquid / avg` (0 if `avg == 0`);
  `shortfall = max(0, targetAmount − initialLiquid)`;
  `surplus = max(0, initialLiquid − targetAmount)`. When the two differ by less than
  half a cent (`round2(targetAmount − initialLiquid) == 0`) both are 0: a fund that
  matches its target to the cent has no shortfall.

## 6. Notes (exact formats)

Notes are per-scenario, per-month string lists, emitted in processing order. Formats are
normative (conformance fixtures include them in CSV):

- Threshold payoff, no sale: `paying off asset <name> for <payoff:%.2f>`
- Threshold payoff with sale:
  `paying off asset <name> for <payoff:%.2f> and selling for <sellPrice:%.2f> with <sellCostsNet:%.2f> selling costs`
  (`<payoff>` is the §3.5 payoff amount: the balance at the end of `m−1` plus the
  month's interest.)
- Payoff-funding withdrawal (§3.5), one per tapped investment, immediately after its
  payoff note: `<scope> <name>: loan payoff withdrawal %+.2f` (the gross withdrawal)
  with the same ` (basis %+.2f, growth %+.2f)` suffix rule as regular withdrawals,
  then `, withdrawal tax %.2f` when nonzero.
- Investment activity: one note per investment per month with any nonzero part:
  `<scope> <name>: <parts joined by ", ">` where `<scope>` is `scenario` for an
  investment of the resolved scenario list (the scenario's own, or one a selected option
  adds) and `common` for one of the resolved shared list (a baseline investment, changed
  or not), and parts, in order, are (skipping zero-valued ones):
  - `contribution %+.2f` — or `contribution (reduces cash balance) %+.2f` when
    `contributionsFromCash`
  - `withdrawal %+.2f` — or `withdrawal (%.2f%%) %+.2f` for percentage style — with a
    suffix ` (basis %+.2f, growth %+.2f)` listing only the nonzero components
  - `growth %+.2f` (the **pre-tax** growth `g`)
  - `tax %.2f`
  - `withdrawal tax %.2f`

Date-based early payoffs emit no note (the configured date is the user's own doing).

## 7. Optimizer

Activated by the `--optimize` flag / `optimize: true` option. Adjusts each event carrying
an `optimize` block while holding its scenario to the target's **floor**: the guardrail
the block names (chapter 03, Optimizer block), or, when it names none, the
emergency-fund floor. A target's `growth` stays as written: an `amount` search chooses
the amount written, in the start month's prices, with its bounds in the same terms, and
each candidate grows as the written amount would (§2.1). When the optimized field is
`amount` and the configured original
amount is negative, choose the **smallest feasible signed amount within the bounds**:
the largest affordable expense, even if the original expense is already feasible.
For all other targets, choose the value requiring the **smallest adjustment from the
configured original**. The original amount's sign determines the objective before
snapping or clamping, including when the bounds cross zero.

Setup:
- A target that names a **guardrail** is held to that guardrail (§10) over its own window.
  Validation guarantees the guardrail applies to the target's scenario (chapter 03).
- A target that names none is held to the **emergency-fund floor**: the
  `emergencyFund.targetAmount` (§5) of the forecast that candidate produces — the plan's
  own target with the candidate value in place. A value that changes the plan's
  expenses moves its target with it, so a chosen value never leaves the plan short of
  the emergency fund it then reports; a floor frozen from the original plan would let a
  larger expense pass against a target the expense itself has outgrown.
- Run the baseline forecast (original config). If any active target names no guardrail
  and the recommendation is disabled, or a scenario containing such a target has a
  baseline `emergencyFund.targetAmount` ≤ 0, optimization fails with an error. A target
  held to a guardrail needs neither, so a plan whose every target names one is optimized
  with the recommendation disabled.
- Field value spaces: `amount` — whole cents; `frequency` — integers ≥ 1; `startDate` /
  `endDate` — month index (`year·12 + month − 1`). Every candidate is snapped to its
  field's space and then clamped to `[min, max]`. `frequency` and the date fields snap by
  rounding to the nearest integer; `amount` snaps **upward** to the next cent,
  `ceilCents(x) = math.Ceil(x*100)/100` with a value already within `1e-9` of a cent
  taken as that cent (so the snap is idempotent). Amount snaps up rather than to nearest
  because, in a plan without threshold payoffs funded from investments, cash rises with
  an event's amount, so rounding up moves a candidate toward more cash. A bound that is not
  itself a whole cent is used as written, and a `tolerance` below one cent buys no extra
  precision.

Feasibility of a candidate value `v`: write `v` into the event's field and run the full
forecast. Then read the target scenario's path:

- **Held to a guardrail**: feasible iff the guardrail **holds** on that path (§10): its
  condition is met in every month of its window. For a `cashFloor` or a `lasts`,
  `floor` is the guardrail's `floor(m)` at its tightest month (§10: its `amount`, grown
  by its growth, and 0 for a `lasts` with none), `minCash` is the
  balance the guardrail reads at its tightest month (`liquid`, or the listed accounts'
  combined value), and `headroom` is its margin there (§10). A `debtFree` has no
  dollar floor; its cleared month and `marginMonths` stand in for the three.
- **Held to the emergency fund**: take the target scenario's floor from the forecast,
  and find the first month where `liquid ≥ floor`. Feasible iff that month exists and
  `liquid ≥ floor` for **every** month from it through the end (i.e. once the floor is
  first reached, cash never dips below it). `minCash` = the minimum liquid over that
  suffix (over every month when the floor is never reached); `headroom = minCash − floor`.

These comparisons are made in whole cents (`round2` on both sides, per the preamble).
`minCash` and `headroom` are reported unrounded, so a headroom can sit a fraction of a
cent either side of zero.

**What the search guarantees.** Every value the search chooses is one it evaluated,
snapped and clamped: the anchor, a bound, or a bisection midpoint. The chosen value is
therefore always feasible when the target is reported converged, and the figures
reported with it describe its own forecast, which is the final forecast's. That holds
for every floor. Bisection finds the feasible value closest to the anchor only when
feasibility changes once between the anchor and the bound. That is not guaranteed. A
threshold payoff funded from investments (§3.5) fires earlier as cash grows, and it can
draw cash down to nothing, so a larger amount can make a plan fail a floor that a
smaller one meets. Against any floor, the search can then choose a feasible value that
is not the closest, or find neither bound feasible when a value between them is.

A target is one of a scenario's own events. It cannot sit in `common` or in an option
(chapter 03): both are shared between scenarios, and a chosen value is found against one
scenario's floor and written back to one place in the plan.

Search, per target (each target optimized in turn — scenario order, then event order —
with earlier targets' chosen values left in place, so a later target's floor reflects
them):

1. Set the search anchor to the lower bound for a negative original `amount`, otherwise
   to the original value (snapped, clamped). Evaluate the anchor and both bounds.
2. Anchor feasible → choose it. `converged = true`, `iterations = 0`. In particular,
   an affordable lower bound is chosen for an expense instead of keeping the original.
3. Neither bound feasible (and anchor isn't) → keep the original value,
   `converged = false`, and report the better of the two bounds, the lower bound when
   neither is better. Bounds are formatted per field in the note: currency for amount,
   integer for frequency, `YYYY-MM` for dates.
   - Held to the emergency fund: the better bound has the greater headroom. Report its
     `floor`/`minCash`/`headroom`, and name that floor (as currency `$1,234.56`) in the note
     `unable to satisfy minimum cash <floor> within bounds <min> to <max>`.
   - Held to a guardrail: the better bound has the greater margin. For a `debtFree`, a
     bound with a cleared month is better than one without, and of two with one, the
     greater `marginMonths` is better. Report that bound's figures and guardrail result,
     with the note `unable to hold guardrail “<name>” within bounds <min> to <max>`.
4. Otherwise, for each feasible bound, bisect on the interval between the anchor
   and that bound: maintain (infeasibleSide, feasibleSide), evaluate the midpoint
   (snapped/clamped), narrow toward the boundary, stop when the interval ≤ `tolerance`
   or `maxIterations` evaluations have been spent; the candidate is the closest feasible
   value found. Choose the candidate (across the one or two feasible directions)
   minimizing |candidate − anchor|, ties to the smaller value. `converged = true`;
   `iterations` = total midpoint evaluations.

Applying results: chosen values are written into the config (the exported/echoed YAML
reflects them), the final forecast runs on the adjusted config, and each target yields a
summary attached to its scenario's metrics: target event name, field, original and chosen
values (raw numeric and display-formatted — currency for amounts, integer for frequency,
`YYYY-MM` for dates), the chosen value's floor, minCash, headroom, iterations,
converged, notes. A target held to a guardrail also carries the guardrail's result (§10)
on the chosen value's forecast, or on the reported bound's when it did not converge, and
a `debtFree` target carries no floor, minCash or headroom.

## 8. Key figures

Each scenario reports the few figures a comparison between scenarios turns on. They
are read from the recorded series (§1) and add nothing to the simulation:

- `lowestCash` and `lowestCashDate` — the least recorded `liquid` and the month it is
  recorded at. Every recorded month counts, `start` included; `startingCash` itself is
  not a recorded month (§1). Months are
  compared in whole cents (`round2`, per the preamble), and when several months share
  the least value the **earliest** is reported: `lowestCashDate` is the first month `m`
  with `round2(liquid[m]) = min round2(liquid)`, and `lowestCash = liquid[m]`, unrounded
  like every other reported number. A scenario whose cash never falls after the start
  month therefore reports that month's cash and `start`.
- `endingCash` and `endingTotal` — `liquid` and `total` of the last recorded month.

When `start == end` only that one month is recorded (§1), so all four describe it:
`lowestCash = endingCash = liquid[start]`, `endingTotal = total[start]`, and
`lowestCashDate = start`.

The figures describe the forecast that is reported: with the optimizer (§7), the final
forecast on the adjusted config. They do not depend on the emergency-fund
recommendation (§5) and are reported when it is disabled.

## 9. Differences and break-even

Two active scenarios can be compared as an ordered pair (A, B), read "A minus B". Like
the key figures (§8), the comparison is read from the recorded series (§1) and adds
nothing to the simulation. It is made for cash and for total separately:

- **Difference** — for every recorded month `m`, `liquid_A[m] − liquid_B[m]` and
  `total_A[m] − total_B[m]`, unrounded like every other reported number. The pair
  (B, A) reports the same amounts with the opposite sign.
- **Who leads a month** — the scenario whose value is greater in whole cents: A leads
  `m` when `round2(A[m]) > round2(B[m])`, B leads when it is less, and otherwise the
  month is **level**. Values that round to the same whole-cent amount are level;
  even a sub-cent gap can establish a lead when the values straddle a rounding boundary.
- **Break-even months** — walk the recorded months in order, remembering the scenario
  that most recently led. A month led by the *other* scenario is a break-even month,
  reported with the scenario that moves ahead in it; that scenario is then the one
  remembered.

What follows from the rule, each deliberate:

- A level month is never a break-even month and does not forget who led before it. A
  scenario that is caught but not passed, and then pulls away again, has not been
  overtaken: nothing is reported.
- When a level month does precede an overtaking, the month reported is the first one
  the other scenario is actually ahead, not the level month.
- The first lead is not a break-even month, because nobody was overtaken: neither a
  lead held from the first recorded month nor one taken after level months. Scenarios
  share `startingCash`, but the first recorded month already carries each one's own
  start-month activity, so they need not be level there.
- Every change of lead is reported, in month order, so two paths that cross twice
  report two months.
- A series with one scenario ahead in every month it is not level reports no
  break-even months, as does a plan of one month (§1).

The cash and total series are walked independently, so a path can catch up in cash in a
month in which it is still behind in total. The break-even months of (B, A) are those of
(A, B), each with the same scenario moving ahead.

The comparison describes the forecast that is reported: with the optimizer (§7), the
final forecast on the adjusted config.

## 10. Guardrails

Every guardrail of the plan (chapter 03, Guardrails) is checked on every path the
engine reports: each active scenario's forecast and the flipped path (chapter 02,
Results JSON). Like the key figures (§8), a guardrail is read from the recorded series
(§1) and adds nothing to the simulation, so the same rule evaluates any path the
engine simulates. With the optimizer (§7), it describes the final forecast on the
adjusted config. An optimizer target is held to a guardrail only when it names one (§7);
otherwise its floor is the emergency fund. The emergency-fund recommendation (§5) is
unchanged by guardrails and is not reported as a guardrail.

**The window.** A guardrail's window is its `startDate`–`endDate`, inclusive at both
ends, defaulting to `start` and `end`, and clipped to the recorded months `start`–`end`
(§1). The month `start` counts, after its own activity, as it does for lowest cash (§8);
`startingCash` itself is not checked. A window with
no recorded month in it is **empty**.

**The test in one month.** A guardrail holds in month `m` when its condition is met at
the recorded values of `m`, compared in whole cents (preamble):

- **cashFloor** holds in `m` when `round2(liquid[m]) ≥ round2(floor(m))`, where
  `floor(m) = amount · G(m)`, with `G` from the guardrail's `growth` (§2.1). `G` counts
  from the plan's `start`, not from the window's first month, so `amount` is in the start
  month's prices. With `growth` fixed, `floor(m)` is `amount` in every month.
- **debtFree** holds in `m` when `round2(owed[m]) = 0`. `owed[m]` is the combined
  principal outstanding at the end of `m` (§3.2) on the path's loans with the listed
  names, or on every loan of the path when none are listed. A loan owes nothing before
  its `startDate`, and nothing from the month it ends (§3.2 end check, §3.5: maturity,
  an early payoff by date or by threshold, a sale). Escrow that continues after a
  payoff (§3.6) is a cost, not a debt. A listed name the path has no loan by owes
  nothing, and loans with the same name are summed. In a loan's own first month,
  `owed` is what remains after that month's payment, as in any other month.
- **lasts** holds in `m` when `round2(value[m]) ≥ round2(floor(m))`, with `floor(m)`
  as for a cashFloor, or `round2(value[m]) > 0` when no `amount` is given. `value[m]` is the combined value
  at the end of `m` (§4, after any withdrawal that funds a loan payoff, §3.5) of the
  path's accounts with the listed names. These per-loan and per-account balances are
  recorded for evaluation only; the CSV does not carry them (chapter 05).

**The outcome.** The rule is strict: a guardrail holds only if its condition is met in
**every** month of its window. No guardrail uses the optimizer's "from the first month
the floor is reached" reading; a guardrail that should only apply once a balance has
been built says so with `startDate`.

- **holds** — every month of the window passes;
- **breaks** — some month fails. The **first breach** is the earliest failing month;
- **does not apply** — the window is empty, or a `lasts` names no account the path
  has. It is never reported as holding.

**Tightest month and margin** (cashFloor and lasts). The balance is `liquid` for a
cashFloor and `value` for a lasts, and the floor is `floor(m)`, or 0 for a lasts with no
`amount`. The tightest month is the earliest month of the window with the least margin
in whole cents, by the tie rule of lowest cash (§8): the first `m` in the window with
`round2(balance[m]) − round2(floor(m)) = min (round2(balance) − round2(floor))` over the
window. The **margin** is `balance[m] − floor(m)` there, unrounded like every reported
number. It is negative when the guardrail breaks (zero or less for a lasts with no
`amount`), and it is the lowest margin in the window, not the margin at the first
breach. While the floor is the same in every month, the tightest month is the month of
least balance. Neither is reported when the guardrail does not apply.

**Cleared month and months to spare** (debtFree). The tightest month of a debtFree is
the month the debt is **cleared**: the first month of the last stretch of months,
running to the window's last month, in which nothing is owed. The stretch may begin
before the window but no earlier than `start`. There is none when something is owed in
the window's last month. The margin, **`marginMonths`**, is the window's first month
minus the cleared month: positive when the debt is cleared early, zero when it is
cleared in the window's first month and negative when it is cleared late. A debtFree
holds exactly when it has a cleared month and `marginMonths` is zero or more. When it
breaks, **`owed`** is `owed[m]` at the first breach, unrounded. Neither the cleared
month nor `marginMonths` is reported when there is no cleared month or the guardrail
does not apply.

What follows from the rule, each deliberate:

- A floor met exactly, to the cent, holds; one cent less breaks.
- A path whose cash at the end of the start month is below its floor breaks in that
  month, at `start`. Starting cash below the floor that the start month's own income
  lifts above it does not break. The same guardrail with a later `startDate` is judged
  from that month.
- The first breach can come before the tightest month, when cash falls below the floor
  and later falls further.
- A floor that grows can break a path whose cash never falls: the floor rises past it.
  Its tightest month is then where the floor is furthest above the balance, which need
  not be the month of least balance.
- A debtFree whose deadline is before `start` is judged from `start`, the window's
  first month, like any clipped window.
- A debtFree with no loans to check (a path without the listed loans, or with no loans
  at all) holds, cleared at `start`.
- A lasts on accounts that start empty breaks at the window's first month; a later
  `startDate` judges it from when they have been funded.
- Inactive scenarios are not simulated, so they report nothing.

## 11. Earliest month

A question asked of one active scenario's path (chapter 02, Results JSON, `earliest`):
the earliest month, within a range, in which one entry can be placed with every chosen
guardrail holding. Like the guardrails it reads (§10), it adds nothing to the plan or
to the reported forecast. It names:

- the **entry**: an event of an `events` list or a loan of a `loans` list, on the
  scenario's path (chapter 03, Choices): one of the scenario's own entries, one added by
  an option the scenario selects, or a baseline entry that no option it selects removes;
- the **field** that moves: an event's `startDate` or `endDate`, or a loan's
  `startDate`;
- the **range** `from`–`to`, inclusive at both ends, inside `start`–`end` (§1);
- the **chosen guardrails**: one or more of the plan's guardrails (§10).

**The plan it is asked of** is the plan as run: with the optimizer (§7), the adjusted
config, whose chosen values stay in place. No candidate is optimized again. An entry
that is itself an optimizer target is timed like any other.

**The candidate path for month `m`** is the scenario, resolved as chapter 03 resolves
it, with `m` written into the entry's field on that path and nothing else changed:

- An event's `startDate` moves its start and leaves its end; its `endDate` moves its end
  and leaves its start. A **one-off** event, one whose resolved start and end are the
  same month, moves as a whole: both become `m`, whichever field is asked.
- A loan's `startDate` moves the loan: its down payment, payments, escrow and insurance
  follow the new start (§3). Its `earlyPayoffDate` and the dates of its
  `extraPrincipalPayments` stay as written.
- A baseline entry that a selected option changes takes `m` in place of the month it
  has on the path, whether or not the change sets that field.

A month that makes the path invalid by the rules of chapter 03 (an event that would
start after it ends) is not a candidate. The question is then refused, naming the
first such month in the range and what is wrong with it, and nothing is answered.
What chapter 03 only warns about (a loan whose early payoff month is not after its
first payment) does not refuse it.

**A month works** when every chosen guardrail **holds** (§10) on its candidate path. A
chosen guardrail that cannot apply to the path (its window has no month inside the
plan, or it is a `lasts` naming no account the path has) refuses the question, because
no placement of the entry changes either.

**The scan.** Every month from `from` to `to` is tried, in order. Nothing is bisected:
moving an entry later need not help or hurt steadily, because a threshold payoff (§3.5)
fires in a month that depends on everything before it, so working months can come and
go across the range. The answer:

- **month** — the first month of the range that works; none when no month does.
- **configured** — the month the entry's field has on the path as run.
- **works** — every stretch of consecutive working months, in ascending order, each
  from its first month to its last. Empty when no month works.
- **holds** — for each chosen guardrail, in the plan's order, its stretches of months in
  which it holds on its own. When no month works, these say why: a guardrail that never
  holds, or guardrails whose months never meet.
- **decidedBy** — when the earliest month is later than `from`: the result (§10) on the
  path of the month before it of each chosen guardrail that breaks there, in the plan's
  order, with its first breach. That month does not work, so at least one breaks. None
  when the earliest month is `from` or no month works.
- **atEarliest** — every chosen guardrail's result on the earliest month's path. None
  when no month works.

What follows from the rule, each deliberate:

- An amount that grows (§2.1) counts its years from the plan's start, not from the
  entry's, so an event moved into a later plan year moves a larger amount: a purchase
  moved later costs more. A loan's principal and payment do not grow, so a loan moved
  later costs the same, while its escrow follows the months it is billed in.
- A range of one month answers whether that month works.
- The answer can be `from` itself, and then nothing in the range decides it.
- A month that works can be followed by one that does not, and `works` shows both.
- `decidedBy` describes the month just before the answer only. Earlier months fail
  too, possibly for other guardrails, and `holds` shows which.
- The answer describes the path the question was asked of. Other scenarios sharing a
  baseline entry are not moved, and the reported forecast is not changed.
