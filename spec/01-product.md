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
Cash can earn interest at one plan-wide rate — 0% by default, the worst case of a
non-interest-bearing account, or higher to model a high-yield savings account. Amounts
are written in the start month's prices, and each can stay fixed, grow with one
plan-wide inflation rate or grow at its own yearly rate, so a plan that runs for decades
can let income and costs rise. With an inflation rate set, the results can also be read
in today's dollars, the start month's prices.

The more faithfully the user describes their events, the more useful the projection. The
tool is a deterministic best-guess guide, not a Monte Carlo engine or a financial-advice
product: given the same config it always produces the same numbers.

Supplementary analyses:

- **Emergency-fund recommendation** — compares starting cash against a target of N months
  of average expenses.
- **Optimizer** — adjusts a single marked field of an event (amount, frequency, start or
  end date) to find the smallest adjustment that keeps cash above the emergency-fund floor.

## Users and delivery

One user class: an individual planning their own finances. One front door: the **web
app**, a static single-page app with a structured config editor, an interactive chart, a
results table, and CSV/config downloads. All computation happens **in the browser** via
the Go engine compiled to WebAssembly. Nothing the user enters ever leaves their machine.
The plan can be downloaded as a YAML file and uploaded again; the file is the user's copy
of their plan, and a person comfortable with YAML may edit it by hand.

## Scope

In scope:

- Everything in chapters 03–06: config v2, full engine semantics, the CSV download, the
  web UI.
- **One public deployment**, at `moneypath.isaacvelando.com`: CI in this repository
  verifies every change and publishes `dist/` on each merge to `main`, by copying the tree
  to a static bucket behind a CDN and nothing more. The hosting itself (bucket, CDN,
  certificate, DNS, the deploy role) is infrastructure-as-code in a separate repository,
  `iwvelando/cloud-accounts`; this one holds no IaC.

Out of scope (design must not preclude them, but build none of them):

- Accounts, authentication, server-side persistence, telemetry.
- A command-line tool, and conversion of plans written for finance-forecast, the tool
  moneypath succeeds. A file in that format is refused with a plain explanation.
- Multi-currency, Monte Carlo simulation, tax-bracket modeling, an inflation rate that
  varies by year.

## Why the architecture looks like this

Running forecast computation on a server couples cost and scale to user traffic the
moment the app is exposed publicly. These calculations are small (a few thousand
floating-point operations per scenario) and belong on the client. moneypath is therefore
shaped so the entire web experience can someday be served from a static bucket + CDN for
pennies: static assets, client-side compute, zero backend. That is how the public site
is served, and nothing in the design may reintroduce a compute backend.
