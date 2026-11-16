// Node harness that runs the wasm engine outside a browser: the native <-> WASM
// parity check (spec chapter 08) and the browser tests that compare the app with
// a plan fed straight to the engine.
// Usage: node parity_harness.cjs <wasm_exec.js> <moneypath.wasm> <config.yaml> <optionsJSON> [validate]
// Prints the raw string returned by moneypathForecast to stdout, or by
// moneypathValidate when the last argument is "validate".
'use strict';
const { readFileSync } = require('node:fs');

async function main() {
  const [execJs, wasmPath, configPath, optionsJSON, fn] = process.argv.slice(2);
  require(require('node:path').resolve(execJs)); // defines globalThis.Go
  const go = new Go();
  const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), go.importObject);
  go.run(instance); // main() registers the bridge functions, then blocks
  const configYaml = readFileSync(configPath, 'utf8');
  const call = fn === 'validate' ? globalThis.moneypathValidate : globalThis.moneypathForecast;
  const out = call(configYaml, optionsJSON);
  // Exit only once the write has drained: a pipe takes a large result in
  // pieces, and exiting straight away cuts it off.
  process.stdout.write(out, () => process.exit(0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
