import { beforeEach } from 'vitest';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(String(key)) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(String(key));
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    },
  };
}

const local = memoryStorage();
const session = memoryStorage();

function installBrowserStorage(): void {
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: local },
    sessionStorage: { configurable: true, value: session },
  });
}

installBrowserStorage();

beforeEach(() => {
  local.clear();
  session.clear();
  installBrowserStorage();
});
