# 08 — Fixtures and conformance checks

*Status: **Reference** — describes the `testdata/` formats and the checks that consume
them. Update it when those change. See SPEC.md.*

## `testdata/conformance/<case>/`

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
exactly. Tolerances absorb float64 formatting edge cases, not semantic slack.

## `testdata/migration/<case>/`

- `legacy.yaml` — a v1 input.
- `expected.yaml` — the v2 translation. Compared **semantically**: both documents are
  parsed and their structures must be equal (key order, comments and formatting are free).

## Changing a fixture

Fixtures are the enforcement mechanism for chapters 03–05, so a failing one is your bug
until proven otherwise. Never edit a fixture to make failing code pass.

Changing one is legitimate in exactly one situation: a **deliberate change to specified
behavior**. That is a spec change, and it lands as one — the chapter edit and the fixture
edit in the same commit, called out in the commit message. If a fixture instead looks
like it contradicts chapters 03–05 as written, stop and raise it rather than picking a
side.

## The checks

| Check | Where | What it asserts |
|---|---|---|
| Conformance | `TestConformance` (`conformance/`) | Each normative case reproduces `expected.csv` under its manifest rules. |
| Migration | `TestMigrationFixtures` (`legacy/`) | Each case converts to `expected.yaml` semantically, and the output validates as v2. |
| Round-trip | `TestMigrationFixtures` (`legacy/`) | Every migrated config then runs through the forecast engine without hard errors. |
| Rejections | `TestMigrateRejects` (`legacy/`) | Chapter 07's required failure modes still fail. |
| CLI ↔ WASM parity | `TestCLIWASMParity` (`conformance/`) | For every conformance config, native and WASM CSV are byte-identical. Runs the wasm module under Node; self-skips when `node` is absent. |
| Static bundle | `TestStaticBundle` (`conformance/`) | The web build produces a standalone `dist/`, and the tree embedded in the binary is identical to it (chapter 02). |
| Distribution | `web/scripts/check-dist.mjs` (`make dist`) | `dist/` holds the real engine, the icons and link-preview card, the 404 page, and the license notices. |
| Browser | `web/e2e/` (Playwright; `make test-browser`, `make test-webkit`) | The production build, under the production CSP, loads the real engine, runs a forecast and both downloads, survives denied storage, and never scrolls sideways on a 360 px phone or an iPhone. Tests tagged `@smoke` also run against the live site after each deploy. |

The fixtures are integration nets, not a substitute for unit coverage: engine internals
(amortization, event scheduling, investment ordering, optimizer bisection) carry their
own tests, and new engine behavior starts with a failing one that cites the chapter 04
section it encodes.
