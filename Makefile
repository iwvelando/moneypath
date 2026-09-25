# moneypath build pipeline (spec chapter 02, "Build artifacts").
#
# Release build order:
#   1. `make wasm`  — compile the engine to web/src/engine/moneypath.wasm
#   2. `make dist`  — bundle the web app (wasm is a hashed bundler input),
#                     then copy web/dist over the embedded tree
#   3. `make build` — native binary embedding that same dist/ tree
#
# `make dist` overwrites internal/webembed/dist locally; do not commit the
# built tree (the committed copy is a development placeholder — the bundle
# identity check in conformance/ gates releases).

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -ldflags "-X main.version=$(VERSION)"

.PHONY: all build dist wasm fmt fmt-check typecheck test test-go test-web clean serve dev-setup

all: build

dev-setup:
	./scripts/dev-setup.sh

wasm:
	GOOS=js GOARCH=wasm go build $(LDFLAGS) -o web/src/engine/moneypath.wasm ./cmd/moneypath-wasm

dist: wasm
	cd web && npm install --no-fund --no-audit && npm run build
	rm -rf internal/webembed/dist
	cp -R web/dist internal/webembed/dist

build: dist
	mkdir -p bin
	go build $(LDFLAGS) -o bin/moneypath ./cmd/moneypath

# gofmt every Go file in the module. Run after touching Go sources and
# before committing; `fmt-check` is the non-mutating form for a quick verdict.
fmt:
	gofmt -w .

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

serve: build
	./bin/moneypath serve

clean:
	rm -rf bin web/dist
