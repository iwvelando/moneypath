// Fails the build when dist/ is missing anything the published site needs.
// The deploy mirrors dist/ with `--delete`, so an incomplete tree would take
// files off the live site. Run from web/ after `vite build` (`make dist`).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

for (const file of [
  'index.html',
  '404.html',
  'favicon.svg',
  'favicon-32.png',
  'apple-touch-icon.png',
  'og-image.png',
  'LICENSE.txt',
  'GO-LICENSE.txt',
  'THIRD-PARTY-NOTICES.txt',
])
  assert.ok(statSync(`dist/${file}`, { throwIfNoEntry: false })?.size, `Missing or empty dist/${file}`);

const assets = readdirSync('dist/assets');
assert.ok(assets.some((name) => name.endsWith('.js')), 'No JavaScript in dist/assets');
const wasm = assets.filter((name) => name.endsWith('.wasm'));
assert.equal(wasm.length, 1, `Expected one engine in dist/assets, found ${wasm.length}`);
// The placeholder from ensure-wasm.mjs is 8 bytes; the real engine is megabytes.
assert.ok(statSync(`dist/assets/${wasm[0]}`).size > 1_000_000, 'dist/ holds the placeholder engine, not the real one');

assert.equal(readFileSync('dist/LICENSE.txt', 'utf8'), readFileSync('../LICENSE', 'utf8'));
assert.match(readFileSync('dist/GO-LICENSE.txt', 'utf8'), /The Go Authors/);
const notices = readFileSync('dist/THIRD-PARTY-NOTICES.txt', 'utf8');
for (const name of ['preact', 'yaml', 'vite', 'gopkg.in/yaml.v3'])
  assert.ok(notices.includes(`--- ${name} `), `Missing notice for ${name}`);
console.log('dist/: required files, the real engine, and license notices present.');
