# Developing moneypath

## Prerequisites

- Go (see `go.mod` for the minimum version) — engine and WASM bridge.
- Node + npm — web app build and tests, and the native↔WASM parity test
  (which runs the wasm module under Node; it self-skips when `node` is absent).

## One-time setup

```sh
make dev-setup
```

This points `core.hooksPath` at the committed `.githooks/` directory. Undo it with
`git config --unset core.hooksPath`.

## Build pipeline

One source tree, one artifact (spec/02-architecture.md, "Build artifacts"):

```sh
make wasm    # 1. engine → web/src/engine/moneypath.wasm (GOOS=js GOARCH=wasm), and
             #    the toolchain's wasm_exec.js → web/src/vendor/
make dist    # 2. writes license notices into web/public/, Vite bundles the app with
             #    that wasm as a hashed asset → web/dist/, and scripts/check-dist.mjs
             #    confirms the tree is complete
```

`web/dist/` is the shippable static site — deploying is copying the tree to any
static file host; it works from any sub-path.

Go's glue, `wasm_exec.js`, runs the wasm and only works with the compiler that built
it. `make wasm` copies it from that toolchain; both files are gitignored. For the
dev server, run `make wasm` and then `npm run dev` in `web/`.

The frontend unit tests run the real engine: `web/src/test/setup.ts` answers the app's
request for the wasm from the build on disk. `make test-web` rebuilds the engine first.
`npm test` and `npm run dev` in `web/` build it only when it is missing
(`web/scripts/ensure-wasm.mjs`), so run `make wasm` after editing Go.

Engine work needs no frontend toolchain: `go test ./...` runs the units and the
conformance fixtures natively.

## Trying it on a phone

```sh
make preview-lan              # builds, then serves web/dist/ on port 4180
make preview-lan PREVIEW_PORT=4190
```

It serves the production build, under the production Content-Security-Policy, to
anything that can reach your machine, so use it only on a network you trust. Open the
`https://` Network address it prints from a phone on the same network. The certificate
is self-signed, so the phone warns once before opening the page. HTTPS matters: a
plain-HTTP address other than localhost is not a secure context, which the live site
always is, and Safari runs WebAssembly several times slower without one.

The port stays clear of 4181, which the browser tests use, so a preview can stay up
while they run. Stop it with Ctrl-C when the phone check is done.

## Tests

```sh
make fmt       # gofmt -w . — after any Go edit, and before every commit
make fmt-check # non-mutating; lists anything still unformatted
make test-go   # Go units + conformance fixtures + native↔WASM parity + bundle check
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

The browser tests serve the build on port 4181, not Vite's default of 4173, so they
can run beside another project's tests on the same machine. `E2E_PORT` moves it, for
two checkouts of this repository testing at once: `E2E_PORT=4191 make test-browser`.
Playwright reuses a server already listening on that port outside CI. A leftover
`vite preview` will quietly serve a stale or different build, so check
`lsof -nP -iTCP:4181 -sTCP:LISTEN` when results make no sense.

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

The project is developed test-first: `testdata/conformance/` is wired into
`go test` and is the acceptance gate.
New behavior gets a failing test first (red/green/refactor).

## Changing behavior

`SPEC.md` and `spec/` record *which behaviors are choices*, which is the one
thing the code can't tell you: `engine/` shows that escrow settles uniformly at
loan end, never that it was deliberate. Chapters therefore carry a **status** in their first line, and the
status decides the order of work (`SPEC.md`, "How these chapters are maintained"):

- **Contract** — chapters 01 (product), 03 (config format), 04 (engine semantics),
  05 (the CSV download), and the normative sections of 02. These are promises: to YAML files users already have,
  and to their money. Edit the chapter *first*, then the fixtures that pin the new
  numbers, then the code, and say in the commit message that specified behavior
  changed.
- **Descriptive** — chapter 06 (web UI). Write the code and its
  tests; update the chapter in the same commit if it now says something untrue.
  This surface iterates faster than prose can usefully follow.

If a normative fixture fails, treat it as your bug first and a fixture bug second.
Editing a fixture is legitimate **only** as part of a deliberate Contract change,
never to make failing code pass; if you become convinced a fixture contradicts
chapters 03–05 as written, stop and raise it.

Anything a user can read — error strings, UI copy, field help — follows the two rules in AGENTS.md, "User-facing text": no
internal references (spec paths, chapter numbers), and no notation the reader has
to decode.

## Errors, warnings and messages

The rules are in AGENTS.md under the same heading. How they are built:

- **The engine reports problems, not a string.** `config.Check` gathers every rule a
  plan breaks and every warning as a `config.Problem`: a level, the path of the field
  in the config document (`common.loans.0.term`), that place in words, and one
  sentence (`spec/02`, "Problems JSON"). `moneypathValidate` returns them without
  running anything, and the app calls it on every edit (`App.tsx`).
- **A form says where it is, a field adds its key.** `At` (`web/src/components/problems.tsx`)
  sets the path of the form inside it, the same path the engine uses: list entries by
  position, an option's change under `change.<kind>.<n>.set`. Each field component
  takes `field="term"` and shows the problems at that path under itself. A problem
  with an entry or a list as a whole has a `PathProblems` there.
- **The entry and the run bar follow from the same list.** A collapsed entry shows
  "Check details" when any error is inside its path. A refused run counts the errors
  in the pinned bar and leads to the first; an error no control claims is written out
  there in full, which is the safety net and should stay empty.

### Adding a validation rule

1. Edit `spec/03-config-v2.md` first; it is a Contract chapter.
2. Add a case to `TestProblemsNameTheirField` (or `TestChoiceProblemsNameTheirField`)
   in `config/problem_test.go` with the path, the place in words and the sentence, and
   break the rule in one of the plans of `TestProblemTextIsPlain`.
3. Pin it in `testdata/problems/`: add the broken value to a case's `config.yaml` and
   write the problem into its `expected.yaml` by hand, or add a case. This is the
   fixture that lands with the chapter edit.
4. Report it from `config/` with `c.fail(path, …)` or `c.warn(path, …)`. The sentence
   names the field by its label in the app, states the rule in plain words, and ends
   with a full stop. The place is worked out from the path; do not write it into the
   sentence.
5. If the field is new to the editor, give its control `field=` and add the broken
   value to the plan in `App.test.tsx`, "places every error the editor can produce
   under a control".
6. Field help states the same limit the engine enforces (`web/src/config/help.ts`).

### Adding a message that is not about a field

Put it beside the control that started the action: the run bar for a run, the toolbar
line for upload, download and reset, the flip panel for a flip or a keep. Use
`role="alert"` for a failure and `role="status"` for a confirmation, and keep the text
that was already there. A failure is cleared by the next attempt or the next edit, not
by a dismiss button.

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

## Roadmap assignments

[ROADMAP.md](ROADMAP.md) holds the accepted direction; GitHub issues hold the work.
This section applies to any assignment tracked in an issue. It adds to "Changing
behavior" and "Delivering a change" above; a ready issue waives neither.

### Where information lives

| Information | Home |
|---|---|
| Accepted motivation, principles, scope limits and the reason for each wave | `ROADMAP.md` |
| A feature's agreed outcome and acceptance criteria | Its parent issue |
| One implementation or research assignment | A sub-issue |
| Readiness, active work and prerequisites | Labels, native sub-issue and blocked-by relationships |
| Specified config format, engine rules and web behavior | `spec/`, the fixtures and the tests |
| What a change did and how it was verified | The PR |
| Discussion, experiments and superseded decisions | Issue and PR comments |

`ROADMAP.md` is not a status log. Amend it only when the direction changes. An issue
body states the current assignment as a whole; a comment explains each material edit to
it. A settled format or engine rule moves into its spec chapter in the PR that
implements it, so nobody has to rebuild a contract from a comment thread. If shipped
behavior disagrees with the accepted requirement, report it; do not quietly redefine
either one.

### Waves, features and slices

- A **wave** is a milestone grouping features that mature together. It has no dates,
  and its order is scheduling guidance, not a dependency.
- A **feature** is a parent issue titled with its roadmap identifier, such as
  `[R04] Guardrails`. It is the acceptance record, and it is not ordinarily assigned
  whole.
- A **slice** is a native sub-issue, such as `[R04.2]`: usually one PR that can merge
  and deploy alone, with its tests, spec changes and fixtures. Engine, web and
  documentation are not routinely split into separate slices. Every merge to `main`
  deploys, so no slice leaves a public interaction that a later slice must repair.
- A **blocked-by** relationship marks a real prerequisite, never a shared theme.

Labels:

- `roadmap` on every parent and slice.
- Exactly one of `kind:feature`, `kind:implementation` or `kind:research`.
- On an open issue, exactly one of `stage:needs-design`, `stage:ready`, `stage:active`
  or `stage:review`. `needs-design` means the issue cannot be implemented from what it
  says, not that its subject was rejected. `ready` describes the specification; the
  issue can start only once its prerequisites are merged and usable.

Completion is the issue's own state and blockers are native relationships; neither is
repeated as a status list in prose. Search closed issues before opening a replacement
or a follow-up. Milestone percentages count issues, not effort.

### Preparing an assignment

Use the **Roadmap feature** template for a parent and **Roadmap implementation or
research** for a slice. A ready slice states:

1. The outcome for the user and the parent criteria it advances.
2. Included and excluded work, with settled constraints kept apart from suggested
   implementation choices.
3. The spec chapters, code entry points and tests to start from, and the revision they
   were checked against. Paths and symbols, not line numbers.
4. Each prerequisite and the exact capability consumed from it, and what this slice
   exposes to the issues that depend on it. A bare issue link is not enough.
5. Which spec chapters change and their status. A Contract change names the rule and
   the fixtures that will pin it, and what existing configs, saved drafts and CSV
   output keep doing.
6. Observable acceptance criteria, including invalid input, boundary months, plans with
   one scenario or none of the new feature, and existing behavior that must not move.
7. Feature-specific verification, and whether the exploration checkpoint applies.

Specify near-term work fully against the current code. Keep later parents and slices
short and `stage:needs-design` until their prerequisites have merged and their design
questions are settled: a slice designed against code that does not exist yet is a
guess. A research slice states the question, the evidence to gather and the decision
the owner is asked to make. Finishing it neither completes its parent nor authorizes
dropping the intended outcome.

### Starting work

1. Read `AGENTS.md`, the issue and its comments, its parent, the feature's entry in
   `ROADMAP.md`, and the outcomes of its prerequisites:
   `gh issue view <number> --comments` and
   `gh issue view <number> --json parent,subIssues,blockedBy,blocking`. Use `gh api` if
   the installed CLI lacks a relationship field.
2. Recheck the assignment against current `main`. A closed prerequisite may have been
   rejected, and a merged PR may not have delivered what this issue assumes. Refresh
   stale context, and raise a material contradiction before building on it.
3. Check for an existing claim. Then comment with a short plan and the working branch,
   and set `stage:active`. Link the PR when it opens.
4. Ordinary implementation decisions are the implementer's. A change to accepted scope,
   an incompatible contract or an unresolved product choice goes to the owner.

### Keeping issues current

When the owner agrees to a material change of scope or acceptance, update the slice's
body and every affected parent and downstream body before relying on the change, and
leave a short comment saying what changed and why. A comment alone does not repair a
body that now contradicts it. Before the review handoff and again at completion,
compare the bodies with what was delivered. An unmet requirement is not rewritten as
delivered without the owner's agreement.

### Handoff and completion

A PR links its slice with a closing keyword only when it fulfils the slice, and links
the parent without one. At the review handoff, set `stage:review` and leave the issue
open. A slice is complete when the change is merged, the required verification is done
or its authorized exception is recorded, and the spec is current. Whoever merges then:

- removes the stage label and leaves one outcome comment:

  ```markdown
  Delivered: the capability now available.
  Integration: merged PR and commit; the spec sections, fixtures and tests to use.
  Verification: link to the PR's evidence and any authorized limits.
  Differences: agreed changes from the original assignment, or none.
  Follow-ups: issue links, and whether each is required or optional.
  Downstream: which issue bodies were refreshed and which can now start.
  ```

- updates dependent issue bodies with the interface, spec sections and tests that
  exist, and reconciles a changed contract with its consumers before marking them
  ready. Marking an issue ready does not assign it.

Close a parent only when its feature acceptance is met, judged on its own and not by
counting closed children. A deferred required criterion keeps the parent open unless
the owner agrees to revise the scope. Close a wave's milestone when its features are
accepted and no required work remains.

The owner prompts above work unchanged with an issue URL. For an issue assignment, the
handoff stage also reconciles the issue bodies, and the merge stage leaves the outcome
comment and refreshes the downstream issues.

## Layout

See the table in [README.md](README.md). The one architectural rule to keep
sacred: `engine/` stays pure (no I/O, no clock, no logging) and all finance
math stays in Go — the frontend only edits configs and renders results
(spec/02 boundaries; this is what lets the natively checked fixtures speak for
the WASM build).
