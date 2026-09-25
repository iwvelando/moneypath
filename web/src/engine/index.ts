/**
 * The engine seam.
 *
 * Production: only the wasm engine is acceptable. If it fails to load, the app
 * shows a visible error state — never a silent mock.
 *
 * Development: a wasm failure falls back to the TypeScript mock so the UI is
 * still exercisable while the Go module is being built. `?mockEngine` in the
 * query string forces the mock in any build for manual testing, and the UI
 * always labels a mock-backed session.
 */

import { createMockEngine } from './mockEngine';
import { EngineError, type Engine } from './types';
import { loadWasmEngine } from './wasmEngine';

export type EngineStatus =
  | { state: 'loading' }
  | { state: 'ready'; engine: Engine; version: string; fallbackReason?: string }
  | { state: 'failed'; message: string };

function mockForced(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('mockEngine') && params.get('mockEngine') !== 'false';
}

export async function loadEngine(
  options: { search?: string; allowMockFallback?: boolean } = {},
): Promise<EngineStatus> {
  const search = options.search ?? (typeof location !== 'undefined' ? location.search : '');
  const allowMockFallback = options.allowMockFallback ?? import.meta.env.DEV;

  if (mockForced(search)) {
    const engine = createMockEngine();
    return {
      state: 'ready',
      engine,
      version: engine.version(),
      fallbackReason: 'Mock engine forced via ?mockEngine — results are synthetic.',
    };
  }

  try {
    const engine = await loadWasmEngine();
    return { state: 'ready', engine, version: engine.version() };
  } catch (error) {
    const message =
      error instanceof EngineError
        ? error.message
        : `The moneypath engine failed to start: ${(error as Error).message}`;
    if (!allowMockFallback) {
      return { state: 'failed', message };
    }
    const engine = createMockEngine();
    return {
      state: 'ready',
      engine,
      version: engine.version(),
      fallbackReason: `${message} Falling back to the development mock engine — results are synthetic.`,
    };
  }
}

export * from './types';
