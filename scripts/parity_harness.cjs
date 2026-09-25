// Node harness for the CLI <-> WASM parity check (spec chapter 08 item 3).
// Usage: node parity_harness.cjs <wasm_exec.js> <moneypath.wasm> <config.yaml> <optionsJSON>
// Prints the raw string returned by moneypathForecast to stdout.
'use strict';
const { readFileSync } = require('node:fs');

async function main() {
  const [execJs, wasmPath, configPath, optionsJSON] = process.argv.slice(2);
  require(require('node:path').resolve(execJs)); // defines globalThis.Go
  const go = new Go();
  const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), go.importObject);
  go.run(instance); // main() registers the bridge functions, then blocks
  const configYaml = readFileSync(configPath, 'utf8');
  const out = globalThis.moneypathForecast(configYaml, optionsJSON);
  process.stdout.write(out);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
