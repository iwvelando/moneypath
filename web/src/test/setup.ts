/**
 * Test setup. Node 26 defines a `localStorage` global that resolves to
 * `undefined` unless `--localstorage-file` is passed, and it shadows jsdom's
 * implementation. The app treats storage as optional, but the persistence
 * tests need a real one, so install a minimal in-memory Storage when the
 * environment does not provide a working localStorage.
 */

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

/** Keys currently held by a Storage, without relying on own-property exposure. */
export function storageKeys(store: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}
