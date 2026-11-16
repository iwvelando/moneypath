/**
 * Test setup.
 *
 * Node 26 defines a `localStorage` global that resolves to
 * `undefined` unless `--localstorage-file` is passed, and it shadows jsdom's
 * implementation. The app treats storage as optional, but the persistence
 * tests need a real one, so install a minimal in-memory Storage when the
 * environment does not provide a working localStorage.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => void entries.delete(key),
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
  } as Storage;
}

function install(name: 'localStorage' | 'sessionStorage'): void {
  let existing: unknown;
  try {
    existing = (globalThis as Record<string, unknown>)[name];
  } catch {
    existing = undefined;
  }
  if (existing) return;
  const store = memoryStorage();
  Object.defineProperty(globalThis, name, { configurable: true, get: () => store });
}

install('localStorage');
install('sessionStorage');

/**
 * The app fetches its engine over HTTP, and no server runs under the unit
 * tests. Answer that one request from the engine build on disk, so the tests
 * run the same Go code the site ships; everything else still reaches `fetch`.
 */
const engineFile = resolve(import.meta.dirname, '../engine/moneypath.wasm');
const realFetch = globalThis.fetch;
let engineBytes: Buffer | undefined;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.endsWith('/moneypath.wasm')) return realFetch(input, init);
  engineBytes ??= readFileSync(engineFile);
  return new Response(new Uint8Array(engineBytes), { headers: { 'Content-Type': 'application/wasm' } });
};

/** Keys currently held by a Storage, without relying on own-property exposure. */
export function storageKeys(store: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}
