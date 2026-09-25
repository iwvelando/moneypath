/**
 * The frontend imports `src/engine/moneypath.wasm` as a bundler input so Vite
 * emits it into dist/assets with a content-derived filename (spec/02, "Build
 * artifacts"). The real module is produced by the Go build:
 *
 *   GOOS=js GOARCH=wasm go build -o web/src/engine/moneypath.wasm ./cmd/moneypath-wasm
 *
 * That output is a build artifact and is gitignored, so a fresh checkout has no
 * file to import. This script drops in a minimal empty wasm module when one is
 * missing, purely so the frontend toolchain can run on its own. It never
 * touches an existing file, so it can't clobber a real build.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '..', 'src', 'engine', 'moneypath.wasm');

if (!existsSync(target)) {
  mkdirSync(dirname(target), { recursive: true });
  // The 8-byte wasm preamble: a valid, empty module. It instantiates but
  // exports nothing, so the engine loader reports a clear failure.
  writeFileSync(target, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  console.log(
    `[moneypath] wrote a placeholder ${target}\n` +
      '[moneypath] build the Go wasm module to replace it before shipping dist/.',
  );
}
