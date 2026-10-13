import type { RecordConsumer } from './collection';
import type { CollectedRecord, CollectedRecordProvenance, CollectedRecordState } from './records';

/**
 * One item in the document. All of its fields live together, as they do in
 * a template instance; which ones a collection may write is decided by the
 * sink's configuration, not by the item's shape.
 */
export interface DocumentItem {
  key: string;
  url: string;
  fields: Record<string, unknown>;
  provenance: CollectedRecordProvenance;
  state: CollectedRecordState;
  problem?: string;
}

/**
 * Where items live. The real implementation writes component-list items
 * from a reusable template through the HVY CLI; the memory store backs tests.
 */
export interface DocumentItemStore {
  get(key: string): DocumentItem | null;
  list(): DocumentItem[];
  put(item: DocumentItem): void;
}

export interface RecordSinkConfig {
  /**
   * Fields records may write. Everything else on an item (status, notes,
   * results written by other glue) is never touched. Absent: every value
   * a record carries.
   */
  ownedFields?: string[];
  /** A known, good item: `keep` skips it (and lets runs skip its page); `refresh` rewrites its owned fields. */
  onExisting: 'keep' | 'refresh';
  /** A failed record for a key that is already good leaves the good item as it is. */
  keepGoodOnFailure: boolean;
}

export const DEFAULT_RECORD_SINK_CONFIG: RecordSinkConfig = { onExisting: 'keep', keepGoodOnFailure: true };

export type RecordSinkOutcome = 'appended' | 'refreshed' | 'kept';

export interface RecordSink extends RecordConsumer {
  /** Lets a collection run skip pages whose records would be ignored anyway. */
  isKnown(key: string): boolean;
  onRecord(record: CollectedRecord): RecordSinkOutcome;
}

function owned(values: Record<string, unknown>, ownedFields: string[] | undefined): Record<string, unknown> {
  return ownedFields ? Object.fromEntries(Object.entries(values).filter(([name]) => ownedFields.includes(name))) : { ...values };
}

export function createRecordSink(store: DocumentItemStore, config: RecordSinkConfig = DEFAULT_RECORD_SINK_CONFIG): RecordSink {
  return {
    isKnown: (key) => config.onExisting === 'keep' && store.get(key)?.state === 'ok',
    onRecord: (record) => {
      const existing = store.get(record.key);
      if (existing && existing.state === 'ok' && (config.onExisting === 'keep' || (record.state !== 'ok' && config.keepGoodOnFailure))) {
        return 'kept';
      }
      store.put({
        key: record.key,
        url: record.url,
        fields: { ...(existing?.fields ?? {}), ...owned(record.values, config.ownedFields) },
        provenance: record.provenance,
        state: record.state,
        ...(record.problem ? { problem: record.problem } : {}),
      });
      return existing ? 'refreshed' : 'appended';
    },
  };
}

/** For other glue (such as a queue result handler) writing its own fields onto an item. */
export function updateItemFields(store: DocumentItemStore, key: string, patch: Record<string, unknown>): boolean {
  const existing = store.get(key);
  if (!existing) return false;
  store.put({ ...existing, fields: { ...existing.fields, ...patch } });
  return true;
}

export function createMemoryItemStore(initial: DocumentItem[] = []): DocumentItemStore {
  const items = new Map(initial.map((item) => [item.key, structuredClone(item)]));
  return {
    get: (key) => {
      const item = items.get(key);
      return item ? structuredClone(item) : null;
    },
    list: () => [...items.values()].map((item) => structuredClone(item)),
    put: (item) => {
      items.set(item.key, structuredClone(item));
    },
  };
}
