# 08 — Conformance and workflow

## What's in `testdata/`

### `testdata/conformance/<case>/`

- `config.yaml` — a v2 config. Every conformance config pins `simulation.startDate`, so
  runs are reproducible without `--now`.
- `expected.csv` — the exact CSV the engine must produce (chapter 05 format).
- `manifest.yaml` — metadata:

```yaml
description: what this case exercises
normative: true          # false = informative only (do not gate CI on it)
optimize: false          # run with the optimizer enabled?
tolerance: 0.01          # max |actual − expected| per numeric cell; notes/dates exact
expectedMetrics: […]     # optional: per-scenario emergency-fund and optimization
                         # metrics (rounded to 4 decimals; compare within 0.01).
                         # Metrics reflect the FINAL forecast — after optimizer
                         # adjustments — while each optimization's `floor` is
                         # snapshotted from the baseline run per chapter 04 §7,
                         # so the two can legitimately disagree.
```

A case passes when every numeric cell matches within `tolerance` (compare parsed values,
not strings, to stay robust to `-0.00`), and all dates, headers, and note strings match
exactly. Cases marked `normative: true` MUST pass; treat a failure as your bug first, a
fixture bug second (if you become convinced the fixture contradicts chapters 03–05,
stop and flag it — do not "fix" fixtures to match your code).

### `testdata/migration/<case>/`

- `legacy.yaml` — a v1 input.
- `expected.yaml` — the v2 translation. Compare **semantically**: parse both YAML
  documents and require equal structures (key order/comments/formatting are free).

## Required checks (wire these into `go test` early — they are your red tests)

1. **Conformance**: for each normative case, run the engine on `config.yaml` (with
   optimizer per manifest) and diff against `expected.csv` under the manifest rules.
2. **Migration**: for each case, run the converter on `legacy.yaml` and compare
   semantically to `expected.yaml`. Also assert the output validates as v2.
3. **CLI ↔ WASM parity**: for every conformance config, the CSV from the native binary
   and from the WASM build MUST be byte-identical. (Practical approach: run the WASM
   module under `GOOS=js GOARCH=wasm go test` with Node, or via `wasmbrowsertest`;
   at minimum, run the same engine entry through both build tags in CI.)
4. **Round-trip**: `migrate` output for each migration case, fed to the forecast engine,
   runs without hard errors.
5. **Unit tests you write yourself** for the engine internals (amortization math, event
   scheduling, investment ordering, optimizer bisection) — the fixtures are integration
   nets, not a substitute for unit coverage. Follow red/green/refactor: write the failing
   test, watch it fail, make it pass, then clean up.

## Suggested implementation order

1. Config v2 parse + validate (chapter 03) → fixture configs all load.
2. Event scheduling + the simulation loop with events only → `events-only` case green.
3. Loans (§3 in order: amortization → extra principal → MI → early payoff → escrow).
4. Investments.
5. Emergency fund, notes, CSV/pretty rendering → remaining non-optimizer cases green.
6. Optimizer.
7. Migration (chapter 07).
8. WASM bridge + parity check.
9. Web UI (chapter 06), starter config, `serve`.

## Provenance note

Expected outputs were produced from an independent reference implementation of chapters
03–05 and cross-checked against the predecessor tool everywhere the appendix in chapter
04 does not declare a deviation. Tolerances exist only to absorb float64 formatting
edge cases, not semantic slack.
