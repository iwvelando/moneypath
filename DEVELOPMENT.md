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
make dist    # 2. writes license notices into web/public/, Vite bundles the app with
             #    that wasm as a hashed asset → web/dist/, scripts/check-dist.mjs
             #    confirms the tree is complete, then web/dist/ is copied over
             #    internal/webembed/dist/
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

### Browser tests

`web/e2e/` holds Playwright tests that run against `vite preview` of the production
build, under the production Content-Security-Policy. They check that the real engine
loads, that a forecast and both downloads work, that storage denial is survivable,
that no view scrolls sideways at 360 px, and the link-preview tags.

```sh
cd web && npx playwright install chromium webkit   # once
make test-browser  # Chromium, plus a 360 px phone project for layout.spec.ts
make test-webkit   # Safari's engine on an iPhone profile (webkit.spec.ts)
```

Tests wait for `<html data-engine="ready">`, which the app sets once the engine
answers (`failed` if it can't load). Tests tagged `@smoke` must stay fast and
read-only: CI runs them against the live site after every deploy, with `BASE_URL`
set.

Playwright reuses a server already listening on port 4173 outside CI. A leftover
`vite preview` from another project will quietly serve the wrong app, so check
`lsof -nP -iTCP:4173 -sTCP:LISTEN` when results make no sense.

### Distribution files

- `make notices` (part of `make dist`) writes `LICENSE.txt`, `GO-LICENSE.txt`, and
  `THIRD-PARTY-NOTICES.txt` into `web/public/`, and they're gitignored there. The
  published engine is the Go runtime plus every Go module it imports, so those
  licenses ship with the site alongside the npm runtime dependencies'.
- `web/public/og-image.png` (the link-preview card) is committed. `make share-card`
  re-renders it from the built site; check it by eye before committing.
  `web/scripts/make-favicons.sh` does the same for the icons.

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
