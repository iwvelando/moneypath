/**
 * The real engine: the Go module compiled with GOOS=js GOARCH=wasm.
 *
 * Asset rules (spec/02 "Build artifacts"):
 * - The wasm binary is a *bundler input* referenced through
 *   `new URL('./moneypath.wasm', import.meta.url)`, so it lands in dist/assets
 *   with a content-derived filename and a relative URL.
 * - `wasm_exec.js` is bundled like any other module (side-effect import); it is
 *   not an unhashed copy in public/.
 * - `.wasm` may not be served as `application/wasm`, so streaming instantiation
 *   falls back to `WebAssembly.instantiate(await response.arrayBuffer())`.
 */

import '../vendor/wasm_exec.js';
import { decodeForecast, decodeMigrate } from './bridge';
import {
  EngineError,
  type Engine,
  type ForecastOptions,
  type ForecastResults,
  type MigrateResult,
} from './types';

const wasmUrl = new URL('./moneypath.wasm', import.meta.url);

interface MoneypathGlobals {
  moneypathForecast?: (configYAML: string, optionsJSON: string) => string;
  moneypathMigrate?: (legacyYAML: string) => string;
  moneypathVersion?: () => string;
}

function bridgeGlobals(): MoneypathGlobals {
  return globalThis as unknown as MoneypathGlobals;
}

function bridgeReady(): boolean {
  const g = bridgeGlobals();
  return (
    typeof g.moneypathForecast === 'function' &&
    typeof g.moneypathMigrate === 'function' &&
    typeof g.moneypathVersion === 'function'
  );
}

async function instantiate(go: Go): Promise<WebAssembly.Instance> {
  const response = await fetch(wasmUrl.href);
  if (!response.ok) {
    throw new EngineError(
      `Could not download the moneypath engine (HTTP ${response.status} for ${wasmUrl.pathname}).`,
    );
  }
  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      const streamed = await WebAssembly.instantiateStreaming(response.clone(), go.importObject);
      return streamed.instance;
    } catch {
      // Falls through: several object stores serve .wasm with the wrong
      // content type, which makes streaming instantiation reject.
    }
  }
  const bytes = await response.arrayBuffer();
  const compiled = await WebAssembly.instantiate(bytes, go.importObject);
  return compiled.instance;
}

/** Give the Go runtime a beat to register its globals before we check. */
async function waitForBridge(attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (bridgeReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new EngineError(
    'The moneypath engine started but did not register its bridge functions.',
  );
}

/** Let the browser paint the busy state before we block the thread on Go. */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

class WasmEngine implements Engine {
  readonly kind = 'wasm' as const;

  version(): string {
    const fn = bridgeGlobals().moneypathVersion;
    return typeof fn === 'function' ? fn() : 'unknown';
  }

  async forecast(configYaml: string, options: ForecastOptions): Promise<ForecastResults> {
    const fn = bridgeGlobals().moneypathForecast;
    if (typeof fn !== 'function') throw new EngineError('The moneypath engine is not loaded.');
    await yieldToPaint();
    return decodeForecast(fn(configYaml, JSON.stringify(options)));
  }

  async migrate(legacyYaml: string): Promise<MigrateResult> {
    const fn = bridgeGlobals().moneypathMigrate;
    if (typeof fn !== 'function') throw new EngineError('The moneypath engine is not loaded.');
    await yieldToPaint();
    return decodeMigrate(fn(legacyYaml));
  }
}

export async function loadWasmEngine(): Promise<Engine> {
  if (typeof WebAssembly === 'undefined') {
    throw new EngineError('This browser does not support WebAssembly.');
  }
  const GoRuntime = (globalThis as unknown as { Go?: typeof Go }).Go;
  if (typeof GoRuntime !== 'function') {
    throw new EngineError('The Go WebAssembly runtime glue failed to load.');
  }
  const go = new GoRuntime();
  const instance = await instantiate(go);
  // `go.run` resolves only when the Go program exits; the module blocks
  // forever after registering its bridge, so we deliberately do not await it.
  void go.run(instance).catch(() => undefined);
  await waitForBridge();
  return new WasmEngine();
}
