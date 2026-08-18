# 02 — Architecture

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
       {"targetName": "…", "field": "…", "originalDisplay": "…", "valueDisplay": "…",
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

## `moneypath serve`

Serves the embedded `dist/` (via `go:embed`) on a configurable address. Static files
only; no other routes. It exists so CLI users can open the web UI locally without
installing anything else.

## Logging

The CLI MAY log operational diagnostics (config warnings, timing) to stderr, controlled
by `--log-level`. Simulation results go to stdout only. The engine itself never logs —
it returns warnings/notes as data.
