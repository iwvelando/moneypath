# moneypath — agent guide

## Ground rules

- `SPEC.md` and `spec/` record which behaviors are deliberate. Chapters carry a
  **status** (Contract / Descriptive / Reference) stated in their first
  line — read `SPEC.md`, "How these chapters are maintained", before changing a
  chapter or the behavior it covers.
  - **Contract** (01 product, 03 config format, 04 engine semantics, 05 CSV download,
    02's normative sections):
    change the chapter *before* the code, in the same commit as the fixtures that
    pin the new behavior, and say so in the commit message.
  - **Descriptive** (06 web UI): change the code, then update the chapter in
    the same commit if it still claims otherwise. Tests are the real contract.
- Work test-first. `testdata/conformance/` (what a sound plan produces) and
  `testdata/problems/` (what validation reports for one that is not) are wired into
  `go test` as the acceptance gate. **Never edit a fixture to make failing code pass.**
  Editing one is legitimate only as a deliberate change to specified behavior — that
  is a spec change, and it lands as one (chapter edit + fixture edit + explicit
  callout in the commit message). If a fixture instead looks like it contradicts
  chapters 03–05 as written, stop and flag it to the user.
- Any deviation from or interpretation of the spec must be surfaced to the user
  explicitly — don't resolve ambiguity silently.

## User-facing text

Anything a user can read — error and warning strings, UI copy, field help:

- **No internal references.** No spec paths, chapter or section numbers, fixture
  names, or Go identifiers. State the rule itself instead. Code comments may cite
  the spec freely; output may not.
- **No notation the reader has to decode.** Write "at least 0 and less than 100",
  not "[0, 100)". Assume a personal-finance enthusiast, not a mathematician.

## Errors, warnings and messages

An error appears at the thing that caused it, stays while it is true, and goes
away on its own. DEVELOPMENT.md, "Errors, warnings and messages", has the detail.

- **Three places, and no others.** Under the field, for anything about one field.
  Beside the control that started it, for an action that failed (run, upload,
  download, flip, keep). A page banner only for the whole app: the engine did not
  load, the saved draft was discarded, the plan cannot be saved. Do not add a
  message list, a toast, or a list of dismissable notices.
- **The engine decides what is wrong, live.** A rule lives in `config/` and is
  reported with the path of its field; the editor asks on every edit and shows the
  answer under that field. Do not restate a rule in TypeScript. A field reports for
  itself only what the engine never sees, such as text that is not a number.
- **Every field says where it is.** A control that edits the plan carries its
  config key (`field=`) inside the `At` path of its form. `App.test.tsx`, "places
  every error the editor can produce under a control", fails when an error has
  nowhere to appear; extend its plan when a rule or a form is added.
- **Never discard or repair input in silence.** What cannot be used stays on
  screen with its error, and a run is refused while any error stands.
- **Add, never replace.** A message joins the text beside it; it does not take the
  place of an explanation, a label or a hint.
- **Warnings look and read different from errors.** A warning is in the quieter
  warning style and starts "Warning: "; an error has no prefix. A warning never
  stops a run or marks a field invalid.
- **Confirmations are said once**, in the status line of the control that acted.

## Architecture invariants (spec/02)

- `engine/` is pure: no I/O, no clock reads (callers pass "now"), no logging.
- All finance math lives in Go, compiled to WASM for the site. The frontend
  (`web/`) only edits configs and renders results.
- CSV rendering is Go code. The fixtures are checked against a native build and
  the site ships the WASM build, so the two must stay byte-identical
  (`TestNativeWASMParity` enforces this).
- There is no command-line tool and no conversion of finance-forecast plans.
  The web app is the only product surface.

## Building and testing

```sh
make fmt            # gofmt -w . — run after ANY Go edit, and before every commit
make fmt-check      # non-mutating: lists files that still need `make fmt`
make test-go        # Go units + all fixture/parity/bundle checks
make test-web       # frontend vitest suite (cd web && npm run test -- --run)
make test-browser   # Playwright against the production build, under the production CSP
make test-webkit    # the same on Safari's engine (iPhone profile)
make typecheck      # tsc --noEmit over web/ — see below; test-web does NOT do this
make dist           # wasm → web/dist, the static site
make check          # fmt-check, vet, production build, Go and frontend suites
make pre-pr         # check + the full Chromium and WebKit browser suites
make preview-lan    # production build over HTTPS on the local network, for a phone
```

**`make test-web` does not typecheck.** vitest strips types rather than checking
them, so a changed prop or exported signature can leave every test green and still
break `make dist` (the only other place `tsc --noEmit` runs). Run `make typecheck`
after changing a component's props or anything in `web/src/config/types.ts`.

**Run `make fmt` whenever you touch a `.go` file, and again before committing** —
the tree is gofmt-clean and must stay that way. `make fmt-check` exits non-zero
with the offending file list, so use it to confirm before staging. The
pre-commit hook in `.githooks/` also refuses any staged Go file that isn't
gofmt-clean (it checks the staged content, not the worktree), so a forgotten
`make fmt` fails the commit rather than landing.

## Delivering a change

DEVELOPMENT.md, "Delivering a change", has the full procedure. The rules:

- **Iterate on targeted checks.** While developing and taking owner feedback, run the
  red/green tests and the checks for the paths you touched. Do not run `make pre-pr`
  between feedback iterations.
- **Stop at the exploration checkpoint.** For a new feature, or any change a user can
  see or feel in the web app, once the work is otherwise ready for `make pre-pr`: run
  `make preview-lan` and give the owner, in private chat, the `https://` Network
  address it prints together with a short list of things to try. Never hand over
  `127.0.0.1` or `localhost`: a phone cannot open it. Then wait for the go-ahead,
  unless the owner has waived the checkpoint or the work is unattended, in which case
  the handoff says the exploration is still owed. Documentation changes have no
  checkpoint, nor does an engine change whose numbers the fixtures pin.
- **Then verify once.** Run `make pre-pr` on the final changes, after the checkpoint
  and before the PR. A change made after that run needs it again. The exception is a
  change only to Markdown (and instruction-only skills under `.agents/skills/`), which
  no test or build step reads.
- **Hand off at the PR.** Push, open the PR, and state the revision tested, the checks
  actually run and anything still pending. Report CI as pending; whoever reviews reads
  it. A request for a PR is not permission to merge it, and merging deploys.
- **Report what ran.** Never imply an unrun check passed. Anything only a phone can
  show is reported as needing an on-device check, never as passing.
- **Keep public records portable.** Issues, PRs and comments name branches, commits and
  repository-relative paths. They carry no local preview addresses, machine paths,
  session details or quoted private chat. Those stay in private chat with the owner.
- **Stop what you started.** Before handing work to another session or ending it, stop
  the preview and dev servers you started and confirm they stopped. A preview stays up
  while the owner is still exploring it.
- **Keep working notes out of the tree.** Do not commit PR-specific review reports,
  validation guides or handoff notes. `.codex/` is ignored for them; final status goes
  in the PR description.
- **A failure you did not cause gets an issue before a rerun.** Search for the test's
  name, record the occurrence there (or open one), then rerun and write only
  `Reran for #<issue>` in the PR. The same goes for a bug outside the change that is
  too large to fix in passing.

When reviewing a PR, branch or diff, follow [REVIEWING.md](REVIEWING.md). The
[moneypath-review skill](.agents/skills/moneypath-review/SKILL.md) is a short entry
point to it for a fresh-context review; the procedure is the same without skill support.

## Roadmap assignments

[ROADMAP.md](ROADMAP.md) is the accepted product direction. The work is tracked in
GitHub issues: wave milestones, one parent issue per feature, and native sub-issues for
slices. DEVELOPMENT.md, "Roadmap assignments", has the procedure. The rules:

- **Read before starting.** The issue and its comments, its parent, the feature's entry
  in `ROADMAP.md` and the outcomes of its prerequisites, rechecked against current
  `main`. A closed prerequisite is not proof the capability exists.
- **Claim it.** Comment with a short plan and the working branch, and set
  `stage:active`. A `stage:ready` label is not an assignment and waives nothing: the
  planning, test-first, spec and verification rules here still apply.
- **`stage:needs-design` is not implementable.** Settle the design with the owner and
  rewrite the issue body first.
- **Each kind of information has one home.** Direction in `ROADMAP.md`; current scope
  and acceptance in issue bodies; discussion in comments; specified behavior in
  `spec/`; verification in the PR. `ROADMAP.md` is not a status log.
- **Keep bodies true.** When agreed scope changes, update the slice, its parent and the
  affected downstream bodies before relying on it, and leave a short comment.
- **Children closing does not close a parent.** A parent closes when its own acceptance
  is met. Required scope is never dropped silently.
- **Finish with one outcome comment** after merge, and refresh the issues that depend
  on the result with what was delivered.

## Safari and iOS

Playwright's WebKit uses macOS rules, so `make test-webkit` misses some of what an
iPhone does:

- iOS draws a focus ring on a programmatic `focus()` that follows a tap. Code that
  moves focus after a pointer action suppresses the ring itself; `:focus-visible`
  alone does not.
- iOS gives radios and checkboxes a small fixed size. One stretched over its label
  sets `width: 100%; height: 100%` explicitly.
- Safari does not focus a button when it is clicked, so a blur's `relatedTarget` is
  null. Cover click, focus and blur behavior in `web/e2e/webkit.spec.ts`.

When a change touches controls, touch, focus or layout at phone width, list what to
check on a phone in the PR and at the exploration checkpoint, as pending.

## Deployment

- Merging to `main` deploys to <https://moneypath.isaacvelando.com>
  (`.github/workflows/ci.yml`); never deploy any other way. Dependabot patch and minor
  updates merge and deploy on their own once `Verify` passes
  (`.github/workflows/dependabot-merge.yml`). That leaves the test suites as the only
  thing between a bad dependency and production.
- The hosting is Terraform in `iwvelando/cloud-accounts`
  (`sites/moneypath.isaacvelando.com`), not here. A change that needs a new kind of
  resource (a worker, a font, a `data:` image, a fetch to anywhere) needs a matching
  change to `deploy/content-security-policy.txt`. The same change must land in
  cloud-accounts *before* this repo's change merges, or the deploy fails its CSP check.
- Keep `@smoke` tests in `web/e2e/` fast and read-only: they run against the live site
  after every deploy.
- `web/dist/` must carry the license notices (`make notices`); `check-dist.mjs` fails
  the build without them.

## Repo-specific gotchas

- Stage paths explicitly; avoid blanket `git add -A` / `git add .`.
- The engine build writes two gitignored files into `web/src/`: `moneypath.wasm`
  and Go's glue, `vendor/wasm_exec.js`, copied from the toolchain that compiled
  the wasm so the pair always matches. Never commit either. The frontend unit
  tests run that wasm, not a stand-in: `make test-web` rebuilds it first, while
  a bare `npm test` in `web/` builds it only when it is missing, so run
  `make wasm` after a Go edit.
- **A new field in the web editor model (`web/src/config/types.ts`) must also work for
  saved drafts that predate it**, not just fresh and uploaded configs. The editor
  restores its draft from `localStorage` (`web/src/state/persistence.ts`), and an old
  draft has no such key, so the field arrives `undefined` (an input showing
  "undefined", or a crash). Give the field a blank in the matching `empty*` constructor
  in `types.ts`; restoring lays each saved entry over that, so nothing more is needed
  and `EDITOR_STATE_VERSION` stays put (a bump discards everyone's draft). Extend the
  sparse-draft tests in `persistence.test.ts` if the field sits somewhere they don't
  reach.
- Dates are `YYYY-MM` strings at boundaries and `config.Month` ints
  internally; behavior-deciding comparisons round to cents first
  (`round2`, spec/04 preamble).
