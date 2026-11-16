/**
 * The frontend imports two files that the Go build produces and git ignores:
 *
 * - `src/engine/moneypath.wasm`, a bundler input, so Vite emits it into
 *   dist/assets with a content-derived filename (spec/02, "Build artifacts");
 * - `src/vendor/wasm_exec.js`, Go's glue for running that module. The glue and
 *   the compiler only work as a pair, so it is copied from the toolchain and
 *   never committed.
 *
 * `make wasm` writes both. This script fills in whichever is missing, so the
 * frontend tests and the dev server run before the first engine build: an
 * empty wasm module, and the glue of the installed Go. It never touches an
 * existing file, so it can't clobber a real build or split a matched pair.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wasm = resolve(here, '..', 'src', 'engine', 'moneypath.wasm');
const glue = resolve(here, '..', 'src', 'vendor', 'wasm_exec.js');

if (!existsSync(wasm)) {
  mkdirSync(dirname(wasm), { recursive: true });
  // The 8-byte wasm preamble: a valid, empty module. It instantiates but
  // exports nothing, so the engine loader reports a clear failure.
  writeFileSync(wasm, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  console.log(
    `[moneypath] wrote a placeholder ${wasm}\n` +
      '[moneypath] run `make wasm` to replace it before shipping dist/.',
  );
}

if (!existsSync(glue)) {
  let goroot;
  try {
    goroot = execFileSync('go', ['env', 'GOROOT'], { encoding: 'utf8' }).trim();
  } catch {
    console.error(
      `[moneypath] ${glue} is missing and Go is not installed to copy it from.\n` +
        '[moneypath] install Go, then run `make wasm`.',
    );
    process.exit(1);
  }
  copyFileSync(join(goroot, 'lib', 'wasm', 'wasm_exec.js'), glue);
  // Downloaded Go toolchains ship read-only files; keep the copy writable so
  // `make wasm` can replace it.
  chmodSync(glue, 0o644);
  console.log(`[moneypath] copied Go's wasm glue to ${glue}`);
}
