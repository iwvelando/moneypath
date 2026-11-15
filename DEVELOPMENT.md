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

## Trying it on a phone

```sh
make preview-lan              # builds, then serves web/dist/ on port 4180
make preview-lan PREVIEW_PORT=4181
```

It serves the production build, under the production Content-Security-Policy, to
anything that can reach your machine, so use it only on a network you trust. Open the
`https://` Network address it prints from a phone on the same network. The certificate
is self-signed, so the phone warns once before opening the page. HTTPS matters: a
plain-HTTP address other than localhost is not a secure context, which the live site
always is, and Safari runs WebAssembly several times slower without one.

The port stays clear of 4173, which the browser tests use, so a preview can stay up
while they run. Stop it with Ctrl-C when the phone check is done.

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
make check     # fmt-check, vet, the production build, then both suites
make pre-pr    # check, then the full Chromium and WebKit browser suites
```

`make pre-pr` is the local gate for a pull request: it runs what CI's `check` and
`webkit` jobs run, on one build. Run it once, on the final changes (see "Delivering a
change"). It needs the Playwright browsers installed (below).

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
- `web/public/robots.txt` and `web/public/sitemap.xml` are committed and name the
  public host's absolute URLs, like the link-preview tags. The sitemap lists the
  one page there is; `e2e/crawl.spec.ts` holds it to the canonical URL in
  `index.html`.

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

## Delivering a change

These steps apply to every implementer and reviewer, whichever agent or session.
AGENTS.md states them as rules; this is the detail.

### Iterate, then let the owner explore

During development and owner feedback, targeted checks are the default: the failing
test first, the tests for the paths touched, a rebuilt production build when a browser
check needs one. `make pre-pr` is not run between feedback iterations.

For a new feature, or any change a user can see or feel in the web app, there is a
checkpoint before the full run. It comes when the scope is implemented, the targeted
checks are green and the documentation is written:

1. Walk through the change yourself first: enter it, edit, run a forecast, download,
   reload, and come back. Check a short desktop window and a 360 px phone layout,
   keyboard focus, and the error and empty states. Say which of these were simulated
   and which were on a real device.
2. Run `make preview-lan` and give the owner the `https://` Network address it prints,
   with the revision or working-tree state it serves. This goes in private chat, never
   in an issue or PR.
3. List what to try: the central interaction, the limits and refusals, edge cases
   already tested, and anything rough or only checkable on a phone.
4. Wait for the go-ahead. Fix each finding with its own failing test first, and offer
   the checkpoint again after a substantial change.

The checkpoint is a gate unless the owner waives it for the task, or the work is
unattended (a cloud or scheduled agent), in which case the handoff records that the
exploration is still owed. It replaces neither phone checks nor review. When feedback
exposes a class of problem, such as one clipped control, check the related controls
and the shared cause before offering another preview.

### Final verification and the PR

After the checkpoint, run `make pre-pr` once on the final changes. A change made after
that run needs it again, except a change only to Markdown. If the run fails on a test
the change did not touch, see "Recording failures and bugs" before rerunning.

Then push and open the PR. Its description holds the final behavior, the design
choices worth knowing, and one verification section: the revision tested, the commands
actually run and their results, what is still pending and who owns it. Phone checks
are listed there as pending until someone has done them on a device. CI is reported as
pending; the reviewer reads it. A Contract change says so, as "Changing behavior"
requires.

Opening a PR, or being named its reviewer, does not authorize merging it. Merging to
`main` deploys.

### Public records and handoffs

Issues, PRs and their comments are read by other contributors. They identify work by
branch, commit and repository-relative path, with portable commands. They do not carry
local preview addresses, absolute paths, session details or quotations from private
chat; a decision the owner made is summarized in your own words.

A handoff to another session names the branch, the revision, and any uncommitted work
that must be preserved. The incoming session starts its own servers, so the outgoing
one stops the previews and dev servers it started and confirms they are gone. A
preview stays up while the owner is still exploring it.

Working notes for one PR (review reports, validation guides, handoff drafts) are not
committed. Keep them outside the repository or under `.codex/`, which is ignored.

### Recording failures and bugs

One failure has one issue, and that issue is its count. This covers every failure the
change under test did not cause, in CI or locally, including one that passes when
rerun. A failure the change caused is fixed in that PR and needs no issue.

1. Search before rerunning, open and closed issues both:
   `gh issue list --state all --search '"<test name>"'`.
2. Record the occurrence as one line on the issue that covers it, reopening it if it
   was closed: the date, the run and job (or "local"), the test, and the first line of
   the error. If no issue covers it, open one from the **Intermittent failure**
   template.
3. Then rerun, and write only `Reran for #<issue>` in the PR.
4. At the second occurrence in a week, or the third in all, say so in the handoff so
   the owner can decide whether it is fixed next.

Do not add a retry or lengthen a wait to get past a failure whose cause is unknown. A
bug noticed outside the change follows the same rule: fix it in the current PR, test
first, when it is small and belongs there; otherwise open an issue from the **Bug**
template and link it.

### Prompts for the owner

These start the three stages. The procedures above and [REVIEWING.md](REVIEWING.md)
supply the detail, so the prompts need not repeat it.

> Implement [task or issue] following the repository delivery procedure. Stop at the
> exploration checkpoint.

> Exploration approved. Complete final verification, open the PR and leave the
> handoff. Stop there; do not merge.

> Use the repository's moneypath-review procedure to take over [PR]. You may fix and
> push warranted changes. Once review and required verification are complete and CI
> passes on the final head, merge and confirm the deployment.

For a review without merge authority, end the last prompt with "hand the PR back
without merging" instead.

## Layout

See the table in [README.md](README.md). The one architectural rule to keep
sacred: `engine/` stays pure (no I/O, no clock, no logging) and all finance
math stays in Go — the frontend only edits configs and renders results
(spec/02 boundaries; this is what guarantees CLI/WASM parity).
