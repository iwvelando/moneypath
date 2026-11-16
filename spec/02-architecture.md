# 02 — Architecture

*Status: **Mixed** — the sections marked normative (Results JSON, Problems JSON, Determinism) are
Contract; the rest is descriptive. See SPEC.md.*

## Shape

One Go module, `github.com/iwvelando/moneypath`, compiled to WebAssembly and bundled
with a frontend into one static site:

```
┌────────────────────────────────────────────────────────┐
│                     Go module                          │
│                                                        │
│  engine/    pure simulation core (no I/O, no logging   │
│             framework, no globals)                     │
│  config/    v2 YAML parse + validate                   │
│  render/    CSV rendering of results                   │
│  internal/app/           run pipeline + results JSON   │
│  cmd/moneypath-wasm/     WASM entry (syscall/js bridge)│
└────────────────────────────────────────────────────────┘
                          │
                    moneypath.wasm
                          │
                  web/  (TypeScript + Vite)
                  → dist/  fully static site
```

The Go packages also build natively. Nothing ships that way: it is how `go test` runs
the unit tests and the conformance fixtures.

Package names/layout above are RECOMMENDED, not normative — but the **boundaries** are
normative:

- `engine` MUST be pure: config in, results out. No file access, no clock reads (the
  caller supplies "now"), no logging dependencies, no environment access. It returns
  warnings and notes as data. This is what lets the fixtures, checked natively, speak for
  the WASM build the site ships.
- CSV rendering MUST live in Go. The web app's "Download CSV" MUST serve the
  engine-rendered CSV string, never a JavaScript re-implementation.
- The WASM entry is transport only: it decodes arguments, calls `internal/app`, and
  encodes the answer.
- The frontend MUST NOT contain any finance math. It renders results and edits configs.

## WASM bridge

The WASM module exposes to JavaScript (names normative):

- `moneypathForecast(configYAML string, optionsJSON string) → string` — parses and
  validates the config, runs the forecast (with optimizer if `{"optimize": true}`),
  returns the **results JSON** below, or `{"error": "..."}` with a human-readable message.
  Options also accept `"now"` (a `YYYY-MM` string) so the UI pins the current month;
  when absent the bridge uses the real current month.
  Options also accept `"flip"`, `{"scenario": "…", "choice": "…", "option": "…"}`, which
  asks for the comparison described under `flip` below. A flip that cannot be made
  returns `{"error": "..."}` and no results.
- `moneypathValidate(configYAML string, optionsJSON string) → string` — parses and
  validates the config without running it and returns the **problems JSON** below. It
  never returns `{"error": "..."}` for a config it could read as text: a config that
  cannot be parsed is itself one problem. Options accept `"now"` as above.
- `moneypathVersion() → string` — the build version string.

### Problems JSON (normative shape)

```json
{"problems": [
  {"level": "error",
   "path": "common.investments.0.withdrawalTaxRate",
   "where": "Baseline, investment “Brokerage”",
   "message": "The withdrawal tax rate must be at least 0 and less than 100."},
  {"level": "warning",
   "path": "scenarios.1.events.0.endDate",
   "where": "Scenario “rent”, event “Bonus”",
   "message": "This ends after the simulation does (2030-01), so the later months are not counted."}
]}
```

`problems` holds **every** rule of chapter 03 the config breaks, not only the first, and
every warning; it is empty for a config with neither. Each entry has:

- `level` — `error` (the config cannot be run) or `warning` (it can).
- `path` — the field the problem is about, as its place in the config document: keys
  joined by `.`, with a list entry given by its zero-based position. A scenario's pick for
  a choice is `scenarios.<i>.select.<j>`, where `j` is the choice's position in `choices`.
  A problem with a baseline entry as an option changes it is placed under that change's
  `set` (`choices.<i>.options.<j>.change.loans.<k>.set.term`), whether or not `set` lists
  the field. `path` names the entry or list when no single field is at fault, and is
  empty when the problem is with the document as a whole.
- `where` — the same place in words a reader of the app knows (`common` is "Baseline"; an
  entry is named, or numbered from 1 when it has no name). Empty when `path` is.
- `message` — one complete sentence that states the rule without repeating the place.
  It uses no config key, no index and no comparison symbols.

`moneypathForecast` reports the same problems as text: its `error` is the first
`error` problem and each of its `warnings` is one `warning` problem, written
`<where>: <message>`, or `<message>` alone when `where` is empty.

### Results JSON (normative shape)

```json
{
  "version": "…",
  "scenarios": ["scenario name", "…"],
  "rows": [
    {"date": "2025-06",
     "values": [{"liquid": 30000.0, "total": 55000.0, "notes": ["…"]}, …]}
  ],
  "csv": "…engine-rendered CSV (chapter 05)…",
  "metrics": [
    {"keyFigures": {"lowestCash": 0.0, "lowestCashDate": "2025-06",
                    "endingCash": 0.0, "endingTotal": 0.0},
     "emergencyFund": {"targetMonths": 6, "averageMonthlyExpenses": 0.0,
                       "targetAmount": 0.0, "initialLiquid": 0.0,
                       "fundedMonths": 0.0, "shortfall": 0.0, "surplus": 0.0},
     "optimizations": [
       {"targetName": "…", "field": "…",
        "original": 0.0, "value": 0.0,
        "originalDisplay": "…", "valueDisplay": "…",
        "floor": 0.0, "minimumCash": 0.0, "headroom": 0.0,
        "iterations": 0, "converged": true, "notes": ["…"]}
     ]}
  ],
  "comparisons": [
    {"scenario": 0, "against": 1,
     "cash":  {"difference": [0.0, …],
               "breakEven": [{"date": "2026-03", "leader": 1}]},
     "total": {"difference": [0.0, …], "breakEven": []}}
  ],
  "flip": {"scenario": 0, "choice": "Housing", "option": "Sell and rent",
           "name": "current path (Housing: Sell and rent)",
           "cash":  {"difference": [0.0, …],
                     "breakEven": [{"date": "2026-03", "flipped": true}]},
           "total": {"difference": [0.0, …], "breakEven": []}},
  "warnings": ["…validation warnings…"],
  "configYaml": "…the config as run (reflects optimizer adjustments when enabled)…"
}
```

`configYaml` is the plan in its written form: a plan with choices carries its `choices`
and each scenario's `select` (chapter 03, Canonical form), never the resolved lists.

`rows` is sorted ascending by date; `values` and `metrics` are index-aligned with
`scenarios`. `liquid`/`total` are omitted (JSON `null` or absent) for dates a scenario has
no value for. Numbers are raw float64 values; formatting is the consumer's job.

`keyFigures` (chapter 04 §8) is present for every scenario; `lowestCashDate` is a
`YYYY-MM` string. `emergencyFund` is absent when the recommendation is disabled, and
`optimizations` when the optimizer produced no summary for the scenario.

`comparisons` (chapter 04 §9) holds one entry for every ordered pair of distinct
scenarios, `scenario` minus `against`, both given as indexes into `scenarios`. Entries
are ordered by `scenario` and then by `against`, so both orders of a pair are present and
a consumer never negates a difference. It is an empty array when there are fewer than two
scenarios. For `cash` and for `total`, `difference` is index-aligned with `rows`, and
`breakEven` lists the break-even months in ascending order, each with its `YYYY-MM`
`date` and the index of the scenario that moves ahead as `leader`; it is an empty array
when the lead never changes hands.

`flip` is present only when the `flip` option asked for it; every other field is then
exactly what the same run reports without the option. It compares one active scenario
with the **flipped path**: that scenario with the option it selects for one choice
replaced by another option of the same choice, and nothing else changed. The flipped
path is resolved (chapter 03, Choices) and simulated like a scenario written that way
by hand, under the same options as the run, so with the optimizer it is optimized as
that scenario would be. It is not a scenario of the plan: it appears nowhere else in the
results, and `csv` and `configYaml` do not carry it. `scenario` indexes `scenarios`,
`choice` and `option` repeat the request, and `name` is the flipped path's display name,
`<scenario> (<choice>: <option>)`. `cash` and `total` are the comparison of chapter 04
§9 read as flipped path minus scenario: `difference` is index-aligned with `rows`, and
each `breakEven` entry has `flipped` true when the flipped path moves ahead in that
month and false when the scenario does. The flip is refused when the scenario is not an
active scenario of the plan, the plan has no such choice, the choice has no such option,
the scenario already selects that option, or the flipped path fails validation.

In `optimizations`, `original` and `value` are the raw numbers the optimizer searched over
— currency for `amount`, a count for `frequency`, a month index (`year·12 + month − 1`)
for `startDate`/`endDate` — and the `…Display` strings are those same numbers formatted
for a reader (`YYYY-MM` for the date fields). A consumer that needs to write a chosen
value back into a config reads `value` for `amount` and `frequency`, and `valueDisplay`
for the date fields.

## Determinism (normative)

- All money math uses float64. The engine MUST NOT depend on map iteration order,
  goroutine scheduling, or locale for any computed value or rendered output.
- Dates are calendar months, always handled as `YYYY-MM` strings at boundaries and
  stepped with calendar-month arithmetic (Go `time.AddDate(0, n, 0)` semantics).
- Rendered currency values are formatted to exactly two decimals (`%.2f` semantics —
  round half away from zero is NOT required; use Go's default `%.2f` behavior).
- **Parity requirement:** for any config, the CSV string produced by the engine built
  natively, which the conformance fixtures are checked against, and by the WASM build,
  which the site ships, MUST be byte-identical. This is a conformance test (chapter 08).
- Engine-internal balance comparisons that need cent precision (e.g. "did the loan reach
  zero") MUST round to 2 decimals before comparing, so float drift never changes behavior.

## Frontend stack

- TypeScript + Vite; Preact is RECOMMENDED (any equivalently lightweight, statically
  buildable stack MAY substitute — no SSR, no runtime CDN dependencies, all assets
  self-hosted in `dist/`).
- The chart is inline SVG rendered by the app (chapter 06); no charting library required.
- Asset URLs are relative throughout, so the site works from any path prefix.
- Budget: the `.wasm` artifact SHOULD be ≤ 5 MB (standard Go toolchain output is
  acceptable; TinyGo is optional). Load it once, show a loading state, and let HTTP
  caching do its job.

## Build artifacts

This section describes the build as it is. It serves the one public deployment
(chapter 01, "Scope"), and the checks named here are what hold it in place: change
the build and those checks together.

The source tree produces one artifact, **`dist/`**: the complete static site —
`index.html`, hashed JS/CSS, and `moneypath.wasm`, with no other runtime dependency.
Publishing is copying the tree to the site's bucket; nothing is built or rewritten
on the host.

- **Build order.** Two stages: (1) compile the engine wasm (`GOOS=js GOARCH=wasm`);
  (2) run the bundler with that wasm as a *bundler input*, imported as a hashed asset
  through `new URL('./moneypath.wasm', import.meta.url)`, producing `dist/`.
- **Matched glue.** The Go wasm glue (`wasm_exec.js`) and the compiler only work as a
  pair, so the build takes the glue from the Go toolchain that compiles the wasm. A
  copy is never committed.
- **Content hashing.** Every asset the app fetches at runtime — JS, CSS,
  `moneypath.wasm`, and the glue, which is bundled like any other module — has a
  content-derived filename, and `index.html` is the only unhashed entry point. A
  fetched `index.html` therefore always references matching assets: a stale cache
  serves a coherent old version, never a mix. The deploy relies on this to cache
  `assets/` indefinitely. `TestStaticBundle` checks the engine's hashed name.
- **Relative URLs.** `index.html` and the bundle refer to every asset by a relative
  URL (`TestStaticBundle`).
- **Wasm content type.** The app uses `WebAssembly.instantiateStreaming` and falls
  back to `WebAssembly.instantiate(await response.arrayBuffer())` when that rejects,
  as it does when a server sends `.wasm` without the `application/wasm` type.
- **No routing.** The app is a single page: `index.html` at the root of `dist/`. Tabs
  and sections are in-page state, not URL routes, so the host needs no rewrite rules.
- **Completeness.** `web/scripts/check-dist.mjs` fails the build when `dist/` lacks the
  real engine, the icons, the 404 page or the license notices.
