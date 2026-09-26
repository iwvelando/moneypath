// Writes the licenses the published site must carry into public/, so they ship
// in dist/: the project's own LICENSE, Go's (the engine is the Go runtime
// compiled to WebAssembly, and wasm_exec.js is Go's), and a notices file for
// every bundled npm runtime dependency and Go module. Run from web/ via
// `make notices`, which passes GOROOT and each non-standard module compiled
// into the wasm engine:
//
//   node scripts/build-notices.mjs <GOROOT> <module>@<version>=<dir>...
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const [goroot, ...goModules] = process.argv.slice(2);
if (!goroot) throw new Error('usage: build-notices.mjs <GOROOT> <module>@<version>=<dir>...');

const licenseIn = (folder, what) => {
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map((name) => join(folder, name)).find(existsSync);
  if (!file) throw new Error(`Missing license for ${what}; review its distribution notices.`);
  return file;
};
const withNotice = (folder, text) => {
  const notice = join(folder, 'NOTICE');
  return existsSync(notice) ? `${text}\n${readFileSync(notice, 'utf8')}` : text;
};

const notices = [
  'moneypath — third-party notices\n\nGenerated from the installed dependencies. Go\'s license is in GO-LICENSE.txt.\n',
];

// npm: walk installed runtime dependencies so their exact locked versions and
// full licenses accompany the site. Vite also emits a small preload helper.
const require = createRequire(resolve('package.json'));
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const seen = new Set();
function include(name, resolver) {
  const manifest = resolver.resolve(`${name}/package.json`);
  if (seen.has(manifest)) return;
  seen.add(manifest);
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const folder = dirname(manifest);
  notices.push(
    `\n--- ${pkg.name} ${pkg.version} (${pkg.license ?? 'see below'}) ---\n\n${readFileSync(licenseIn(folder, pkg.name), 'utf8')}`,
  );
  // Vite's own LICENSE.md already covers its bundled dependencies, and its
  // development toolchain is not shipped with the site.
  if (name !== 'vite') {
    const next = createRequire(manifest);
    for (const dependency of Object.keys(pkg.dependencies ?? {}).sort()) include(dependency, next);
  }
}
for (const name of [...Object.keys(root.dependencies), 'vite'].sort()) include(name, require);

// Go modules compiled into the engine.
for (const arg of goModules) {
  const [module, folder] = arg.split('=');
  const [path, version] = module.split('@');
  notices.push(
    `\n--- ${path} ${version} (Go module) ---\n\n${withNotice(folder, readFileSync(licenseIn(folder, path), 'utf8'))}`,
  );
}

writeFileSync('public/THIRD-PARTY-NOTICES.txt', notices.join('\n'));
copyFileSync('../LICENSE', 'public/LICENSE.txt');
// Some packagers (Homebrew) keep Go's LICENSE beside GOROOT rather than in it.
const goDir = [goroot, dirname(goroot)].find((dir) => existsSync(join(dir, 'LICENSE')));
if (!goDir) throw new Error(`Go's LICENSE is not in ${goroot} or its parent.`);
const patents = join(goDir, 'PATENTS');
writeFileSync(
  'public/GO-LICENSE.txt',
  readFileSync(join(goDir, 'LICENSE'), 'utf8') +
    (existsSync(patents) ? `\n${readFileSync(patents, 'utf8')}` : ''),
);
console.log('Wrote public/THIRD-PARTY-NOTICES.txt, LICENSE.txt, and GO-LICENSE.txt.');
