# Developing moneypath

## Prerequisites

- Go (see `go.mod` for the minimum version) — engine, CLI, WASM bridge.
- Node + npm — web app build and tests, and the CLI↔WASM parity test
  (which runs the wasm module under Node; it self-skips when `node` is absent).

## One-time setup

```sh
./scripts/dev-setup.sh
```

This does two things (both undoable; the script prints how):

1. Points `core.hooksPath` at the committed `.githooks/` directory.
2. Marks `internal/webembed/dist/index.html` with `git update-index
   --skip-worktree` so the local build overwrite (below) stops appearing in
   `git status`.

## Build pipeline

One source tree, two artifacts (spec/02-architecture.md, "Build artifacts"):

```sh
make wasm    # 1. engine → web/src/engine/moneypath.wasm (GOOS=js GOARCH=wasm)
make dist    # 2. Vite bundles the app with that wasm as a hashed asset → web/dist/,
             #    then copies web/dist/ over internal/webembed/dist/
make build   # 3. native binary embedding that same tree → bin/moneypath
```

`web/dist/` is the shippable static site — deploying is copying the tree to any
static file host; it works from any sub-path. `moneypath serve` is a local
convenience that serves the binary's embedded copy of the same tree.

CLI-only work needs no frontend toolchain: `go build ./cmd/moneypath` gives a
working binary (with a placeholder web app embedded).

## The embedded web tree

`internal/webembed/dist/` holds what `go:embed` bakes into the binary for
`moneypath serve`:

- The **committed** `index.html` there is a development placeholder, so `go
  build ./...` works without Node.
- `make dist` **overwrites it locally** with the real build; the rest of the
  built site — hashed assets, favicons — lands beside it but is gitignored
  (`.gitignore` ignores everything under that directory except `index.html`).
- The built `index.html` must never be committed: its asset references would
  dangle in a fresh checkout. The `.githooks/pre-commit` hook blocks it, and
  skip-worktree (via `dev-setup.sh`) hides the local modification. To change
  the placeholder itself deliberately: `ALLOW_EMBED_COMMIT=1 git commit ...`.
- Releases can't ship a stale or placeholder tree: `TestStaticBundle`
  (`conformance/bundle_test.go`) fails unless the embedded tree byte-matches
  `web/dist/`.

## Tests

```sh
make fmt       # gofmt -w . — after any Go edit, and before every commit
make fmt-check # non-mutating; lists anything still unformatted
make test-go   # Go units + conformance fixtures + CLI↔WASM parity + bundle check
make test-web  # frontend vitest suite
make test      # both
```

The tree is gofmt-clean and the pre-commit hook keeps it that way: it rejects
any staged Go file that isn't formatted, judging the staged content so a
partially staged file is checked by what you're actually committing. It skips
silently when Go isn't installed, so frontend-only work isn't blocked.
`make fmt-check` gives the same verdict for the whole tree without committing.

The project is developed test-first: `testdata/conformance/` and
`testdata/migration/` are wired into `go test` and are the acceptance gates.
New behavior gets a failing test first (red/green/refactor).

## Changing behavior

`SPEC.md` and `spec/` record *which behaviors are choices*, which is the one
thing the code can't tell you: `engine/` shows that escrow settles uniformly at
loan end, never that it was deliberate. Chapters therefore carry a **status** in their first line, and the
status decides the order of work (`SPEC.md`, "How these chapters are maintained"):

- **Contract** — chapters 03 (config format), 04 (engine semantics), and the
  normative sections of 02. These are promises: to YAML files users already have,
  and to their money. Edit the chapter *first*, then the fixtures that pin the new
  numbers, then the code, and say in the commit message that specified behavior
  changed.
- **Descriptive** — chapters 05 (CLI) and 06 (web UI). Write the code and its
  tests; update the chapter in the same commit if it now says something untrue.
  These surfaces iterate faster than prose can usefully follow.
- **Frozen** — chapter 07. The v1 format is dead and cannot change.

If a normative fixture fails, treat it as your bug first and a fixture bug second.
Editing a fixture is legitimate **only** as part of a deliberate Contract change,
never to make failing code pass; if you become convinced a fixture contradicts
chapters 03–05 as written, stop and raise it.

Anything a user can read — CLI output, error strings, UI copy, field help,
migration notices — follows the two rules in AGENTS.md, "User-facing text": no
internal references (spec paths, chapter numbers), and no notation the reader has
to decode.

## Layout

See the table in [README.md](README.md). The one architectural rule to keep
sacred: `engine/` stays pure (no I/O, no clock, no logging) and all finance
math stays in Go — the frontend only edits configs and renders results
(spec/02 boundaries; this is what guarantees CLI/WASM parity).
