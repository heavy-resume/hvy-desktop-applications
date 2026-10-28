import type { RecordConsumer } from './collection';
import { WebAutomationError } from './errors';
import { createRecordSink, type RecordSinkConfig } from './recordSink';
import { createSqlItemStore, validateSqlItemStore, type SqlItemDatabase, type SqlItemStoreConfig } from './sqlItemStore';

/**
 * A copy of a document's database, opened for one use: the reference implementation's scripting database
 * (`createScriptingDbRuntime`), which saves each write back into the document's attachment.
 */
export interface OpenedDatabase {
  api: SqlItemDatabase;
  dispose(): void;
}

const turns = new WeakMap<object, Promise<unknown>>();

/**
 * Uses a document's database, one use at a time per document, each on a fresh copy. A write saves its whole copy
 * back, so a copy kept open would overwrite what a script's `doc.db` wrote in the meantime (an evaluation result
 * arriving during a collection run), and two copies open at once would overwrite each other.
 */
export function useDocumentDatabase<T>(document: object, open: () => Promise<OpenedDatabase>, use: (db: SqlItemDatabase) => T): Promise<T> {
  const turn = (turns.get(document) ?? Promise.resolve()).then(async () => {
    const opened = await open();
    try {
      return use(opened.api);
    } finally {
      opened.dispose();
    }
  });
  turns.set(document, turn.catch(() => undefined));
  return turn;
}

/**
 * A collection's records into a table of the document's database. The table is checked when a run opens it, and
 * the run waits for its records' writes before it is done: a write that fails fails the run with why.
 */
export function createSqlRecordConsumer(
  document: object,
  open: () => Promise<OpenedDatabase>,
  config: SqlItemStoreConfig,
  policy: RecordSinkConfig,
  onWritten: () => void,
): RecordConsumer {
  // What the table held when the run opened it, and what the run wrote since: a run asks this for every listed link.
  const states = new Map<string, string>();
  const writes: Promise<void>[] = [];
  const use = <T>(work: (db: SqlItemDatabase) => T) => useDocumentDatabase(document, open, work);
  return {
    open: () => use((db) => {
      const problems = validateSqlItemStore(db, config);
      if (problems.length) throw new WebAutomationError('invalid_request', problems.join(' '));
      states.clear();
      for (const item of createSqlItemStore(db, config).list()) states.set(item.key, item.state);
    }),
    isKnown: (key) => policy.onExisting === 'keep' && states.get(key) === 'ok',
    onRecord: (record) => {
      writes.push(use((db) => {
        const store = createSqlItemStore(db, config);
        createRecordSink(store, policy).onRecord(record);
        const state = store.get(record.key)?.state;
        if (state) states.set(record.key, state);
      }).then(onWritten));
    },
    close: async () => {
      const results = await Promise.allSettled(writes.splice(0));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason;
    },
  };
}
