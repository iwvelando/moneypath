# moneypath — Specification

**moneypath** is a personal-finance scenario simulator: it reads a YAML plan describing
financial events, loans, and investments, then projects cash and net worth month by month
across one or more what-if scenarios. It ships as a single Go codebase built two ways —
a native CLI binary, and a WebAssembly module powering a fully static web app.

This spec is the record of **which behaviors are choices**. The code shows what the
simulator does — only the spec says whether a rule was deliberate and why it is that way.
Fixtures pin the numbers; these chapters pin the intent. That is what makes them worth
keeping current.

## How these chapters are maintained

Chapters do not all carry the same weight, and pretending they do is how a spec goes
stale. Each chapter states its status in its first line:

| Status | Rule | Chapters |
|---|---|---|
| **Contract** | The spec leads. Change it *before* the code, alongside the fixtures that pin the new behavior, and say so explicitly in the commit message. | 03, 04, and the sections of 02 marked normative |
| **Descriptive** | The code leads. Update the chapter in the same commit as the behavior change; tests are the enforcing contract. | 05, 06 |
| **Frozen** | Describes something that can no longer change. Edit only to correct an error. | 07 |
| **Reference** | Describes the fixtures and checks that exist today. | 08 |

The split follows the cost of being wrong. The config format is a contract with YAML files
users already have, and engine semantics are a contract with their money — a silent change
in either is a real loss, and both change rarely. The CLI and web surfaces iterate faster
than prose can follow and are pinned by tests instead, so a chapter that tried to describe
them precisely would mostly be a source of contradictions.

## Chapters

| Chapter | Status | Contents |
|---|---|---|
| [spec/01-product.md](spec/01-product.md) | Contract | What the tool is, who it's for, scope and non-goals |
| [spec/02-architecture.md](spec/02-architecture.md) | Mixed | One Go engine → CLI + WASM; static frontend; determinism and build-artifact rules |
| [spec/03-config-v2.md](spec/03-config-v2.md) | Contract | The v2 config format: every field, type, default, validation rule |
| [spec/04-engine-semantics.md](spec/04-engine-semantics.md) | Contract | **Normative** simulation rules: events, loans, investments, emergency fund, optimizer |
| [spec/05-cli.md](spec/05-cli.md) | Descriptive | Commands, flags, output formats, exit codes |
| [spec/06-web-ui.md](spec/06-web-ui.md) | Descriptive | What the static web app is for and the constraints it must keep |
| [spec/07-migration.md](spec/07-migration.md) | Frozen | The legacy (v1) format and the `migrate` command |
| [spec/08-conformance.md](spec/08-conformance.md) | Reference | The `testdata/` fixture formats and the checks that consume them |

Chapter 04 is the heart of the product. When prose and a conformance fixture disagree,
that is a spec bug to raise — not an ambiguity to resolve quietly in either direction.
MUST / MUST NOT / SHOULD / MAY are used in the RFC 2119 sense; anything not marked
normative is guidance.

Supporting material:

- `examples/example.yaml` — a fully commented v2 configuration exercising most features.
- `testdata/conformance/` — v2 configs with expected outputs; the engine MUST reproduce them.
- `testdata/migration/` — legacy configs with expected v2 translations (compared semantically).

For how to build, test, and change the project, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Ground rules

- Go for all calculation and CLI logic. The browser runs the same Go engine via WebAssembly —
  there is exactly one implementation of the finance math.
- The web app is a static site: no backend compute, no persistent storage, no network calls
  at runtime (beyond fetching its own static assets). The build MUST emit a standalone
  `dist/` tree that deploys by copying it to any static file host; the binary's embedded
  copy of `dist/` powers `moneypath serve` and never replaces producing the tree itself
  (chapter 02, "Build artifacts").
- Deterministic output: the same config produces byte-identical CSV everywhere.
