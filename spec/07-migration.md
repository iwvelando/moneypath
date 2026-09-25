# 07 — Legacy format (v1) and the `migrate` command

*Status: **Frozen** — the v1 format can no longer change, so neither can this chapter.
Edit only to correct an error. This is also the one chapter where naming the legacy tool
is warranted: it is what the format came from. See SPEC.md.*

moneypath's predecessor ("finance-forecast") used a YAML config with no version field.
`moneypath migrate` converts such files to v2. This chapter fully specifies the legacy
format (as a data format — implement from these tables) and the conversion rules.
`testdata/migration/` contains input → expected-output pairs.

## Legacy format reference

Dates are `YYYY-MM` strings throughout, same as v2.

### Top level

| Key | Type | Notes |
|---|---|---|
| `startDate` | string, optional | simulation start month; absent = current month |
| `logging` | object, optional | `level` (debug/info/warn/error), `format` (json/console), `outputFile` — tool settings |
| `output` | object, optional | `format`: `pretty` or `csv` |
| `recommendations` | object, optional | `emergencyFundMonths` (float, default 6) |
| `common` | object | see below |
| `scenarios` | list | see below |

### `common`

| Key | Type | Notes |
|---|---|---|
| `startingValue` | float | starting **cash** balance |
| `deathDate` | string | simulation end month |
| `events` | list of Event | shared across scenarios |
| `loans` | list of Loan | shared across scenarios |
| `investments` | list of Investment | shared across scenarios |

### Scenario

| Key | Type | Notes |
|---|---|---|
| `name` | string | |
| `active` | bool | **no default — absent meant false** in v1 |
| `events`/`loans`/`investments` | lists | as below |

### Event

| Key | Type | Notes |
|---|---|---|
| `name` | string, optional | |
| `amount` | float | signed; + income, − expense |
| `percentage` | float, optional | only meaningful on investment withdrawals |
| `frequency` | int, **required (≥1)** for cash-flow events; investment schedules defaulted 0→1 | months between occurrences |
| `startDate` | string, optional | default: simulation start |
| `endDate` | string, optional | default: `deathDate`; `start==end` = one-time |
| `optimize` | object, optional | see Optimizer below |

### Loan

| Key | Type | Notes |
|---|---|---|
| `name` | string | required non-empty |
| `principal` | float | pre-down-payment |
| `downPayment` | float, optional | |
| `interestRate` | float | annual percent |
| `term` | int | months |
| `startDate` | string | |
| `escrow` | float, optional | monthly |
| `mortgageInsurance` | float, optional | monthly |
| `mortgageInsuranceCutoff` | float, optional | percent |
| `earlyPayoffThreshold` | float, optional | |
| `earlyPayoffDate` | string, optional | |
| `sellProperty` | bool, optional | |
| `sellPrice` | float, optional | default: principal |
| `sellCostsNet` | float, optional | signed |
| `extraPrincipalPayments` | list of Event, optional | |

### Investment

| Key | Type | Notes |
|---|---|---|
| `name` | string | |
| `startingValue` | float | |
| `annualReturnRate` | float | percent |
| `taxRate` | float, optional | percent on monthly growth |
| `withdrawalTaxRate` | float, optional | percent on growth portion of withdrawals |
| `contributionsFromCash` | bool, optional | |
| `contributions` | list of Event, optional | amount only |
| `withdrawals` | list of Event, optional | amount XOR percentage; no mixing styles |

### Optimizer block

| Key | Notes |
|---|---|
| `field` | `amount`/`frequency`/`startDate`/`endDate` (several spellings accepted) |
| `kind` | only `cash_floor` was ever valid |
| `target` | only `emergencyFund` was ever valid |
| `min`/`max` | numeric bounds (amount, frequency) |
| `minDate`/`maxDate` | date bounds (startDate, endDate) |
| `tolerance`, `maxIterations` | optional overrides |

## Conversion rules (normative)

Output a v2 document (chapter 03):

1. Add `version: 2`.
2. Build `simulation:` from `startDate` (keep if present), `common.deathDate` → `endDate`,
   `common.startingValue` → `startingCash`.
3. `recommendations` carries over unchanged.
4. `common` keeps `events`/`loans`/`investments` (minus the two moved keys).
5. Scenarios carry over. **`active` absent in the source → emit `active: false`**
   (v1 defaulted inactive; v2 defaults active, so absence must be made explicit to
   preserve meaning).
6. Events/loans/investments: field names are unchanged. Drop explicit `frequency: 0`
   (v2 default 1 matches v1's investment-schedule behavior; for cash-flow events v1
   rejected 0, so nothing changes meaning).
7. `optimize` blocks: drop `kind`/`target` keys (notice if they held any value other
   than the defaults `cash_floor`/`emergencyFund` — such configs never ran in v1
   either); keep everything else.
8. Drop `logging:` and `output:` entirely, each with a notice
   (`dropped 'logging' block: logging is configured via CLI flags in v2`, similarly for
   `output`).
9. Unknown keys: carry through untouched (they'll surface as v2 validation warnings).

Notices are informational (stderr for the CLI; `notices` array from the WASM bridge).
Migration MUST fail with a clear error if the input is not parseable YAML, lacks
`common.deathDate`, or already contains `version: 2`.

The migrated output MUST parse and validate as v2, and MUST be semantically equal to the
expected file in each `testdata/migration/` pair (compare parsed structures, not bytes —
key order and comments are not significant).

## Semantics changes migrating users should know

v2 deliberately differs from finance-forecast in the areas below, so a faithfully
migrated config can still produce different numbers. Each rule is stated normatively in
chapter 04; this list exists for the person doing the migrating.

1. **Mortgage insurance actually charges.** finance-forecast never added MI to a payment
   and instead *subtracted* it once the cutoff was reached (a sign bug). v2 charges MI
   for as long as the loan sits above the cutoff (§3.4).
2. **The final loan payment is exact.** finance-forecast billed a full monthly payment in
   the last month even when less was owed, and extra principal that overshot the balance
   could drive it negative and keep billing phantom amounts. v2 caps principal at what
   remains, so the loan ends with a payment of exactly what is owed (§3.2).
3. **Escrow settles the same way on every ending.** In finance-forecast the refund
   depended on which code path ended the loan — maturity refunded unless it fell in
   December, threshold payoffs refunded, sales did not — so the final year could cost
   anywhere from 0 to 18 months of escrow. v2 refunds the current-year accrual on every
   ending, sales included, and every kept-property year costs exactly `12·escrow` (§3.6).
4. **Threshold payoffs measure money that could actually pay.** finance-forecast compared
   the threshold against total net worth and then paid from cash alone, so illiquid money
   could trigger a payoff the cash could not cover. v2 counts cash plus the after-tax
   liquidation value of accounts explicitly flagged `fundLoanPayoffs`, and actually
   liquidates them (§3.5).
5. **Emergency-fund expenses are gross and near-term.** finance-forecast averaged netted
   outflows — income canceled expenses — across the whole simulation, retirement decades
   included. v2 counts expense occurrences without netting and averages the first 12
   months (§5).
6. **Optimizer selection is simpler.** finance-forecast had special-case preference rules
   and could apply an out-of-bounds value on failure. v2 always minimizes the size of the
   adjustment and keeps the original value when no feasible one exists (§7).
7. **The end month is simulated fully.** finance-forecast skipped loan payments falling
   exactly on the end month; v2 bills through `simulation.endDate` inclusive, like every
   other ledger component.
8. **Growth compounds before the month's contribution.** finance-forecast added the
   contribution first, granting new money a full month of growth on arrival. v2 grows the
   prior balance first, so contributions start compounding the following month (§4).

`migrate` SHOULD emit a final notice when the input uses any affected feature
(`mortgageInsurance`, `escrow` with loans maturing in-window, `earlyPayoffThreshold`, or
`optimize`). That notice is user-facing, so it MUST name the changed behaviors in plain
language and MUST NOT point at a spec chapter or file (AGENTS.md, "User-facing text").
