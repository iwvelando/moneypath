# moneypath roadmap

moneypath exists to think through financial decisions: what constrains them, when they
become possible, and what could go wrong. This document records the accepted direction
for making the tool better at that. It is a design horizon, not a status log. Current
scope, readiness, decisions and delivery belong in the linked issues; specified behavior
belongs in [SPEC.md](SPEC.md) and `spec/`. [DEVELOPMENT.md](DEVELOPMENT.md), "Roadmap
assignments", governs how the work is prepared and delivered.

## The idea underneath

The engine already holds the roadmap's core in miniature: one constraint (cash stays
above the emergency-fund target) and a solver that finds the boundary value of one
input. Generalized, that pair answers each question the tool is for:

- **Constraints**: any guardrail the user names, checked on every path.
- **Timing**: solve for a date, giving the earliest month a choice holds.
- **Risk**: solve for an assumption, giving how far it can move before a guardrail
  breaks.

Decisions are then compared by their margins as well as their ending balances.

## What the baseline lacks

| Concern | Today | Feature |
|---|---|---|
| Decisions | Scenarios are read one at a time; nothing states the difference between two. | [R01](https://github.com/iwvelando/moneypath/issues/31) |
| Decisions | A new path is a duplicated scenario, kept in step by hand. | [R02](https://github.com/iwvelando/moneypath/issues/35), [R03](https://github.com/iwvelando/moneypath/issues/39) |
| Constraints | One built-in constraint, the emergency-fund floor. | [R04](https://github.com/iwvelando/moneypath/issues/41), [R05](https://github.com/iwvelando/moneypath/issues/45) |
| Timing | Reachable only by pointing the optimizer at a date. | [R06](https://github.com/iwvelando/moneypath/issues/47) |
| Model | Decades of nominal dollars and flat amounts. | [R07](https://github.com/iwvelando/moneypath/issues/49) |
| Model | Total is cash plus investments; debts and property are not counted. | [R08](https://github.com/iwvelando/moneypath/issues/53) |
| Risk | Modeled only by hand-written alternative scenarios. | [R09](https://github.com/iwvelando/moneypath/issues/57), [R10](https://github.com/iwvelando/moneypath/issues/60), [R11](https://github.com/iwvelando/moneypath/issues/62) |

## Principles and limits

- **Built for its owner's decisions.** Analytical power comes before onboarding. Guided
  setup and decision templates are not on this roadmap.
- **Deterministic.** The same plan always produces the same numbers. Risk is examined
  with named shocks and breaking points, never with random draws. Monte Carlo stays out
  of scope.
- **A planner, not a tracker.** The plan describes the future from today's position. No
  history, no actuals, no account linking.
- **One engine.** Every figure a user reads is computed in Go and reaches the
  web app through the engine. The frontend edits plans and renders results.
- **Existing plans keep their numbers.** A plan that uses none of a new feature produces
  the output it does today. New figures arrive as new series or fields beside the
  existing ones; liquid and total keep their meaning.
- **Format decisions come first.** A feature that changes the plan format or an engine
  rule begins with a research slice and an owner decision, and the spec chapter changes
  before the code.
- **Static and private.** No backend, no telemetry, nothing leaving the browser.

Also out of scope: tax-bracket modeling, multiple currencies, accounts and server-side
storage.

## Delivery waves

The waves group effort and design maturity. They carry no dates, and their order guides
scheduling without blocking: a later slice can start once its own design and actual
prerequisites are satisfied. Blocked-by relationships on the issues mark the real
prerequisites.

### Wave A — Compare paths

[Milestone](https://github.com/iwvelando/moneypath/milestone/1). Reporting over figures
the engine already produces; the plan format does not change.

**[R01](https://github.com/iwvelando/moneypath/issues/31) — Compare scenarios side by
side.** Every scenario on one chart, a table of the figures a decision turns on (lowest
cash and when, where each path ends), and the difference between two paths with the
month one overtakes the other.

### Wave B — Branch without copying

[Milestone](https://github.com/iwvelando/moneypath/milestone/2). Changes what a scenario
is, so it comes before the features that attach to scenarios.

**[R02](https://github.com/iwvelando/moneypath/issues/35) — Choices: scenarios as
selections, not copies.** A baseline true on every path, named choices with options
(keep the house, sell and rent), and scenarios that pick one option per choice. A new
path is one flipped option, and an option is edited once. Existing plans map over with
`common` as the baseline.

**[R03](https://github.com/iwvelando/moneypath/issues/39) — What one choice costs.**
Flip a single choice with everything else held fixed and read the difference.

### Wave C — Guardrails and timing

[Milestone](https://github.com/iwvelando/moneypath/milestone/3). Generalizes the
emergency-fund floor.

**[R04](https://github.com/iwvelando/moneypath/issues/41) — Guardrails.** Constraints
the user names (cash never below an amount, debt-free by a month, a balance that
lasts), with each scenario reporting pass or fail, the first breach and the tightest
month.

**[R05](https://github.com/iwvelando/moneypath/issues/45) — Solve against any
guardrail.** The optimizer holds a plan to whichever guardrail is chosen.

**[R06](https://github.com/iwvelando/moneypath/issues/47) — Earliest month this
works.** A direct answer, with the constraint that decides it.

### Wave D — A truer model

[Milestone](https://github.com/iwvelando/moneypath/milestone/4). Two Contract changes
to what the numbers mean.

**[R07](https://github.com/iwvelando/moneypath/issues/49) — Real dollars and growth.**
A plan-wide inflation rate, growth per event, and results readable in today's dollars.
Lifts the "inflation modeling" non-goal in `spec/01-product.md` when it is delivered.

**[R08](https://github.com/iwvelando/moneypath/issues/53) — Balance sheet.** Loan
balances as liabilities, assets with their own value and appreciation, and net worth
and equity as series beside liquid and total.

### Wave E — Stress and sensitivity

[Milestone](https://github.com/iwvelando/moneypath/milestone/5). Built on choices,
guardrails and the truer model.

**[R09](https://github.com/iwvelando/moneypath/issues/57) — Named shocks.** Income
stops, the market falls, a cost spikes or a rate rises, laid over any scenario and
reported as which guardrails break and when.

**[R10](https://github.com/iwvelando/moneypath/issues/60) — Breaking points.** How far
each assumption can move before a guardrail fails.

**[R11](https://github.com/iwvelando/moneypath/issues/62) — Worst-timing sweep.** The
month in which a given shock would hurt most.

## Assignment map and maintenance

The slices specified against the current code are
[R01.1](https://github.com/iwvelando/moneypath/issues/32) and
[R01.2](https://github.com/iwvelando/moneypath/issues/33), which are independent. Each
format decision has a research slice that can be taken up ahead of its wave:
[R02.1](https://github.com/iwvelando/moneypath/issues/36),
[R04.1](https://github.com/iwvelando/moneypath/issues/42),
[R07.1](https://github.com/iwvelando/moneypath/issues/50) and
[R08.1](https://github.com/iwvelando/moneypath/issues/54). This names the intended
starting points; consult each issue's live readiness and prerequisites before assigning
it.

Later slices are outlines. Specify each against the code that exists when its
prerequisites have merged, and have it name the exact capability it consumes and
exposes.

The milestones and issues are the delivery record, including scope changes, research
decisions and follow-ups. This document changes when the direction changes.
