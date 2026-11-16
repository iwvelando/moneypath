# moneypath

<img src="web/public/moneypath.svg" alt="Curving paths branching into possible futures, marked by waypoints" width="260" height="100" />

Personal-finance scenario simulator: describe your financial life — income, expenses,
loans, investments — sketch alternative futures as scenarios, and see month-by-month
projections of cash and net worth for each. It is a fully static web app whose Go engine
runs in your browser via WebAssembly (your data never leaves your machine). A plan
downloads as one YAML file and uploads again.

**Try it at [moneypath.isaacvelando.com](https://moneypath.isaacvelando.com)**: the same
static app, served from a CDN. Nothing you enter is sent anywhere; your plan stays in
your browser's local storage.

moneypath is the successor to
[finance-forecast](https://github.com/iwvelando/finance-forecast). It has no command-line
tool and does not convert finance-forecast configs. The tag
[`last-cli-and-migrate`](https://github.com/iwvelando/moneypath/tree/last-cli-and-migrate)
is the last revision that had both.

[SPEC.md](SPEC.md) is where the config format and engine semantics are pinned down, with
`testdata/` wired into `go test` as conformance gates.

[ROADMAP.md](ROADMAP.md) records where the tool is headed; the work itself is tracked in
the repository's milestones and issues.

## Quick start

```sh
make dist           # engine wasm → web bundle in web/dist/ (needs Go and Node)
make preview-lan    # that build, served over HTTPS on your network
cd web && npm run dev   # the dev server, after `make wasm`
```

`make dist` produces `web/dist/`, the complete static site — deploy it by copying the
tree to any static file host (it works from any sub-path). `examples/` holds two
commented plans to upload.

Contributing? Start with [DEVELOPMENT.md](DEVELOPMENT.md) — in particular run
`make dev-setup` once (it turns on the git hooks).

## Layout

| Path | Contents |
|---|---|
| `config/` | v2 YAML config: parse, validate, month arithmetic |
| `engine/` | pure simulation core (loans, investments, emergency fund, optimizer) |
| `render/` | the CSV download's renderer |
| `internal/app/` | what the bridge calls: run pipeline + results JSON |
| `cmd/moneypath-wasm/` | WASM bridge (`moneypathForecast` / `moneypathVersion`) |
| `web/` | static web app (Vite + TypeScript + Preact); `web/e2e/` holds its browser tests |
| `deploy/` | the production Content-Security-Policy |
| `.github/` | CI that verifies every change and deploys `main` |
| `.agents/` | skills for coding agents working in this repo |
| `conformance/` | fixture harness, native↔WASM parity, static-bundle checks |

## Tests

```sh
make test-go   # engine/config/render units + all conformance fixtures
               # + native↔WASM parity (needs node; skipped without it)
make test-web  # frontend vitest suite
make test-browser  # Playwright against the production build (see DEVELOPMENT.md)
make pre-pr    # everything above plus WebKit: the local gate before a pull request
make preview-lan   # the production build over HTTPS on your network, to try on a phone
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

