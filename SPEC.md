# moneypath — Implementation Specification

**moneypath** is a personal-finance scenario simulator: it reads a YAML plan describing
financial events, loans, and investments, then projects cash and net worth month by month
across one or more what-if scenarios. It ships as a single Go codebase built two ways —
a native CLI binary, and a WebAssembly module powering a fully static web app.

This repository currently contains only this specification and its test fixtures.
**Your task is to implement moneypath from this spec.** The spec is self-contained and
normative; you do not need (and must not assume) access to any prior codebase.

## How to read this spec

Read the chapters in order. Chapter 04 (engine semantics) is the heart of the product —
implement it exactly. The words MUST / MUST NOT / SHOULD / MAY are used in the RFC 2119
sense. Anything not marked normative is guidance and you may exercise judgment.

| Chapter | Contents |
|---|---|
| [spec/01-product.md](spec/01-product.md) | What the tool is, who it's for, v1 scope and non-goals |
| [spec/02-architecture.md](spec/02-architecture.md) | One Go engine → CLI + WASM; static frontend; determinism rules |
| [spec/03-config-v2.md](spec/03-config-v2.md) | The v2 config format: every field, type, default, validation rule |
| [spec/04-engine-semantics.md](spec/04-engine-semantics.md) | **Normative** simulation rules: events, loans, investments, emergency fund, optimizer |
| [spec/05-cli.md](spec/05-cli.md) | Commands, flags, output formats, exit codes |
| [spec/06-web-ui.md](spec/06-web-ui.md) | The static web app: editor, chart, results, persistence |
| [spec/07-migration.md](spec/07-migration.md) | The legacy (v1) format and the `migrate` command |
| [spec/08-conformance.md](spec/08-conformance.md) | How to use `testdata/` and the required development workflow |

Supporting material:

- `examples/example.yaml` — a fully commented v2 configuration exercising most features.
- `testdata/conformance/` — v2 configs with expected outputs. Your engine MUST reproduce these.
- `testdata/migration/` — legacy configs with expected v2 translations. Your `migrate` command MUST reproduce these (semantically — see chapter 08).

## Development workflow expectations

Work test-first (red/green/refactor): the fixtures in `testdata/` are your initial failing
tests. Wire them into `go test` early, before writing engine code. Chapter 08 defines the
required conformance checks, including CLI↔WASM output parity.

## Ground rules

- Go for all calculation and CLI logic. The browser runs the same Go engine via WebAssembly —
  there is exactly one implementation of the finance math.
- The web app is a static site: no backend compute, no persistent storage, no network calls
  at runtime (beyond fetching its own static assets). It must be deployable by copying
  `dist/` to any static file host.
- Deterministic output: the same config produces byte-identical CSV everywhere.
