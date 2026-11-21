# 06 — Web UI

*Status: **Descriptive** — this chapter states what the app is for and the constraints it
must never break. Interaction detail deliberately lives in the code and its vitest suite,
which move faster than prose can follow. See SPEC.md.*

## What it is

A single-page static app that is the interface to the engine: a structured
editor for a v2 config, and a reader for the results of running it. The user should be
able to plan without ever learning the YAML format, and to leave with the YAML if they
want it.

Anything it computes, it computes by calling
the engine — the frontend edits configs and renders results, and holds no finance math of
its own (chapter 02).

## Constraints (normative)

These are the properties that must survive any redesign:

- **All computation is in-browser**, through the WASM engine. No backend, no compute
  endpoint, no upload API.
- **Nothing the user enters leaves their machine.** No network calls at runtime beyond
  the app's own assets. Uploaded configs are read locally. No telemetry, no analytics,
  no external fonts or CDNs.
- **Persistence is localStorage only**, and always optional to the engine: editor state
  under a versioned key, theme choice, optimizer toggle. Corrupt or version-mismatched
  state falls back to the starter config rather than failing. A draft saved before a
  setting existed restores with that setting blank, not discarded; one saved before
  choices existed restores as a plan with none. No cookies, no external storage.
- **It must work from any path prefix** with no configuration: relative URLs for every
  asset including the WASM binary. A host serves `index.html` for the deploy root and
  needs no rewrite rules — the app is a single page with no client-side routing, and no
  view needs to be deep-linkable (chapter 02, "Build artifacts").
- **Accessible by construction**: semantic roles, keyboard operability, `aria-*` on tabs,
  tooltips and status regions. This is a floor, not an aspiration.
- **Engine warnings never block a run.** Only hard config errors stop a forecast, and
  they never cost the reader their editor state.
- **A problem is shown where it is, for as long as it is true.** The engine checks the
  plan on every edit (chapter 02, "Problems JSON"), and each error or warning appears
  under the field it is about. A warning is styled more quietly than an error and
  begins "Warning: ". An entry that is collapsed says when something inside it needs
  attention. Nothing typed is discarded or corrected in silence: text that is not a
  number stays in its field with its error. A failure that belongs to no field
  appears beside the control that started the action, added to the text there, never
  in place of it. Only what concerns the whole app is a page banner: an engine that
  did not load, a saved draft that could not be restored, a browser that is not saving
  the plan. There is no list of dismissable messages.

## Capabilities

The app covers, at a coarse grain:

- A **config editor** — simulation settings (including the interest rate cash earns
  and the plan's inflation rate),
  the baseline (the config's `common` events / loans / investments), choices with their
  options, and scenarios with their selections, their own events / loans / investments
  and per-event optimizer blocks. Existing entries appear as compact
  summaries and open into inline forms. Several entries can stay open, and each list
  offers Expand all / Collapse all. Adding or duplicating an entry opens it and focuses
  its name; jumping to an optimized event reveals its form. Collapsing an entry
  preserves its values; existing inline field errors are also signposted on the summary,
  including errors in nested schedules. Summaries describe configured values and
  schedules, never calculated payments or forecast returns. Loan terms, insurance, early
  payoff, and investment tax settings are grouped within the forms. Every field carries
  a help affordance explaining its semantics; where a field has meaning defined in
  chapter 03, the help says what that chapter says. A help opens on a brief of at most
  20 words saying what the field does. The rest, every assumption and limit the
  simulation applies, waits behind "Show more" in at most 80 words, and folds away
  again whenever the help closes. An open help lies over the form and moves no control
  beside it. A field asks a phone for the
  keyboard its value needs: the full one where a number may be negative, and for a
  month the number pad, with the field supplying the dash that pad lacks.
- **Growth** (chapter 03, "Growth") — every event amount (cash-flow events, extra
  principal payments, contributions and withdrawals by amount), a loan's escrow and a
  guardrail's floor has a "Growth" dropdown: "Stays the same" (the default, written by
  leaving the key out), "With inflation", or "At its own rate", which adds a "Yearly
  growth" field. A blank yearly rate is reported under that field and holds the run,
  since the plan has no way to carry it. The engine's problems with a growth appear
  under the rate when there is one and under the dropdown otherwise. A percentage
  withdrawal and a debt-free guardrail show the dropdown only when the plan already
  gives them a growth, so its warning has a place. A growth the editor cannot offer is
  shown as written with its error. A collapsed entry that grows says how ("With
  inflation", "4% a year"). The help for these fields and for the inflation rate
  states the assumptions: amounts in the start month's prices, a yearly step on the
  plan's anniversaries, and fixed amounts staying the same in nominal dollars; the
  help for each interest and return rate says it is nominal.
- **Guardrails** (chapter 03, "Guardrails") — a section of the plan's guardrails, after
  the simulation settings, each an entry like any other. A new guardrail is a cash
  floor with nothing else entered; its fields are its name, its kind ("Cash floor",
  "Debt-free" or "Investments last") and the optional start and end months it covers,
  whose help says to start a balance still being built from the month it is expected.
  A cash floor adds its floor, which may be negative. A debt-free names its start
  month "Debt-free from" and requires it, and lists the plan's loans as checkboxes,
  every loan when none is ticked. An investments-last lists the plan's investments as
  checkboxes, of which at least one must be ticked, and adds an optional "Never below"
  amount, empty for "never emptied". The checkboxes offer each loan or investment
  name written anywhere in the plan, once: in the baseline, an option's added entries
  or a scenario's own entries. A listed name the plan does not have stays ticked
  beside the others, with the engine's error under it, until it is unticked.
  An explicitly empty loan list from an uploaded plan keeps its error and offers
  "Use every loan" to remove the list, even when the plan has no loans to tick.
  Collapsed, a guardrail says what it checks and over which months. A kind the editor
  cannot offer, from an uploaded plan, is shown as written with the engine's error,
  and names or an amount its kind does not use are shown with their warning and a way
  to take them away; nothing is dropped in silence.
- **Choices** (chapter 03, "Choices") — each choice is a section holding its options.
  An option is an entry like any other: collapsed, it says what it adds, changes and
  removes and which scenarios pick it, so its reach is known before it is edited. Open,
  it holds the entries it adds (no optimizer on its events) and the baseline entries it
  changes or removes. A change is edited in the baseline entry's own form, filled with
  the values the entry has on that path: editing a field makes it part of the change,
  emptying one takes it away, each changed field is listed beside the baseline's value
  with a way back to it, and every field left alone follows the baseline. The entry's
  name is not editable there. Each scenario picks one option per choice from a
  dropdown, in choice order. The editor keeps a plan valid as it is built, in place of
  only reporting what the engine would refuse: a new choice starts with one option that
  changes nothing, selected by every scenario, so no forecast moves; a new scenario
  picks the first option of each choice and a duplicate keeps its picks; an option a
  scenario picks, or a choice's last option, cannot be removed; and the control that
  picks a baseline entry to change or remove is a search box over the baseline: typing
  part of a name narrows the list, which lets only entries the option may target be
  picked and names the reason beside the rest. Renaming a choice, an option or a targeted baseline
  entry keeps selections and targets intact. What the editor cannot make valid it keeps
  and flags, never drops or repairs: a target the baseline does not have stays under the
  name as written, and a scenario with no pick for a choice shows that dropdown unset.
- **Running forecasts**, with a busy indicator. A run asked for while the plan has
  errors is refused where it was started: the bar counts them and offers to go to the
  first, opening whatever holds it. The warnings of a run come with its results. The editor is long and a tweak is
  usually followed by a run, so the run action stays reachable from any scroll position
  rather than only from the top of the page.
- **Working with the optimizer** — one place to switch it on, to see which events
  carry an optimizer directive, and to jump to each of them, so the switch is never
  blind. Editing is where a run is shaped and started; reading results is not.
  A run reports what the optimizer chose but never edits the plan itself: each adjustment
  is applied to the plan only when the reader asks, and the results say plainly that the
  plan still holds their own values until then. Any download that would carry unapplied adjustments says so,
  so the plan on screen and the file that leaves the app never disagree in silence.
  An optimizer block's **Held to** select offers "Emergency fund", the default, which
  writes no key, and then each of the plan's guardrails by name. A name the plan no
  longer has stays selected, with the engine's error under the select, until the
  reader picks another. Each adjustment says what it was held to: against the
  emergency fund, `floor · min cash · headroom`; against a cash floor or a lasts,
  `held to <name> · floor · lowest cash` (or `lowest balance`) ` · headroom`; against a
  debt-free, `held to <name>` with the guardrail's own wording for when the debt clears.
- **Results** — per-scenario summary (emergency fund, optimizer adjustments), a chart of
  liquid and total over time, and the full month-by-month table. The table initially
  shows Date, Liquid, and Total. Months with notes have an arrow and a disclosure
  button; clicking or tapping anywhere on that summary row, or activating its button
  with the keyboard, reveals the engine's notes as a list below it. Several months
  can stay open. Months without notes have no disclosure; switching scenarios or
  running a new forecast closes the details. CSV exports still contain all notes.
  With two or more scenarios, a Compare entry follows the scenario tabs and draws every
  scenario on one chart, in the plan's order, for one series at a time: the total first,
  with a control to switch to liquid. Its vertical scale fits every scenario, including
  one whose cash goes negative. Its legend names each scenario and doubles as the month
  readout: it lists every scenario's value for the month under the pointer, a tap, or
  the keyboard cursor, and for the final month otherwise. A plan with one scenario has
  no Compare entry. An isolated recorded month is drawn as a point so a plan
  containing only one month remains visible. Under the chart, a table of key
  figures has one row per scenario, in the plan's order: the lowest cash and the month
  it is reached, cash and total at the end of the plan, and the emergency-fund
  shortfall or surplus. The emergency-fund column is left out when the recommendation
  is disabled, never shown as zero. When the plan has guardrails, a second table under
  the key figures has a row per scenario and a column per guardrail: whether it holds,
  the month it first breaks, its tightest month and the margin there, as an amount to
  spare or short, or for an investments-last without an amount as the amount left. A
  debt-free says instead the month it is debt-free from and the months to spare or
  late ("right on time" at none), and on a breach what is owed then, or that debt is
  still owed at the end of the window. "Does not apply" is said as such, never as
  holding. The wording follows the guardrails of the plan the results came from. A scenario's own
  view lists its guardrails the same way beside its emergency fund, and the flip panel
  shows the scenario's results and the flipped path's in one table. Nothing about a
  guardrail is computed in the app; it formats what the engine reported. A row leads to its scenario's own view: choosing
  the scenario's name, or anywhere on its row, selects that scenario's tab and moves
  focus to it. Under the key figures, the difference between two scenarios: two
  pickers choose one scenario and the scenario to subtract from it, starting with the
  plan's first two, and choosing the scenario the other picker holds swaps them, so a
  scenario is never compared with itself. For the total and for liquid it lists the
  break-even months, each with the scenario that moves ahead, or says that the lead
  never changes hands; a chart draws both differences over time with the same month
  readout as a scenario's own chart, tinting the months a difference is below zero.
  The comparison shows only figures the engine reported.
  When the plan has choices, a scenario's own view also offers to flip one of them:
  pick a choice and another of its options, and the engine compares the scenario with
  that one decision made differently and everything else as it is (chapter 02, Results
  JSON, `flip`). It shows the break-even months and the difference over time, as the
  comparison of two scenarios does. This works for a plan with one scenario, is left
  out when no choice has another option to switch to, and describes the plan as it was
  run even after the editor has moved on. Reading it changes nothing. The flipped path
  enters the plan only when the reader keeps it, as a copy of the scenario placed after
  it with that one selection changed and a name no other scenario has.
  Keeping requires the plan to be unchanged since the forecast. After an edit, it is
  refused with an explanation beside the Keep button to run the forecast again, while
  the earlier comparison remains readable. The refusal is announced as an alert.
  When the plan has guardrails, a scenario's own view also asks for the **earliest
  month** an event or a loan of its path can take (chapter 04 §11): pick what to move
  (an event's start or end, a one-off event as a whole, or a loan's start, grouped by
  where the entry comes from), the first and last months to try, and the guardrails that
  must hold, those that apply to the scenario ticked at first. The range starts as the
  whole plan, short of the month the entry keeps: a start can move no later than its
  end, an end no earlier than its start. The engine answers with the earliest month
  and the month the plan has; the guardrails that break a month earlier, worded as the
  Guardrails table words them, or that the range's first month already works; every
  stretch of months that works; and each guardrail's months. When no month works it
  says so, and the guardrails' months show why. A question the engine refuses is
  explained beside the button that asked it. Like the flip, it describes the plan as it
  was run, works for a plan with one scenario, is left out when the path has nothing
  to move, and changes nothing in the plan.
  Editing the config
  marks all of these as describing an earlier version of the plan; they stay readable,
  being the baseline the next run will be compared against.
- **Getting data in and out** — uploading a version 2 config (choices and
  selections are kept; a file with no `version` field or in the older finance-forecast
  format is refused with an explanation), downloading the engine-serialized
  v2 YAML, and downloading the engine-rendered CSV (chapter 05).
- **Resetting** to a built-in starter config, and a System / Light / Dark theme.

## Presentation

The interface uses warm paper surfaces, evergreen accents, and system serif headings
with sans-serif controls. On wide screens, each editor section has an introduction
beside its fields. This introduction stays pinned below the navigation bar while
its section scrolls, then leaves with the section. On smaller screens introductions
stack above the fields and scroll normally to preserve working space. A pinned
navigation and run bar stays reachable while the plan scrolls. A “Jump to section”
dropdown includes Simulation, Guardrails, Baseline, Choices, and Scenarios, with individual choices
nested beneath Choices and individual scenarios beneath Scenarios. The destinations have no active-section highlight. An optimizer
status button shows only On or Off and opens its enable switch and event jump list, or setup guidance when the list
is empty. Only one panel opens at a time; Escape closes it and returns focus to its trigger.
Run Forecast remains directly accessible, including while either panel is open.
Introductions and jump targets allow for the bar's height as it wraps or shows errors. Results use the same palette, with distinct
liquid and total series and separate headings for the chart and monthly table. In the
comparison each scenario's line has its own color and its own dash pattern, so lines
stay distinguishable in both themes and without relying on color, and the same line
marks its row in the key figures. That table stays a table to assistive technology at
every width; on a phone its rows stack, each figure under its column's name, so nothing
scrolls sideways. The scenario tabs
stay on one row that scrolls sideways within the page when there are more than fit,
on any screen width, and choosing a tab brings it fully into view.
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
