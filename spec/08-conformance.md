# 08 — Fixtures and conformance checks

*Status: **Reference** — describes the `testdata/` formats and the checks that consume
them. Update it when those change. See SPEC.md.*

## `testdata/conformance/<case>/`

- `config.yaml` — a v2 config. Every conformance config pins `simulation.startDate`, so
  runs are reproducible whatever the current month.
- `expected.csv` — the exact CSV the engine must produce (chapter 05 format).
- `manifest.yaml` — metadata:

```yaml
description: what this case exercises
normative: true          # false = informative only (do not gate CI on it)
optimize: false          # run with the optimizer enabled?
tolerance: 0.01          # max |actual − expected| per numeric cell; notes/dates exact
expectedMetrics: […]     # optional: per-scenario key-figure, emergency-fund and
                         # optimization metrics (rounded to 4 decimals; compare
                         # within 0.01; `keyFigures.lowestCashDate` exactly).
                         # Metrics reflect the FINAL forecast — after optimizer
                         # adjustments. The last optimization's `floor` is that
                         # forecast's emergency-fund target (chapter 04 §7).
expectedComparisons: […] # optional: differences and break-even months for named
                         # ordered pairs (chapter 04 §9); see below.
earliest: […]            # optional: earliest-month questions and their answers
                         # (chapter 04 §11); see below.
```

An `expectedMetrics` entry may also pin the scenario's guardrail results (chapter 04
§10) under `guardrails`: the complete list, in the plan's order, each with its `name`,
`kind` and `result` exactly, `firstBreachDate` and `tightestDate` exactly (absent where
the result has none), and `margin` within 0.01. A `debtFree` gives `marginMonths`
exactly where it has a cleared month and `owed` within 0.01 where it breaks, and no
`margin`. An entry without `guardrails` does not check them.

```yaml
expectedMetrics:
  - scenario: dips
    guardrails:
      - {name: Cushion, kind: cashFloor, result: breaks,
         firstBreachDate: "2025-02", tightestDate: "2025-03", margin: -300.00}
      - {name: After the plan, kind: cashFloor, result: doesNotApply}
```

An `expectedComparisons` entry pins one ordered pair, `scenario` minus `against`, for
`cash` and for `total`:

```yaml
expectedComparisons:
  - scenario: take the course
    against: stay employed
    cash:
      breakEven:                 # exact, in order; [] when the lead never changes
        - {date: "2025-05", leader: take the course}
      endingDifference: -500.00  # the last month's difference, within 0.01
    total:
      breakEven: []
      endingDifference: -2900.00
```

Beyond what the entry states, every month's difference must equal the difference of that
pair's `expected.csv` columns, within the case's `tolerance` for each of the two cells.
`expected.csv` itself carries no comparison columns.

An `earliest` entry asks one question of the case's plan, run as the manifest says,
and pins its whole answer (chapter 02, Results JSON, `earliest`). `month` is absent when
no month works. `configured`, `month`, `works` and `holds` are compared exactly, and
`decidedBy` and `atEarliest` (absent where the answer has none) by the rule for
`guardrails` above. The guardrails are given in the plan's order.

```yaml
earliest:
  - ask: {scenario: buy the car, entry: common.loans.0, field: startDate,
          from: "2026-01", to: "2028-08", guardrails: [Cushion, Car gone by 2028-06]}
    configured: "2027-01"
    month: "2026-03"
    works: [{from: "2026-03", to: "2026-08"}, {from: "2027-05", to: "2027-06"}, …]
    holds:
      - {name: Cushion, months: [{from: "2026-03", to: "2026-08"}, …]}
      - {name: Car gone by 2028-06, months: [{from: "2026-01", to: "2028-05"}]}
    decidedBy:
      - {name: Cushion, kind: cashFloor, result: breaks,
         firstBreachDate: "2028-04", tightestDate: "2028-04", margin: -7.75}
    atEarliest: […]
```

A case passes when every numeric cell matches within `tolerance` (compare parsed values,
not strings), and all dates, headers, and note strings match
exactly. Tolerances absorb float64 formatting edge cases, not semantic slack.

## `testdata/problems/<case>/`

What validation reports is specified too (chapter 02, "Problems JSON"; the rules are
chapter 03's), and these cases pin it. A case here is a config that is *not* sound:

- `config.yaml` — a v2 config that breaks rules or raises warnings. It pins
  `simulation.startDate` like any other fixture.
- `expected.yaml` — a `description`, and `problems`: every problem the config raises,
  each with its `level`, `path`, `where` and `message`, in the order the engine reports
  them. The list is complete: a problem it leaves out is a failure, as is one it adds.

A case passes when the engine reports exactly that list, and the WASM build's answer
is byte-identical to the native one.

## Changing a fixture

Fixtures are the enforcement mechanism for chapters 03–05 and the problems of chapter
02, so a failing one is your bug
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
| Problems | `TestProblems` (`conformance/`) | Each `testdata/problems` case raises exactly the problems its `expected.yaml` lists, natively and, when `node` is present, byte-identically from the wasm module. |
| Growth that changes nothing | `TestGrowthThatChangesNothingLeavesEveryCaseAlone` (`conformance/`) | Every case without growth of its own gives exactly the same results and CSV with an inflation rate and `growth: 0` beside every amount and escrow, and with `growth: inflation` at a rate that is absent or 0 (chapter 03, Growth). |
| Native ↔ WASM parity | `TestNativeWASMParity` (`conformance/`) | For every conformance config, native and WASM CSV are byte-identical. Runs the wasm module under Node; self-skips when `node` is absent. |
| Static bundle | `TestStaticBundle` (`conformance/`) | The web build produces a standalone `dist/`: relative URLs throughout and a content-hashed engine (chapter 02). Self-skips when `web/dist` is not built. |
| Distribution | `web/scripts/check-dist.mjs` (`make dist`) | `dist/` holds the real engine, the icons and link-preview card, the 404 page, and the license notices. |
| Browser | `web/e2e/` (Playwright; `make test-browser`, `make test-webkit`) | The production build, under the production CSP, loads the real engine, runs a forecast and both downloads, survives denied storage, and never scrolls sideways on a 360 px phone or an iPhone. Tests tagged `@smoke` also run against the live site after each deploy. |

The fixtures are integration nets, not a substitute for unit coverage: engine internals
(amortization, event scheduling, investment ordering, optimizer bisection) carry their
own tests, and new engine behavior starts with a failing one that cites the chapter 04
section it encodes.
