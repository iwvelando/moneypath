# 07 — Legacy format (v1) and the `migrate` command

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

Chapter 04's appendix lists behavioral deviations (mortgage insurance now charges, final
loan payments are exact, threshold payoffs measure cash, emergency-fund averaging window
changed, optimizer selection simplified). `migrate` SHOULD print a pointer to that
appendix as a final notice when the input uses any affected feature
(`mortgageInsurance`, `escrow` with loans maturing in-window, `earlyPayoffThreshold`,
`optimize`).
