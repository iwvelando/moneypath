# moneypath

Personal-finance scenario simulator: describe your financial life — income, expenses,
loans, investments — in one YAML file, sketch alternative futures as scenarios, and see
month-by-month projections of cash and net worth for each. One Go engine, two doors: a
CLI, and a fully static web app that runs the same engine in your browser via
WebAssembly (your data never leaves your machine).

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
| `web/` | static web app (Vite + TypeScript + Preact) |
| `conformance/` | fixture harness, CLI↔WASM parity, static-bundle identity checks |

## Tests

```sh
make test-go   # engine/config/render/legacy units + all conformance fixtures
               # + CLI↔WASM parity (needs node; skipped without it)
make test-web  # frontend vitest suite
```
