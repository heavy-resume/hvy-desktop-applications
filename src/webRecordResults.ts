interface WebRecordResultCache {
  records: Map<string, unknown[]>;
  listeners: Map<string, Set<() => void>>;
}

const documentRecordResults = new WeakMap<object, WebRecordResultCache>();
const sessionRecordResults = new Map<string, WebRecordResultCache>();
const documentSessionKeys = new WeakMap<object, string>();

function createCache(): WebRecordResultCache {
  return { records: new Map(), listeners: new Map() };
}

function documentCache(document: object, sessionKey?: string): WebRecordResultCache {
  const normalizedSessionKey = sessionKey?.trim() || documentSessionKeys.get(document);
  if (normalizedSessionKey) {
    documentSessionKeys.set(document, normalizedSessionKey);
    let cache = sessionRecordResults.get(normalizedSessionKey);
    if (!cache) {
      cache = createCache();
      sessionRecordResults.set(normalizedSessionKey, cache);
    }
    documentRecordResults.set(document, cache);
    return cache;
  }
  let cache = documentRecordResults.get(document);
  if (!cache) {
    cache = createCache();
    documentRecordResults.set(document, cache);
  }
  return cache;
}

export function hasWebRecordResults(document: object, resultKey: string, sessionKey?: string): boolean {
  return documentCache(document, sessionKey).records.has(resultKey);
}

export function getWebRecordResults(document: object, resultKey: string, sessionKey?: string): unknown[] {
  return documentCache(document, sessionKey).records.get(resultKey) ?? [];
}

export function setWebRecordResults(document: object, resultKey: string, records: unknown[], sessionKey?: string): void {
  const cache = documentCache(document, sessionKey);
  cache.records.set(resultKey, records);
  cache.listeners.get(resultKey)?.forEach((listener) => listener());
}

export function subscribeWebRecordResults(
  document: object,
  resultKey: string,
  listener: () => void,
  sessionKey?: string,
): () => void {
  const cache = documentCache(document, sessionKey);
  const listeners = cache.listeners.get(resultKey) ?? new Set<() => void>();
  listeners.add(listener);
  cache.listeners.set(resultKey, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) cache.listeners.delete(resultKey);
  };
}

export function clearWebRecordResults(document: object): void {
  const sessionKey = documentSessionKeys.get(document);
  if (sessionKey) sessionRecordResults.delete(sessionKey);
  documentSessionKeys.delete(document);
  documentRecordResults.delete(document);
}
