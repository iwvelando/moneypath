# 06 — Web UI

*Status: **Descriptive** — this chapter states what the app is for and the constraints it
must never break. Interaction detail deliberately lives in the code and its vitest suite,
which move faster than prose can follow. See SPEC.md.*

## What it is

A single-page static app that is the primary interface to the same engine: a structured
editor for a v2 config, and a reader for the results of running it. The user should be
able to plan without ever learning the YAML format, and to leave with the YAML if they
want it.

It is not a separate product from the CLI. Anything it computes, it computes by calling
the engine — the frontend edits configs and renders results, and holds no finance math of
its own (chapter 02).

## Constraints (normative)

These are the properties that must survive any redesign:

- **All computation is in-browser**, through the WASM engine. No backend, no compute
  endpoint, no upload API — including in `moneypath serve`, which is a file server.
- **Nothing the user enters leaves their machine.** No network calls at runtime beyond
  the app's own assets. Uploaded configs are read locally. No telemetry, no analytics,
  no external fonts or CDNs.
- **Persistence is localStorage only**, and always optional to the engine: editor state
  under a versioned key, theme choice, optimizer toggle. Corrupt or version-mismatched
  state falls back to the starter config rather than failing. No cookies, no external
  storage.
- **It must work from any path prefix** with no configuration: relative URLs for every
  asset including the WASM binary. A host serves `index.html` for the deploy root and
  needs no rewrite rules — the app is a single page with no client-side routing, and no
  view needs to be deep-linkable (chapter 02, "Build artifacts").
- **Accessible by construction**: semantic roles, keyboard operability, `aria-*` on tabs,
  tooltips and status regions. This is a floor, not an aspiration.
- **Engine warnings never block a run.** Validation warnings are shown prominently;
  only hard config errors stop a forecast, and they surface inline without losing
  editor state.

## Capabilities

The app covers, at a coarse grain:

- A **config editor** — simulation settings, common events / loans / investments, and
  scenarios with their own events / loans / investments and per-event optimizer blocks.
  Every field carries a help affordance explaining its semantics; where a field has
  meaning defined in chapter 03, the help says what that chapter says.
- **Running forecasts**, with a busy indicator and errors that appear where the run was
  started, never by moving the reader somewhere else. The editor is long and a tweak is
  usually followed by a run, so the run action stays reachable from any scroll position
  rather than only from the top of the page.
- **Working with the optimizer** — one place to switch it on, to see how many events
  carry an optimizer directive, and to jump to each of them, so the switch is never
  blind. Editing is where a run is shaped and started; reading results is not.
  A run reports what the optimizer chose but never edits the plan itself: each adjustment
  is applied to the plan only when the reader asks, and the results say plainly that the
  plan still holds their own values until then. (The CLI's `--write-config` is the same
  step by another route.) Any download that would carry unapplied adjustments says so,
  so the plan on screen and the file that leaves the app never disagree in silence.
- **Results** — per-scenario summary (emergency fund, optimizer adjustments), a chart of
  liquid and total over time, and the full month-by-month table. The table initially
  shows Date, Liquid, and Total. Months with notes have an arrow and a disclosure
  button; clicking or tapping anywhere on that summary row, or activating its button
  with the keyboard, reveals the engine's notes as a list below it. Several months
  can stay open. Months without notes have no disclosure; switching scenarios or
  running a new forecast closes the details. CSV exports still contain all notes.
  Editing the config
  marks them as describing an earlier version of the plan; they stay readable, being the
  baseline the next run will be compared against.
- **Getting data in and out** — uploading a config (v2 directly, v1 auto-migrated with
  its notices shown), downloading the engine-serialized v2 YAML, and downloading the
  engine-rendered CSV, which is byte-for-byte what the CLI produces.
- **Resetting** to a built-in starter config, and a System / Light / Dark theme.

## Presentation

The interface uses warm paper surfaces, evergreen accents, and system serif headings
with sans-serif controls. On wide screens, each editor section has an introduction
beside its fields. This introduction stays pinned below the navigation bar while
its section scrolls, then leaves with the section. On smaller screens introductions
stack above the fields and scroll normally to preserve working space. A pinned
navigation and run bar stays reachable while the plan scrolls. Its jump links have
no active-section highlight; Previous/Next still follow the section on screen.
Introductions and jump targets allow for the bar's height as it wraps or shows errors. Results use the same palette, with distinct
liquid and total series and separate headings for the chart and monthly table.
System, Light, and Dark themes share this layout. All fonts and illustrations remain
local, with no additional runtime requests. The branching-path illustration is the
project logo; a simplified square version serves the masthead and favicons. On
desktop, the chart title sits inside its card, aligned with the summary card headings.

## User-facing text

The UI is a user-facing surface, so it follows the project's rules for one: no spec
paths, chapter numbers, or other internal references in anything a user can read, and
plain language in place of notation an average person would have to decode (AGENTS.md,
"User-facing text"). Field help may quote chapter 03's *meaning*; it may not cite
chapter 03.
