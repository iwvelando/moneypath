# 04 — Engine semantics (normative)

*Status: **Contract** — this chapter is the record of which money behaviors are
deliberate. Change it before the code, alongside the fixtures that pin the new numbers,
and say so in the commit message. See SPEC.md.*

This chapter defines exactly what the simulator computes. `testdata/conformance/`
fixtures encode these rules numerically; when prose and fixture disagree, treat it as a
spec bug and flag it rather than silently choosing one.

Throughout: `r` denotes a monthly interest rate derived from an annual percentage `A` as
`r = A / 100 / 12`. "Month arithmetic" means calendar-month stepping (`2025-11` + 3 =
`2026-02`). All internal math is float64; **comparisons that decide behavior** (loan
reaching zero, threshold triggers) round both sides to 2 decimals first
(`round2(x) = math.Round(x*100)/100`).

## 1. The simulation loop

For each **active** scenario, independently:

- Let `start` = `simulation.startDate` (or the caller-supplied current month when
  absent), `end` = `simulation.endDate`.
- If `start ≥ end`, the simulation records only the initial row (no iteration). This MUST
  NOT loop or error.
- State: `cash = simulation.startingCash`; per-investment states (§4); loan schedules
  precomputed (§3) for the scenario's loans and the common loans.
- Record the initial row at `start`: `liquid = cash`,
  `total = cash + Σ investment startingValue` (scenario + common investments).
- For each month `m` = `start+1`, `start+2`, … up to and including `end`:

  1. **Events**: `eventDelta` = sum of `amount` over every occurrence (§2) at `m` among
     scenario events and common events.
  2. **Investments** (§4): process every scenario and common investment for `m`,
     yielding `investmentDelta` (net change in combined investment value),
     `cashContributions` (Σ contributions of investments with
     `contributionsFromCash: true`), and `withdrawalCash` (Σ over investments of
     `withdrawal − withdrawalTax`). Investment activity emits notes (§6).
  3. **Threshold payoff check** (§3.5): for each loan (scenario loans in config order,
     then common loans), check against
     `projectedLiquid = cash + eventDelta − cashContributions + withdrawalCash`.
     A triggered payoff rewrites that loan's schedule at `m`, emits a note, and — when
     `fundLoanPayoffs` investments cover a cash shortfall — performs their withdrawals
     (the proceeds and value changes join `withdrawalCash` and `investmentDelta` for
     steps 5–6). Before the next loan's check, `projectedLiquid` is updated by the
     fired payoff's net cash effect (liquidation proceeds minus the payoff payment).
  4. **Loans**: `loanDelta` = −Σ of every loan's scheduled payment amount at `m`
     (a schedule is a sparse date→payment map; months without entries contribute 0).
  5. **Update cash**:
     `cash += eventDelta + loanDelta − cashContributions + withdrawalCash`.
  6. **Record**: `liquid[m] = cash`;
     `total[m] = cash + (running sum of investment values)`.
  7. Accumulate emergency-fund expense stats (§5) for the first 12 iterated months.

Results per scenario: the date→liquid and date→total series, date→notes lists, and
metrics (§5, §7).

## 2. Event occurrences

An event with `startDate` S (default: simulation start), `endDate` E (default:
simulation end), `frequency` f ≥ 1 (default 1) occurs at S, S+f, S+2f, … for every
occurrence ≤ E. If S == E the event occurs exactly once at S. Occurrences are matched by
exact month equality — an event whose stride jumps over `end` simply stops. Events with
S > E (after defaulting) are invalid (validation error). Occurrences outside the
simulated window contribute nothing.

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
when a January is generated).

**First month (loan startDate):**
- `extra` = extra-principal occurrences (§2) at startDate, capped per §3.3.
- `interest = F·r`; `principalPaid = min(M − interest + extra, F)`.
- `payment = interest + principalPaid + escrow + downPayment + MI(§3.4)`.
- `remaining = F − principalPaid`.
- Apply the **end check** below with `monthIndex = 1` — a one-month term or a large
  first extra payment ends the loan immediately.

**Each subsequent month, `monthIndex` = 2 … term** (stop early on payoff/maturity/endDate):
- If the month equals `earlyPayoffDate` → §3.5 payoff, then stop.
- `interest = remaining·r`; `extra` per §3.3;
  `principalPaid = min(M − interest + extra, remaining)`.
- `payment = interest + principalPaid + escrow + MI(§3.4)`.
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
(the loop only reads simulated months). The down payment is cash-out only if the loan
starts inside the simulated window.

### 3.3 Extra principal payments

`extraPrincipalPayments` are events (amount > 0) evaluated per §2. The total extra for a
month is capped at the loan's current `remaining` (before this month's principal) so a
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

**By date** (`earlyPayoffDate`, evaluated during schedule generation): at that month,
instead of a regular payment:
- With `sellProperty: true`: `payment = remaining − sellPrice + sellCostsNet − refund`
  (§3.6 escrow refund; `sellPrice` defaults to `principal`; a negative payment is cash
  **in**). The asset is gone: no further payments, no post-sale escrow.
- Without sale: `payment = remaining − refund` (§3.6). Then §3.6 post-loan escrow
  applies.

**By threshold** (`earlyPayoffThreshold` T > 0, evaluated inside the simulation loop —
step 3 of §1 — because it depends on the running balances): let

`eligible = projectedLiquid + Σ netLiquidationValue(i)`

summed over investments `i` (scenario and common) with `fundLoanPayoffs: true`, using
investment state after step 2 of §1 for month `m`. An investment's
`netLiquidationValue` is its current `value` minus the withdrawal tax a full
liquidation would incur per §4 step 4:
`value − withdrawalTaxRate/100 · min(value, growthBalance)`.

In month `m`, if the loan started before `m`, still has `round2(remaining) > 0` as of
the end of `m−1`, and `round2(eligible − remaining_{m−1}) ≥ T`, the loan is paid off at
`m`: the scheduled payment at `m` (if any) is replaced by the same payoff payment as the
by-date rule (sale and no-sale variants identical), all later scheduled payments are
removed, §3.6 applies (refund always; post-loan escrow when not selling), and a note is
emitted (§6). A threshold MUST fire at most once and MUST NOT fire once the loan has
already ended.

**Funding the payoff**: with payoff payment `P`, the cash shortfall is
`S = max(0, P − projectedLiquid)`. Walk the `fundLoanPayoffs` investments in processing
order (scenario list order, then common) and withdraw from each until net proceeds
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
loan's payments during `m`'s calendar year (payoff payments contain no escrow of their
own, so for them this is the January–`m−1` accrual; a natural-maturity payment does
include escrow, and that month's escrow is part of the refund).

When the asset is **kept** (any no-sale ending), the cost escrow represents (taxes,
insurance) continues: for every December from `m` **inclusive** through
`simulation.endDate`, add `12 · escrow` to that month's schedule entry. Together with
the refund, every kept-property calendar year costs exactly `12 · escrow` no matter
when the loan ends (an end month that is itself a December both refunds the year's
accrual and bills that December's `12 · escrow`). When the asset is **sold**, nothing
continues — the refund still applies.

Real-world closing mechanics (prorated property-tax settlement between buyer and
seller, insurer premium refunds) are deliberately out of scope; model them with
`sellCostsNet` if they matter.

## 4. Investments

Each investment carries state: `value` (starts at `startingValue`), `basis` (starts at
`startingValue`), `growthBalance` (starts 0). For month `m`, in this exact order:

1. **Growth**: `g = value · r` (`r` from `annualReturnRate`), computed on the balance
   **before** this month's contribution — new money starts compounding the following
   month. If `g > 0` and `taxRate > 0`: `tax = g · taxRate/100`, else `tax = 0`.
   `afterTax = g − tax`; `value += afterTax`; `growthBalance += afterTax`. If
   `growthBalance` goes negative, shift the deficit to `basis` (reduce basis by the
   deficit, floor both at 0).
2. **Contribution** `c` = Σ contribution occurrences (§2) at `m`:
   `value += c`; `basis += c` (floor basis at 0).
3. **Withdrawal** `w`: fixed = Σ amount occurrences at `m`; percentage-style adds
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

Skipped when the effective target `N` months is 0 (config default 6; CLI can override).

- `monthlyExpenses(m)` = Σ|amount| over **negative** event occurrences at `m` (scenario
  and common, counted individually — income never nets against expenses) + Σ loan
  payments billed at `m` (only positive payments; a cash-in sale month contributes 0)
  + `cashContributions(m)`.
- `avg` = mean of `monthlyExpenses` over the first `min(12, monthsSimulated)` iterated
  months.
- `targetAmount = avg · N`; `initialLiquid = liquid[start]`;
  `fundedMonths = initialLiquid / avg` (0 if `avg == 0`);
  `shortfall = max(0, targetAmount − initialLiquid)`;
  `surplus = max(0, initialLiquid − targetAmount)`.

## 6. Notes (exact formats)

Notes are per-scenario, per-month string lists, emitted in processing order. Formats are
normative (conformance fixtures include them in CSV):

- Threshold payoff, no sale: `paying off asset <name> for <remaining:%.2f>`
- Threshold payoff with sale:
  `paying off asset <name> for <remaining:%.2f> and selling for <sellPrice:%.2f> with <sellCostsNet:%.2f> selling costs`
  (`<remaining>` is the balance being retired, i.e. end of `m−1`.)
- Payoff-funding withdrawal (§3.5), one per tapped investment, immediately after its
  payoff note: `<scope> <name>: loan payoff withdrawal %+.2f` (the gross withdrawal)
  with the same ` (basis %+.2f, growth %+.2f)` suffix rule as regular withdrawals,
  then `, withdrawal tax %.2f` when nonzero.
- Investment activity: one note per investment per month with any nonzero part:
  `<scope> <name>: <parts joined by ", ">` where `<scope>` is `scenario` or `common`
  and parts, in order, are (skipping zero-valued ones):
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
an `optimize` block (scenario events only) to the value requiring the **smallest
adjustment from the configured original** that keeps cash at or above the emergency-fund
floor.

Setup:
- Run the baseline forecast (original config). For each scenario containing targets, the
  **floor** = that scenario's baseline `emergencyFund.targetAmount`. If the
  recommendation is disabled or the floor ≤ 0, optimization fails with an error.
- Field value spaces: `amount` — whole cents; `frequency` — integers ≥ 1; `startDate` /
  `endDate` — month index (`year·12 + month − 1`). Every candidate is snapped to its
  field's space and then clamped to `[min, max]`. `frequency` and the date fields snap by
  rounding to the nearest integer; `amount` snaps **upward** to the next cent,
  `ceilCents(x) = math.Ceil(x*100)/100` with a value already within `1e-9` of a cent
  taken as that cent (so the snap is idempotent). Amount snaps up rather than to nearest
  because cash rises with an event's amount: rounding up can only add headroom, so a
  chosen amount always satisfies the floor reported alongside it. A bound that is not
  itself a whole cent is used as written, and a `tolerance` below one cent buys no extra
  precision.

Feasibility of a candidate value `v`: write `v` into the event's field, run the full
forecast, and in the target scenario find the first month where `liquid ≥ floor`.
Feasible iff that month exists and `liquid ≥ floor` for **every** month from it through
the end (i.e. once the floor is first reached, cash never dips below it).
`minCash` = the minimum liquid over that suffix; `headroom = minCash − floor`.

Search, per target (each target optimized in turn — scenario order, then event order —
with earlier targets' chosen values left in place; floors stay as snapshotted from the
baseline):

1. Evaluate the original value (snapped, clamped), and both bounds.
2. Original feasible → keep it. `converged = true`, `iterations = 0`.
3. Neither bound feasible (and original isn't) → keep the original value,
   `converged = false`, note:
   `unable to satisfy minimum cash <floor> within bounds <min> to <max>` (floor as
   currency `$1,234.56`; bounds formatted per field — currency for amount, integer for
   frequency, `YYYY-MM` for dates). Report the higher-headroom bound's
   `minCash`/`headroom`.
4. Otherwise, for each feasible bound, bisect on the interval between the original value
   and that bound: maintain (infeasibleSide, feasibleSide), evaluate the midpoint
   (snapped/clamped), narrow toward the boundary, stop when the interval ≤ `tolerance`
   or `maxIterations` evaluations have been spent; the candidate is the closest feasible
   value found. Choose the candidate (across the one or two feasible directions)
   minimizing |candidate − original|, ties to the smaller value. `converged = true`;
   `iterations` = total midpoint evaluations.

Applying results: chosen values are written into the config (the exported/echoed YAML
reflects them), the final forecast runs on the adjusted config, and each target yields a
summary attached to its scenario's metrics: target event name, field, original and chosen
values (raw numeric and display-formatted — currency for amounts, integer for frequency,
`YYYY-MM` for dates), floor, minCash, headroom, iterations, converged, notes.
