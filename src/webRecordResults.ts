const documentRecordResults = new WeakMap<object, Map<string, unknown[]>>();

function documentCache(document: object): Map<string, unknown[]> {
  let cache = documentRecordResults.get(document);
  if (!cache) {
    cache = new Map();
    documentRecordResults.set(document, cache);
  }
  return cache;
}

export function hasWebRecordResults(document: object, blockId: string): boolean {
  return documentCache(document).has(blockId);
}

export function getWebRecordResults(document: object, blockId: string): unknown[] {
  return documentCache(document).get(blockId) ?? [];
}

export function setWebRecordResults(document: object, blockId: string, records: unknown[]): void {
  documentCache(document).set(blockId, records);
}

export function clearWebRecordResults(document: object): void {
  documentRecordResults.delete(document);
}
