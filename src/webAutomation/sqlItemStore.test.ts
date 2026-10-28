import { describe, expect, it } from 'vitest';
import { createScriptingDbRuntime } from '../../../heavy-file-format/src/plugins/db-table';
import { deserializeDocument } from '../../../heavy-file-format/src/serialization';
import { createRecordSink } from './recordSink';
import { createSqlItemStore, validateSqlItemStore, type SqlItemStoreConfig } from './sqlItemStore';
import { createSqlRecordConsumer } from './sqlSink';

const JOBS_TABLE = `CREATE TABLE jobs (
  job_key TEXT PRIMARY KEY, record TEXT, url TEXT, title TEXT, company TEXT, description TEXT, collected_at TEXT,
  evaluation TEXT DEFAULT 'Not evaluated', match REAL
)`;

const CONFIG: SqlItemStoreConfig = {
  kind: 'sql',
  table: 'jobs',
  keyColumn: 'job_key',
  recordColumn: 'record',
  columns: { url: 'url', title: 'title', company: 'company', description: 'description' },
  collectedAtColumn: 'collected_at',
};

const record = (key: string, values: Record<string, unknown>, collectedAt = Date.UTC(2026, 9, 27)) => ({
  key, url: key, values, provenance: { sourceUrl: key, collectedAt, patternId: 'p' }, state: 'ok' as const,
});

async function jobsDatabase(table = JOBS_TABLE) {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const { api } = await createScriptingDbRuntime(document);
  api.execute(table);
  return { document, db: api };
}

describe('SQL item store', () => {
  it('writes records as rows, keeping the table\'s own columns, and reads them back', async () => {
    const { db } = await jobsDatabase();
    const store = createSqlItemStore(db, CONFIG);
    const sink = createRecordSink(store, { onExisting: 'refresh', keepGoodOnFailure: true, ownedFields: ['title', 'company', 'description'] });
    sink.onRecord(record('https://jobs.test/1', { title: 'Engineer', company: 'Acme', description: 'Build things.', ignored: 'x' }));
    sink.onRecord(record('https://jobs.test/2', { title: 'Designer', description: 'Design things.' }));

    expect(store.list().map((item) => item.key)).toEqual(['https://jobs.test/1', 'https://jobs.test/2']);
    expect(store.get('https://jobs.test/1')).toMatchObject({
      url: 'https://jobs.test/1',
      state: 'ok',
      provenance: { patternId: 'p' },
      fields: { url: 'https://jobs.test/1', title: 'Engineer', company: 'Acme', description: 'Build things.' },
    });
    expect(store.get('https://jobs.test/1')?.fields.ignored).toBeUndefined();
    // A new row keeps the document's defaults for the columns the store doesn't write.
    expect(db.query('SELECT evaluation, collected_at FROM jobs WHERE job_key = ?', ['https://jobs.test/2'])[0]).toMatchObject({
      evaluation: 'Not evaluated',
      collected_at: '2026-10-27T00:00:00.000Z',
    });
  });

  it('refreshes a row in place: one row per key, the document\'s columns and when it was found untouched', async () => {
    const { db } = await jobsDatabase();
    const store = createSqlItemStore(db, CONFIG);
    const sink = createRecordSink(store, { onExisting: 'refresh', keepGoodOnFailure: true });
    sink.onRecord(record('https://jobs.test/1', { title: 'Engineer', description: 'Build things.' }));
    db.execute("UPDATE jobs SET evaluation = 'Evaluated', match = 0.8");

    sink.onRecord(record('https://jobs.test/1', { title: 'Senior Engineer', description: 'Build more things.' }, Date.UTC(2026, 10, 1)));

    expect(db.query('SELECT title, evaluation, match, collected_at FROM jobs')).toEqual([
      expect.objectContaining({ title: 'Senior Engineer', evaluation: 'Evaluated', match: 0.8, collected_at: '2026-10-27T00:00:00.000Z' }),
    ]);
  });

  it('skips known good rows with keep, so a run skips their pages', async () => {
    const { db } = await jobsDatabase();
    const sink = createRecordSink(createSqlItemStore(db, CONFIG), { onExisting: 'keep', keepGoodOnFailure: true });
    sink.onRecord(record('https://jobs.test/1', { title: 'Engineer', description: 'Build things.' }));
    expect(sink.isKnown('https://jobs.test/1')).toBe(true);
    expect(sink.onRecord(record('https://jobs.test/1', { title: 'Changed' }))).toBe('kept');
    expect(db.query('SELECT title FROM jobs')[0].title).toBe('Engineer');
  });

  it('says what the document\'s table is missing', async () => {
    const empty = await jobsDatabase('CREATE TABLE other (id INTEGER)');
    expect(validateSqlItemStore(empty.db, CONFIG)).toEqual(['The document\'s database has no table "jobs".']);

    const partial = await jobsDatabase('CREATE TABLE jobs (job_key TEXT, record TEXT, url TEXT, title TEXT)');
    expect(validateSqlItemStore(partial.db, CONFIG)).toEqual([
      'Table "jobs" has no column "company" for field "company".',
      'Table "jobs" has no column "description" for field "description".',
      'Table "jobs" has no column "collected_at" for when an item was found.',
      'Table "jobs" must make "job_key" unique (a primary key or a unique column), so each item is one row.',
    ]);

    const complete = await jobsDatabase();
    expect(validateSqlItemStore(complete.db, CONFIG)).toEqual([]);
  });
});

describe('collecting into a table of the document\'s database', () => {
  const policy = { onExisting: 'keep' as const, keepGoodOnFailure: true };

  it('checks the table when a run opens it, and knows the rows it already has', async () => {
    const { document } = await jobsDatabase();
    const open = () => createScriptingDbRuntime(document);
    const seed = createSqlRecordConsumer(document, open, CONFIG, policy, () => undefined);
    await seed.open!();
    seed.onRecord(record('https://jobs.test/1', { title: 'Engineer', description: 'Build things.' }));
    await seed.close!();

    const written: string[] = [];
    const consumer = createSqlRecordConsumer(document, open, CONFIG, policy, () => written.push('written'));
    await consumer.open!();
    expect(consumer.isKnown!('https://jobs.test/1')).toBe(true);
    consumer.onRecord(record('https://jobs.test/2', { title: 'Designer', description: 'Design things.' }));
    expect(consumer.isKnown!('https://jobs.test/2')).toBe(false);
    await consumer.close!();
    expect(written).toEqual(['written']);
    expect(consumer.isKnown!('https://jobs.test/2')).toBe(true);

    const { api } = await createScriptingDbRuntime(document);
    expect(api.query('SELECT job_key FROM jobs ORDER BY job_key').map((row) => row.job_key)).toEqual(['https://jobs.test/1', 'https://jobs.test/2']);
  });

  it('fails the run\'s open with what the table is missing', async () => {
    const { document } = await jobsDatabase('CREATE TABLE jobs (job_key TEXT PRIMARY KEY, record TEXT)');
    const consumer = createSqlRecordConsumer(document, () => createScriptingDbRuntime(document), CONFIG, policy, () => undefined);
    await expect(consumer.open!()).rejects.toThrow('Table "jobs" has no column "url" for field "url".');
  });

  it('keeps a script\'s write made during a run: each write opens a fresh copy', async () => {
    const { document } = await jobsDatabase();
    const open = () => createScriptingDbRuntime(document);
    const consumer = createSqlRecordConsumer(document, open, CONFIG, policy, () => undefined);
    await consumer.open!();
    consumer.onRecord(record('https://jobs.test/1', { title: 'Engineer', description: 'Build things.' }));
    await consumer.close!();

    // An evaluation result arriving through doc.db while the run goes on.
    const script = await createScriptingDbRuntime(document);
    script.api.execute("UPDATE jobs SET evaluation = 'Evaluated' WHERE job_key = ?", ['https://jobs.test/1']);
    script.dispose();
    consumer.onRecord(record('https://jobs.test/2', { title: 'Designer', description: 'Design things.' }));
    await consumer.close!();

    const { api } = await createScriptingDbRuntime(document);
    expect(api.query('SELECT job_key, evaluation FROM jobs ORDER BY job_key')).toEqual([
      expect.objectContaining({ job_key: 'https://jobs.test/1', evaluation: 'Evaluated' }),
      expect.objectContaining({ job_key: 'https://jobs.test/2', evaluation: 'Not evaluated' }),
    ]);
  });
});
