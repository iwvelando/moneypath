# 05 — CLI

*Status: **Descriptive** — the CSV format below is the exception: it is byte-pinned by
conformance fixtures and by CLI↔WASM parity, so treat it as Contract. See SPEC.md.*

Binary name: `moneypath`. Subcommand style. Results go to stdout; diagnostics/logs to
stderr. Exit codes: `0` success, `1` runtime/config error, `2` usage error.

## Commands

### `moneypath forecast` (also the default when invoked with flags but no subcommand)

```
moneypath forecast --config plan.yaml [--output-format pretty|csv]
                   [--optimize] [--write-config FILE]
                   [--emergency-months N] [--now YYYY-MM] [--log-level L]
                   [--compare SCENARIO --against SCENARIO]
                   [--compare SCENARIO --flip CHOICE --to OPTION]
```

- `--config` (required): path to a v2 YAML config. A v1 config (detected by a missing
  `version` field or `common.deathDate` present) MUST produce an error suggesting
  `moneypath migrate`. A plan with choices (chapter 03, Choices) takes no flags of its
  own: its scenarios are forecast, optimized, compared and named like any others. A
  plan the validation refuses prints its error and no results (exit 1).
- `--output-format`: `pretty` (default) or `csv`.
- `--optimize`: run the optimizer (chapter 04 §7) before forecasting.
- `--write-config FILE`: write the config as run to `FILE` — the same YAML the WASM
  results carry as `configYaml`, so with `--optimize` it holds the optimizer's chosen
  values. Without `--optimize` it is simply the config re-serialized in canonical form.
  A plan with choices is written with its `choices` and each scenario's `select`
  (chapter 03, Canonical form), never as the resolved lists.
  `--config` is never modified unless `FILE` names it. A target the optimizer could not
  improve is still written (the values are then the originals). Errors writing the file
  are runtime errors (exit 1), reported after the forecast has printed.
- `--emergency-months N`: override `recommendations.emergencyFundMonths` (0 disables).
- `--now YYYY-MM`: override the "current month" used when `simulation.startDate` is
  absent (primarily for reproducible runs and testing).
- `--log-level`: `debug|info|warn|error` (default `warn`); logs to stderr. Config
  validation warnings print at `warn`.

- `--compare A --against B`: print scenario A minus scenario B (chapter 04 §9) in
  place of the per-scenario output, in the chosen `--output-format` (see "Comparison
  output" below). The two flags go together, and each names an active scenario of the
  plan; one flag without the other, a name that is not an active scenario, or the same
  name twice is a usage error (exit 2) that prints no results. Every other flag keeps
  its meaning: with `--optimize` the comparison is of the final forecast.
- `--compare A --flip CHOICE --to OPTION`: print what one decision changes for
  scenario A. The scenario is compared with its flipped path (chapter 02, Results
  JSON, `flip`): A with OPTION selected for CHOICE and nothing else changed. The output
  is the comparison output of the flipped path minus A, the flipped path being named
  `A (CHOICE: OPTION)`. The plan is not changed, and `--write-config` writes it without
  the flipped path. `--flip` and `--to` go together, need `--compare`, and cannot be
  combined with `--against`. Breaking those rules is a usage error (exit 2) that prints
  no results. So is naming a scenario that is not active, a choice the plan does not
  have, an option the choice does not have, or the option A already selects; the
  message lists the names that would work. A flipped path that fails validation is a
  config error (exit 1). With `--optimize` the flipped path is optimized as a scenario
  written that way would be.

### `moneypath migrate`

```
moneypath migrate old-config.yaml [-o new-config.yaml]
```

Converts a legacy (v1) config to v2 (chapter 07). Output to stdout by default, or to
`-o`. Migration notices (dropped keys etc.) go to stderr.

### `moneypath serve`

```
moneypath serve [--addr :8080]
```

Serves the embedded static web app. Static assets only; no computation endpoints. The
embedded tree is a copy of the `dist/` build artifact (chapter 02): `serve` is a local
convenience, and the same `dist/` deploys to any static file host unchanged.

### `moneypath version`

Prints the build version string (injected via `-ldflags "-X ...=v"`; default `dev`).

## CSV output format (normative — conformance fixtures match byte-for-byte)

All fields double-quoted. Dates ascending. One column triple per scenario, ordered as
scenarios appear in the config (inactive scenarios omitted entirely). A scenario defined
by a `select` is a column triple like any other; choices and options do not appear:

```
"date","liquid (<scenario1>)","total (<scenario1>)","notes (<scenario1>)",…
"2025-06","30000.00","55000.00","",…
"2025-07","31200.50","56430.75","scenario Retirement savings: contribution (reduces cash balance) +350.00, growth +43.55",…
```

- Money as plain `%.2f` (no symbol, no thousands separators). An amount that rounds to
  zero is `0.00`, never `-0.00`.
- Notes joined with `,` inside the quoted field; empty string when none.
- A date some scenario lacks (different simulation spans cannot happen in v2 — all
  scenarios share the window — but defensive rendering uses `""`).
- Rows end with `\n`, including the last.
- If there are no results, print just the literal header `Date,Scenario,Liquid,Total,Notes`.

## Pretty output format

Per scenario, in config order:

```
--- Results for scenario <name> ---
Lowest cash: $28,410.00 in 2026-03 | Ending cash: $41,870.25 | Ending total: $96,512.40
Emergency fund target (6.0 months): $12,345.67 | Avg monthly expenses: $2,057.61 | Starting coverage: 14.6 months | Surplus: $17,654.33
Optimization adjustments:
 - <event> (<field>): <original> -> <value> | floor $… | min cash $… | headroom $… | iterations N (converged|not converged)
   Notes: <note>; <note>
Date    | Liquid Net Worth | Total Net Worth | Notes
____    | ________________ | _______________ | _____
2025-06 | $30,000.00 | $55,000.00 |
2025-07 | $31,200.50 | $56,430.75 | scenario Retirement savings: contribution (reduces cash balance) +350.00, growth +43.55
```

- Currency display: `$` + thousands separators + 2 decimals; negative as `-$1,234.56`;
  an amount that rounds to zero is `$0.00`, never `-$0.00`.
- The key-figures line always appears (chapter 04 §8): the lowest cash and the month it
  is reached, then cash and total at the end of the plan.
- The emergency-fund line appears only when the recommendation is enabled; `Starting
  coverage` only when > 0; exactly one of `Shortfall`/`Surplus`, only when > 0.
- The optimization block appears only when the optimizer ran and produced summaries.
- Notes column: notes joined with `, `.
- Blank line after each scenario block.

## Comparison output

What `--compare A --against B` prints instead of the formats above. `--compare A --flip
CHOICE --to OPTION` prints the same, with `A (CHOICE: OPTION)` in the place of A and A
in the place of B.

With `pretty`:

```
--- <A> minus <B> ---
Cash break-even: 2026-03 (<B> moves ahead), 2031-08 (<A> moves ahead)
Total break-even: none
Date    | Cash difference | Total difference
____    | _______________ | ________________
2025-06 | $0.00 | $0.00
2025-07 | -$1,200.50 | -$1,430.75
```

- One break-even line per series, listing every break-even month in order with the
  scenario that moves ahead in it, or `none` when the lead never changes hands.
- Differences use the currency display above; a negative amount means A is behind B.

With `csv`, in the conventions of the CSV format above (every field quoted, plain
`%.2f`, rows ending in `\n`):

```
"date","liquid (<A> minus <B>)","total (<A> minus <B>)"
"2025-06","0.00","0.00"
"2025-07","-1200.50","-1430.75"
```

Pretty output is normative in structure but conformance-tested only loosely (chapter 08);
CSV is the byte-exact surface.
