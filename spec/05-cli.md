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
```

- `--config` (required): path to a v2 YAML config. A v1 config (detected by a missing
  `version` field or `common.deathDate` present) MUST produce an error suggesting
  `moneypath migrate`.
- `--output-format`: `pretty` (default) or `csv`.
- `--optimize`: run the optimizer (chapter 04 §7) before forecasting.
- `--write-config FILE`: write the config as run to `FILE` — the same YAML the WASM
  results carry as `configYaml`, so with `--optimize` it holds the optimizer's chosen
  values. Without `--optimize` it is simply the config re-serialized in canonical form.
  `--config` is never modified unless `FILE` names it. A target the optimizer could not
  improve is still written (the values are then the originals). Errors writing the file
  are runtime errors (exit 1), reported after the forecast has printed.
- `--emergency-months N`: override `recommendations.emergencyFundMonths` (0 disables).
- `--now YYYY-MM`: override the "current month" used when `simulation.startDate` is
  absent (primarily for reproducible runs and testing).
- `--log-level`: `debug|info|warn|error` (default `warn`); logs to stderr. Config
  validation warnings print at `warn`.

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
scenarios appear in the config (inactive scenarios omitted entirely):

```
"date","liquid (<scenario1>)","total (<scenario1>)","notes (<scenario1>)",…
"2025-06","30000.00","55000.00","",…
"2025-07","31200.50","56430.75","scenario Retirement savings: contribution (reduces cash balance) +350.00, growth +43.55",…
```

- Money as plain `%.2f` (no symbol, no thousands separators).
- Notes joined with `,` inside the quoted field; empty string when none.
- A date some scenario lacks (different simulation spans cannot happen in v2 — all
  scenarios share the window — but defensive rendering uses `""`).
- Rows end with `\n`, including the last.
- If there are no results, print just the literal header `Date,Scenario,Liquid,Total,Notes`.

## Pretty output format

Per scenario, in config order:

```
--- Results for scenario <name> ---
Emergency fund target (6.0 months): $12,345.67 | Avg monthly expenses: $2,057.61 | Starting coverage: 14.6 months | Surplus: $17,654.33
Optimization adjustments:
 - <event> (<field>): <original> -> <value> | floor $… | min cash $… | headroom $… | iterations N (converged|not converged)
   Notes: <note>; <note>
Date    | Liquid Net Worth | Total Net Worth | Notes
____    | ________________ | _______________ | _____
2025-06 | $30,000.00 | $55,000.00 |
2025-07 | $31,200.50 | $56,430.75 | scenario Retirement savings: contribution (reduces cash balance) +350.00, growth +43.55
```

- Currency display: `$` + thousands separators + 2 decimals; negative as `-$1,234.56`.
- The emergency-fund line appears only when the recommendation is enabled; `Starting
  coverage` only when > 0; exactly one of `Shortfall`/`Surplus`, only when > 0.
- The optimization block appears only when the optimizer ran and produced summaries.
- Notes column: notes joined with `, `.
- Blank line after each scenario block.

Pretty output is normative in structure but conformance-tested only loosely (chapter 08);
CSV is the byte-exact surface.
