# moneypath build pipeline (spec chapter 02, "Build artifacts").
#
# Release build order:
#   1. `make wasm`  — compile the engine to web/src/engine/moneypath.wasm
#   2. `make dist`  — write license notices, bundle the web app (wasm is a
#                     hashed bundler input), check the tree, then copy
#                     web/dist over the embedded tree
#   3. `make build` — native binary embedding that same dist/ tree
#
# `make dist` overwrites internal/webembed/dist locally; do not commit the
# built tree (the committed copy is a development placeholder — the bundle
# identity check in conformance/ gates releases).

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -ldflags "-X main.version=$(VERSION)"
# CI passes NPM_INSTALL="npm ci" so the lockfile is used exactly.
NPM_INSTALL ?= npm install --no-fund --no-audit

.PHONY: all build dist wasm notices fmt fmt-check vet typecheck test test-go test-web test-browser test-webkit share-card clean serve dev-setup

all: build

dev-setup:
	./scripts/dev-setup.sh

wasm:
	GOOS=js GOARCH=wasm go build $(LDFLAGS) -o web/src/engine/moneypath.wasm ./cmd/moneypath-wasm

# Licenses the published site must carry: Go's (the engine is the Go runtime),
# every Go module compiled into the wasm, and the npm runtime dependencies.
notices:
	cd web && $(NPM_INSTALL) && node scripts/build-notices.mjs "$$(go env GOROOT)" \
		$$(cd .. && GOOS=js GOARCH=wasm go list -deps -f '{{with .Module}}{{if not .Main}}{{.Path}}@{{.Version}}={{.Dir}}{{end}}{{end}}' ./cmd/moneypath-wasm | sort -u)

dist: wasm notices
	cd web && npm run build && node scripts/check-dist.mjs
	rm -rf internal/webembed/dist
	cp -R web/dist internal/webembed/dist

build: dist
	mkdir -p bin
	go build $(LDFLAGS) -o bin/moneypath ./cmd/moneypath

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

# Re-render the link-preview card from the built site. Check it by eye and
# commit web/public/og-image.png; it changes only when the site's look does.
share-card: dist
	cd web && node scripts/build-share-card.mjs

serve: build
	./bin/moneypath serve

clean:
	rm -rf bin web/dist
