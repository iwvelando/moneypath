# moneypath — agent guide

## Ground rules

- `SPEC.md` and `spec/` record which behaviors are deliberate. Chapters carry a
  **status** (Contract / Descriptive / Frozen / Reference) stated in their first
  line — read `SPEC.md`, "How these chapters are maintained", before changing a
  chapter or the behavior it covers.
  - **Contract** (03 config format, 04 engine semantics, 02's normative sections):
    change the chapter *before* the code, in the same commit as the fixtures that
    pin the new behavior, and say so in the commit message.
  - **Descriptive** (05 CLI, 06 web UI): change the code, then update the chapter in
    the same commit if it still claims otherwise. Tests are the real contract.
  - **Frozen** (07): the v1 format cannot change. Edit only to correct an error.
- Work test-first. `testdata/conformance/` and `testdata/migration/` are wired into
  `go test` as acceptance gates. **Never edit a fixture to make failing code pass.**
  Editing one is legitimate only as a deliberate change to specified behavior — that
  is a spec change, and it lands as one (chapter edit + fixture edit + explicit
  callout in the commit message). If a fixture instead looks like it contradicts
  chapters 03–05 as written, stop and flag it to the user.
- Any deviation from or interpretation of the spec must be surfaced to the user
  explicitly — don't resolve ambiguity silently.

## User-facing text

Anything a user can read — CLI output, error and warning strings, UI copy, field
help, migration notices:

- **No internal references.** No spec paths, chapter or section numbers, fixture
  names, or Go identifiers. State the rule itself instead. Code comments may cite
  the spec freely; output may not.
- **No notation the reader has to decode.** Write "at least 0 and less than 100",
  not "[0, 100)". Assume a personal-finance enthusiast, not a mathematician.

## Architecture invariants (spec/02)

- `engine/` is pure: no I/O, no clock reads (callers pass "now"), no logging.
- All finance math lives in Go, shared by CLI and WASM. The frontend
  (`web/`) only edits configs and renders results.
- CSV rendering is shared code; native and WASM output must stay
  byte-identical (`TestCLIWASMParity` enforces this).

## Building and testing

```sh
make fmt            # gofmt -w . — run after ANY Go edit, and before every commit
make fmt-check      # non-mutating: lists files that still need `make fmt`
make test-go        # Go units + all fixture/parity/bundle checks
make test-web       # frontend vitest suite (cd web && npm run test -- --run)
make test-browser   # Playwright against the production build, under the production CSP
make test-webkit    # the same on Safari's engine (iPhone profile)
make typecheck      # tsc --noEmit over web/ — see below; test-web does NOT do this
make build          # wasm → web/dist → binary with embedded web app
make check          # fmt-check, vet, production build, Go and frontend suites
make pre-pr         # check + the full Chromium and WebKit browser suites
make preview-lan    # production build over HTTPS on the local network, for a phone
go build ./cmd/moneypath   # CLI-only build, no Node needed
```

**`make test-web` does not typecheck.** vitest strips types rather than checking
them, so a changed prop or exported signature can leave every test green and still
break `make build` (the only other place `tsc --noEmit` runs). Run `make typecheck`
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
  the handoff says the exploration is still owed. CLI-only and documentation
  changes have no checkpoint, nor does an engine change whose numbers the fixtures pin.
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

- **Never commit `internal/webembed/dist/index.html`.** The committed copy is
  a development placeholder; `make dist` overwrites it locally as a build
  artifact (see DEVELOPMENT.md, "The embedded web tree"). A pre-commit hook
  in `.githooks/` blocks it; contributors run `./scripts/dev-setup.sh` once
  to enable the hook and hide the local modification via skip-worktree. Avoid
  blanket `git add -A` / `git add .` — stage paths explicitly.
- The real `moneypath.wasm` is gitignored everywhere (`*.wasm`); the web
  build generates a placeholder when it's absent (`web/scripts/ensure-wasm.mjs`).
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
