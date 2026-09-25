# 01 — Product

*Status: **Contract** — see SPEC.md, "How these chapters are maintained".*

## Purpose

moneypath helps a person make financial decisions by simulating how their money evolves
over time under different choices. The user describes their financial life in a YAML
config — recurring income and expenses ("events"), loans, and investment accounts — and
groups alternative futures into **scenarios** (e.g. "keep the house" vs. "sell and move").
The simulator steps month by month from a start date to an end date and reports, for each
scenario, the **liquid** balance (cash) and **total** net worth (cash + investments) at
every month, plus notes about notable happenings (loan payoffs, withdrawals, etc.).

The more faithfully the user describes their events, the more useful the projection. The
tool is a deterministic best-guess guide, not a Monte Carlo engine or a financial-advice
product: given the same config it always produces the same numbers.

Supplementary analyses:

- **Emergency-fund recommendation** — compares starting cash against a target of N months
  of average expenses.
- **Optimizer** — adjusts a single marked field of an event (amount, frequency, start or
  end date) to find the smallest adjustment that keeps cash above the emergency-fund floor.

## Users and delivery

One user class: an individual comfortable editing YAML or using the bundled web editor.
Two front doors, same engine:

1. **CLI** (`moneypath`) — reads a config file, prints results as a pretty table or CSV.
2. **Web app** — a static single-page app with a structured config editor, an interactive
   chart, a results table, and CSV/config downloads. All computation happens **in the
   browser** via the Go engine compiled to WebAssembly. Nothing the user enters ever
   leaves their machine.

## Scope

In scope:

- Everything in chapters 03–07: config v2, full engine semantics, CLI, web UI, migration
  from the legacy format.
- `moneypath serve`: a convenience subcommand that serves the embedded static web app
  locally. It hosts files only — it MUST NOT expose any computation or upload API.

Out of scope (design must not preclude them, but build none of them):

- Cloud hosting, CDN setup, IaC, CI/CD pipelines.
- Accounts, authentication, server-side persistence, telemetry.
- Multi-currency, inflation modeling, Monte Carlo simulation, tax-bracket modeling.

## Why the architecture looks like this

Running forecast computation on a server couples cost and scale to user traffic the
moment the app is exposed publicly. These calculations are small (a few thousand
floating-point operations per scenario) and belong on the client. moneypath is therefore
shaped so the entire web experience can someday be served from a static bucket + CDN for
pennies: static assets, client-side compute, zero backend. Local use is the current
target, but nothing in the design may reintroduce a compute backend.
