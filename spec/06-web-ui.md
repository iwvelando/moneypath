# 06 — Web UI

A single-page static app. All computation runs in-browser through the WASM engine
(chapter 02). No network calls at runtime beyond loading the app's own assets. This
chapter is normative for behavior; visual design is yours (keep it clean, uncluttered,
and accessible — semantic roles, keyboard operability, `aria-*` on tabs/tooltips/status
regions).

## Layout

A single workspace with two tabs:

1. **Planning Workspace** (default) — the config editor.
2. **Results** — disabled until a forecast has run.

A footer shows the build version (from `moneypathVersion()`).

## Planning Workspace

Toolbar actions:

- **Upload Config** — file picker (`.yaml`/`.yml`), read locally (never uploaded
  anywhere). v2 configs load into the editor. A legacy v1 config is auto-migrated via
  `moneypathMigrate` with the notices shown to the user.
- **Run Forecast** — runs the engine on the current editor state; on success, switch to
  Results. Show a busy indicator while running; surface engine errors inline without
  losing editor state.
- **Run optimizer** toggle — when on, forecasts run with `optimize: true`. Persisted in
  localStorage.
- **Download Config** — downloads the current editor state as v2 YAML (engine-serialized
  via the bridge so key ordering is canonical). After an optimizer run, offer the
  adjusted config (`configYaml` from the results).
- **Reset Config** — restores the built-in starter config (a small sensible example)
  after confirmation.
- **Theme** — System / Light / Dark, persisted in localStorage, default System.

The editor is a structured form (not a YAML textarea), organized in sections:

- **Simulation** — startDate, endDate, startingCash, emergencyFundMonths.
- **Common settings** — shared events / loans / investments.
- **Scenarios** — add/remove/rename scenarios, per-scenario active toggle and
  events / loans / investments.

Section behaviors:

- A **section navigation** bar (sticky or top-anchored) jumps between sections, with
  previous/next controls; jumping briefly highlights the target section.
- Lists (events, loans, investments, contributions, withdrawals, extra principal
  payments) support add / remove / duplicate-friendly editing.
- Every field has a help affordance (tooltip/popover) explaining its semantics in the
  words of chapter 03.
- Month fields validate `YYYY-MM` as you type; numeric fields support arrow-key stepping
  (larger steps with a modifier).
- An event's **optimize** sub-form appears on demand (field picker with per-field bound
  inputs per chapter 03, defaults prefilled).
- Editor state autosaves to localStorage (debounced), restored on load; corrupt or
  version-mismatched saved state falls back to the starter config.

Validation warnings returned by the engine are displayed prominently but never block a
run (they are warnings). Hard config errors show inline near the run action.

## Results

- **Scenario tabs** — one per active scenario.
- **Summary panel** — per selected scenario: emergency-fund recommendation (target,
  average expenses, coverage, shortfall/surplus) and optimizer adjustment summaries when
  present (original → chosen value, converged status, notes).
- **Chart** — inline SVG line chart of the selected scenario over time, two series:
  Liquid and Total. Requirements: legend; hover/focus tooltip showing date and both
  values (currency-formatted); date-axis and value-axis ticks; visually distinguish
  spans where a series is negative (e.g. tinted region) so danger zones stand out;
  responsive resize; a "no data" empty state.
- **Table** — all months for the selected scenario: date, liquid, total, notes.
- **Download CSV** — saves the engine-rendered CSV (all scenarios, exactly the CLI's
  bytes).
- Run duration display (informational).

## Sub-path hosting

The app MUST work when served from any path prefix without configuration: relative URLs
for all assets including the WASM binary. (`moneypath serve` hosts at `/`, but a static
bucket may not.)

The app is a single page with no client-side routing: the tabs and sections above are
in-page state, never URL routes, and no view needs to be deep-linkable. A host therefore
needs only to serve `index.html` for the deploy root — no rewrite rules, no history API.
See chapter 02, "Build artifacts", for the asset-naming and wasm-loading rules that go
with this.

## Persistence summary (all localStorage, all optional-to-the-engine)

- editor state (versioned key), theme choice, optimizer toggle.
No cookies, no external storage, no analytics.
