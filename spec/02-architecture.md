# 02 — Architecture

*Status: **Mixed** — the sections marked normative (Results JSON, Determinism,
Build artifacts) are Contract; the rest is descriptive. See SPEC.md.*

## Shape

One Go module, `github.com/iwvelando/moneypath`, built into two artifacts plus a frontend:

```
┌────────────────────────────────────────────────────────┐
│                     Go module                          │
│                                                        │
│  engine/    pure simulation core (no I/O, no logging   │
│             framework, no globals)                     │
│  config/    v2 YAML parse + validate                   │
│  legacy/    v1 YAML parse + v1→v2 conversion           │
│  render/    pretty-table and CSV rendering of results  │
│  cmd/moneypath/          CLI (forecast|migrate|serve|  │
│                          version)                      │
│  cmd/moneypath-wasm/     WASM entry (syscall/js bridge)│
└────────────────────────────────────────────────────────┘
         │                            │
   native binary                 moneypath.wasm
   (CLI + serve)                      │
                              web/  (TypeScript + Vite)
                              → dist/  fully static site
```

Package names/layout above are RECOMMENDED, not normative — but the **boundaries** are
normative:

- `engine` MUST be pure: config in, results out. No file access, no clock reads (the
  caller supplies "now"), no logging dependencies, no environment access. This is what
  guarantees CLI/WASM parity.
- CSV and pretty rendering MUST live in shared Go code used by both the CLI and the WASM
  bridge. The web app's "Download CSV" MUST serve the engine-rendered CSV string, never a
  JavaScript re-implementation.
- The frontend MUST NOT contain any finance math. It renders results and edits configs.

## WASM bridge

The WASM module exposes to JavaScript (names normative):

- `moneypathForecast(configYAML string, optionsJSON string) → string` — parses and
  validates the config, runs the forecast (with optimizer if `{"optimize": true}`),
  returns the **results JSON** below, or `{"error": "..."}` with a human-readable message.
  Options also accept `"now"` (a `YYYY-MM` string) so the UI pins the current month;
  when absent the bridge uses the real current month.
- `moneypathMigrate(legacyYAML string) → string` — returns
  `{"configYaml": "...", "notices": ["..."]}` or `{"error": "..."}` (see chapter 07).
- `moneypathVersion() → string` — the build version string.

### Results JSON (normative shape)

```json
{
  "version": "…",
  "scenarios": ["scenario name", "…"],
  "rows": [
    {"date": "2025-06",
     "values": [{"liquid": 30000.0, "total": 55000.0, "notes": ["…"]}, …]}
  ],
  "csv": "…engine-rendered CSV, exactly as the CLI would print…",
  "metrics": [
    {"emergencyFund": {"targetMonths": 6, "averageMonthlyExpenses": 0.0,
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
  "warnings": ["…validation warnings…"],
  "configYaml": "…the config as run (reflects optimizer adjustments when enabled)…"
}
```

`rows` is sorted ascending by date; `values` and `metrics` are index-aligned with
`scenarios`. `liquid`/`total` are omitted (JSON `null` or absent) for dates a scenario has
no value for. Numbers are raw float64 values; formatting is the consumer's job.

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
- **Parity requirement:** for any config, the CSV string produced by the native CLI and
  by the WASM build MUST be byte-identical. This is a conformance test (chapter 08).
- Engine-internal balance comparisons that need cent precision (e.g. "did the loan reach
  zero") MUST round to 2 decimals before comparing, so float drift never changes behavior.

## Frontend stack

- TypeScript + Vite; Preact is RECOMMENDED (any equivalently lightweight, statically
  buildable stack MAY substitute — no SSR, no runtime CDN dependencies, all assets
  self-hosted in `dist/`).
- The chart is inline SVG rendered by the app (chapter 06); no charting library required.
- The site MUST work when hosted at any sub-path (e.g. `https://host/tools/moneypath/`):
  use relative asset URLs throughout. No absolute-path assumptions.
- Budget: the `.wasm` artifact SHOULD be ≤ 5 MB (standard Go toolchain output is
  acceptable; TinyGo is optional). Load it once, show a loading state, and let HTTP
  caching do its job.

## Build artifacts (normative)

One source tree produces two artifacts:

- **`dist/`** — the complete static site: `index.html`, hashed JS/CSS, and
  `moneypath.wasm`, with no other runtime dependency. This is the shippable artifact.
  Publishing MUST be nothing more than copying the tree to a static file host (object
  storage behind a CDN, a plain web server, a local directory). No build step, rewrite
  rule, or server configuration may be required to make it work.
- **The native binary**, which embeds a copy of that same `dist/` tree via `go:embed` to
  back `moneypath serve`.

The build never assumes a particular host, even though one public deployment exists
(chapter 01, "Scope"); these properties of the build are what keep every host an option:

- **Build order.** Three stages: (1) compile the engine wasm (`GOOS=js GOARCH=wasm`);
  (2) run the bundler with that wasm as a *bundler input* — imported as a hashed asset
  (e.g. `new URL('./moneypath.wasm', import.meta.url)` or equivalent), never dropped into
  a verbatim-copied `public/` directory — producing `dist/`; (3) the native Go build
  embeds `dist/`. Both artifacts of a given release build MUST come from the same `dist/`
  tree, so `moneypath serve` and a published copy serve byte-identical files. The embed is
  a copy of the artifact, never a substitute for producing it: a *release* build that
  yields only a binary is incomplete. During development a placeholder `dist/` MAY be
  embedded so engine work doesn't depend on the frontend toolchain; the chapter 08
  embedded-tree identity check keeps a stub or stale tree out of any release.
- **Content hashing.** Every asset the app fetches at runtime — JS, CSS,
  `moneypath.wasm`, and the Go wasm glue (`wasm_exec.js`, bundled like any other module) —
  MUST have a content-derived filename. This guarantees a fetched `index.html` always
  references matching assets: a stale cache can never mix old and new files — at worst it
  serves a coherent old version. (Whether `index.html` itself is cached fresh is
  cache-header territory, i.e. host configuration, and stays out of scope.) Bundlers hash
  JS/CSS by default but typically copy files out of `public/` verbatim; the wasm MUST NOT
  be left unhashed. `index.html` is the only unhashed entry point.
- **Wasm content type.** The app MUST NOT assume the host serves `.wasm` as
  `application/wasm` — several object stores do not. Use
  `WebAssembly.instantiateStreaming` where it works and fall back to
  `WebAssembly.instantiate(await response.arrayBuffer())` when it rejects on content
  type, rather than surfacing a failure the user cannot act on.
- **No routing.** The app is a single page: `index.html` at the root of `dist/`. Tabs and
  sections are in-page state, not URL routes. The app MUST NOT require deep-linkable
  URLs, history rewriting, or a host-side 404-to-`index.html` rewrite. The only path a
  host must resolve is the deploy root, serving `index.html`.

## `moneypath serve`

Serves the embedded `dist/` (via `go:embed`) on a configurable address. Static files
only; no other routes. It exists so CLI users can open the web UI locally without
installing anything else — it is a convenience, not the deployment path.

## Logging

The CLI MAY log operational diagnostics (config warnings, timing) to stderr, controlled
by `--log-level`. Simulation results go to stdout only. The engine itself never logs —
it returns warnings/notes as data.
