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
| Native ↔ WASM parity | `TestNativeWASMParity` (`conformance/`) | For every conformance config, native and WASM CSV are byte-identical. Runs the wasm module under Node; self-skips when `node` is absent. |
| Static bundle | `TestStaticBundle` (`conformance/`) | The web build produces a standalone `dist/`: relative URLs throughout and a content-hashed engine (chapter 02). Self-skips when `web/dist` is not built. |
| Distribution | `web/scripts/check-dist.mjs` (`make dist`) | `dist/` holds the real engine, the icons and link-preview card, the 404 page, and the license notices. |
| Browser | `web/e2e/` (Playwright; `make test-browser`, `make test-webkit`) | The production build, under the production CSP, loads the real engine, runs a forecast and both downloads, survives denied storage, and never scrolls sideways on a 360 px phone or an iPhone. Tests tagged `@smoke` also run against the live site after each deploy. |

The fixtures are integration nets, not a substitute for unit coverage: engine internals
(amortization, event scheduling, investment ordering, optimizer bisection) carry their
own tests, and new engine behavior starts with a failing one that cites the chapter 04
section it encodes.
