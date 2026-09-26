# moneypath

Personal-finance scenario simulator: describe your financial life — income, expenses,
loans, investments — in one YAML file, sketch alternative futures as scenarios, and see
month-by-month projections of cash and net worth for each. One Go engine, two doors: a
CLI, and a fully static web app that runs the same engine in your browser via
WebAssembly (your data never leaves your machine).

**Try it at [moneypath.isaacvelando.com](https://moneypath.isaacvelando.com)**: the same
static app, served from a CDN. Nothing you enter is sent anywhere; your plan stays in
your browser's local storage.

moneypath is the successor to
[finance-forecast](https://github.com/iwvelando/finance-forecast): `moneypath migrate`
converts its configs, and [spec/07](spec/07-migration.md) lists the behaviors that
deliberately changed on the way.

[SPEC.md](SPEC.md) is where the config format and engine semantics are pinned down, with
`testdata/` wired into `go test` as conformance gates.

## Quick start

```sh
# CLI only (no frontend toolchain needed):
go build -o bin/moneypath ./cmd/moneypath
./bin/moneypath forecast --config examples/example.yaml
./bin/moneypath forecast --config plan.yaml --output-format csv --optimize

# Convert a legacy finance-forecast config:
./bin/moneypath migrate old-config.yaml -o plan.yaml

# Full build (engine wasm → web bundle → binary with the web app embedded):
make build          # needs Go and Node
./bin/moneypath serve   # → http://localhost:8080
```

`make dist` produces `web/dist/`, the complete static site — deploy it by copying the
tree to any static file host (it works from any sub-path). The native binary embeds a
copy of the same tree to back `moneypath serve`.

Contributing? Start with [DEVELOPMENT.md](DEVELOPMENT.md) — in particular run
`./scripts/dev-setup.sh` once (git hooks + a skip-worktree flag for the embedded-web
placeholder that `make dist` overwrites locally).

## Layout

| Path | Contents |
|---|---|
| `config/` | v2 YAML config: parse, validate, month arithmetic |
| `engine/` | pure simulation core (loans, investments, emergency fund, optimizer) |
| `render/` | CSV and pretty renderers shared by CLI and WASM |
| `legacy/` | v1 → v2 `migrate` conversion |
| `internal/app/` | shared CLI/WASM entry: run pipeline + results JSON |
| `cmd/moneypath/` | CLI (`forecast`, `migrate`, `serve`, `version`) |
| `cmd/moneypath-wasm/` | WASM bridge (`moneypathForecast` / `moneypathMigrate` / `moneypathVersion`) |
| `web/` | static web app (Vite + TypeScript + Preact); `web/e2e/` holds its browser tests |
| `deploy/` | the production Content-Security-Policy |
| `.github/` | CI that verifies every change and deploys `main` |
| `conformance/` | fixture harness, CLI↔WASM parity, static-bundle identity checks |

## Tests

```sh
make test-go   # engine/config/render/legacy units + all conformance fixtures
               # + CLI↔WASM parity (needs node; skipped without it)
make test-web  # frontend vitest suite
make test-browser  # Playwright against the production build (see DEVELOPMENT.md)
```

## Hosting

[moneypath.isaacvelando.com](https://moneypath.isaacvelando.com) is `web/dist/` copied to a
private S3 bucket behind CloudFront. The bucket, CDN, certificate, DNS, and the deploy role
are Terraform in [iwvelando/cloud-accounts](https://github.com/iwvelando/cloud-accounts)
(`sites/moneypath.isaacvelando.com`); this repo holds no infrastructure.

Merging to `main` deploys. `.github/workflows/ci.yml` builds and tests in `check` (Chromium)
and `webkit` (Safari's engine on an iPhone profile). `deploy` then uploads that exact build
through the repo's `production` environment, and `smoke` runs the `@smoke` browser tests
against the live site. A failed run on `main` opens an issue.

CloudFront sends the Content-Security-Policy in `deploy/content-security-policy.txt`. The
local preview sends it too, so the browser tests run under it. The deploy fails if the
live header ever differs from the file. A change that needs a new kind of resource
changes both, cloud-accounts first.

Shared links unfurl into a card: `web/public/og-image.png` shows the starter plan's
forecast under the app's name. `index.html` points to it by absolute URL, because link
scrapers need one. Run `make share-card` to re-render it when the app's look changes,
check it by eye, and commit it.

