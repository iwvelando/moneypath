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
- Dates are `YYYY-MM` strings at boundaries and `config.Month` ints
  internally; behavior-deciding comparisons round to cents first
  (`round2`, spec/04 preamble).
