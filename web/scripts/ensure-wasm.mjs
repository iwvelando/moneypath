/**
 * The frontend imports two files that the Go build produces and git ignores:
 *
 * - `src/engine/moneypath.wasm`, a bundler input, so Vite emits it into
 *   dist/assets with a content-derived filename (spec/02, "Build artifacts");
 * - `src/vendor/wasm_exec.js`, Go's glue for running that module. The glue and
 *   the compiler only work as a pair, so it is copied from the toolchain and
 *   never committed.
 *
 * `make wasm` writes both. When either is missing this script runs it, so the
 * dev server and the unit tests, which run the real engine, work from a fresh
 * checkout. It does not rebuild an engine that is already there: after editing
 * Go, run `make wasm` (`make test-web` does).
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wasm = resolve(here, '..', 'src', 'engine', 'moneypath.wasm');
const glue = resolve(here, '..', 'src', 'vendor', 'wasm_exec.js');

if (!existsSync(wasm) || !existsSync(glue)) {
  console.log('[moneypath] the engine build is missing; running `make wasm`.');
  try {
    execFileSync('make', ['wasm'], { cwd: resolve(here, '..', '..'), stdio: 'inherit' });
  } catch {
    console.error('[moneypath] `make wasm` failed. It needs Go installed.');
    process.exit(1);
  }
}
