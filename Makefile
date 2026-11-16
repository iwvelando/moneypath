# moneypath build pipeline (spec chapter 02, "Build artifacts").
#
#   1. `make wasm`  — compile the engine to web/src/engine/moneypath.wasm and
#                     copy the Go toolchain's matching glue beside the app
#   2. `make dist`  — write license notices, bundle the web app (wasm is a
#                     hashed bundler input) into web/dist, and check the tree
#
# web/dist is the whole product: the static site CI publishes.

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -ldflags "-X main.version=$(VERSION)"
# CI passes NPM_INSTALL="npm ci" so the lockfile is used exactly.
NPM_INSTALL ?= npm install --no-fund --no-audit

.PHONY: all dist wasm notices fmt fmt-check vet typecheck test test-go test-web test-browser test-webkit check pre-pr preview-lan share-card clean dev-setup

all: dist

# One-time: use the committed git hooks (.githooks/).
dev-setup:
	git config core.hooksPath .githooks

# The glue (wasm_exec.js) and the compiler only work as a pair, so it comes
# from the toolchain that builds the engine and is never committed.
wasm:
	GOOS=js GOARCH=wasm go build $(LDFLAGS) -o web/src/engine/moneypath.wasm ./cmd/moneypath-wasm
	install -m 644 "$$(go env GOROOT)/lib/wasm/wasm_exec.js" web/src/vendor/wasm_exec.js

# Licenses the published site must carry: Go's (the engine is the Go runtime),
# every Go module compiled into the wasm, and the npm runtime dependencies.
notices:
	cd web && $(NPM_INSTALL) && node scripts/build-notices.mjs "$$(go env GOROOT)" \
		$$(cd .. && GOOS=js GOARCH=wasm go list -deps -f '{{with .Module}}{{if not .Main}}{{.Path}}@{{.Version}}={{.Dir}}{{end}}{{end}}' ./cmd/moneypath-wasm | sort -u)

dist: wasm notices
	cd web && npm run build && node scripts/check-dist.mjs

# gofmt every Go file in the module. Run after touching Go sources and
# before committing; `fmt-check` is the non-mutating form for a quick verdict.
fmt:
	gofmt -w .

vet:
	go vet ./...
	GOOS=js GOARCH=wasm go vet ./cmd/moneypath-wasm

fmt-check:
	@out="$$(gofmt -l .)"; \
	if [ -n "$$out" ]; then \
		echo "these files need 'make fmt':"; echo "$$out"; exit 1; \
	fi

# The vitest suite strips types rather than checking them, so this is the
# frontend's type verdict. `make dist` runs the same check via the web build.
typecheck:
	cd web && npm run typecheck

test: test-go test-web

test-go:
	go test ./...

test-web:
	cd web && npm run test -- --run

# Browser tests against `vite preview` of the production build, under the
# production CSP. Needs `npx playwright install chromium` (and webkit) once.
test-browser: dist
	cd web && npx playwright test

test-webkit: dist
	cd web && WEBKIT=1 npx playwright test --project=webkit

# What CI's `check` job runs short of the browser: formatting, vet, the
# production build (which typechecks), then the Go and frontend suites. dist
# comes before test-go so its bundle check sees the real build.
check: fmt-check vet dist test-go test-web

# Everything a pull request needs locally (AGENTS.md, "Delivering a change"):
# `check`, then the full Chromium and WebKit browser suites on that build.
pre-pr: check test-browser test-webkit
	@echo "pre-pr: check and the full Chromium and WebKit browser suites passed"

# Serves the production build, under the production CSP, to other devices on
# the local network (a phone) over HTTPS with a self-signed certificate. Open
# the https:// Network address it prints. The port stays clear of 4181, which
# the browser tests use.
PREVIEW_PORT ?= 4180
preview-lan: dist
	cd web && npm run preview:lan -- --port $(PREVIEW_PORT) --strictPort

# Re-render the link-preview card from the built site. Check it by eye and
# commit web/public/og-image.png; it changes only when the site's look does.
share-card: dist
	cd web && node scripts/build-share-card.mjs

clean:
	rm -rf web/dist web/src/engine/moneypath.wasm web/src/vendor/wasm_exec.js
