/**
 * The engine seam. The Go engine, compiled to WebAssembly, is the only engine:
 * if it fails to load, the app shows a visible error state.
 */

import { EngineError, type Engine } from './types';
import { loadWasmEngine } from './wasmEngine';

export type EngineStatus =
  | { state: 'loading' }
  | { state: 'ready'; engine: Engine; version: string }
  | { state: 'failed'; message: string };

export async function loadEngine(): Promise<EngineStatus> {
  try {
    const engine = await loadWasmEngine();
    return { state: 'ready', engine, version: engine.version() };
  } catch (error) {
    const message =
      error instanceof EngineError
        ? error.message
        : `The moneypath engine failed to start: ${(error as Error).message}`;
    return { state: 'failed', message };
  }
}

export * from './types';
