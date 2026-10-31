import { describe, expect, it } from 'vitest';
import { createScriptingDbRuntime } from '../../../heavy-file-format/src/plugins/db-table';
import { deserializeDocument } from '../../../heavy-file-format/src/serialization';
import { rankRows, SIMILARITY_VECTORS_TABLE, type EmbeddingSource, type RankRequest, type UseDatabase } from './similarity';
import type { SqlItemDatabase } from './sqlItemStore';

// Each text is a point on a plane: its vector is fixed by the words it has, so the ranking is known.
const WORDS: Record<string, [number, number]> = { typescript: [1, 0], react: [0.8, 0.2], python: [0, 1], go: [0.1, 0.9] };

function fakeSource(id = 'fake/model-1'): EmbeddingSource & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    id,
    calls,
    embed: async (texts) => {
      calls.push(texts);
      return texts.map((text) => text.toLowerCase().split(/\W+/).reduce<[number, number]>((sum, word) => {
        const [x, y] = WORDS[word] ?? [0, 0];
        return [sum[0] + x, sum[1] + y];
      }, [0, 0]));
    },
  };
}

async function jobsDatabase() {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const { api } = await createScriptingDbRuntime(document);
  api.execute('CREATE TABLE jobs (job_key TEXT PRIMARY KEY, skills TEXT, evaluation TEXT, match REAL)');
  for (const [key, skills, evaluation] of [['ts', 'TypeScript', 'Not evaluated'], ['web', 'TypeScript React', 'Not evaluated'], ['py', 'Python', 'Not evaluated'], ['go', 'Go', 'Evaluated'], ['none', '', 'Not evaluated']]) {
    api.execute('INSERT INTO jobs (job_key, skills, evaluation) VALUES (?, ?, ?)', [key, skills, evaluation]);
  }
  const use: UseDatabase = async <T>(work: (db: SqlItemDatabase) => T) => work(api);
  return { db: api, use };
}

const request = (overrides: Partial<RankRequest> = {}): RankRequest => ({
  rows: "SELECT job_key, skills FROM jobs WHERE evaluation = 'Not evaluated'",
  key: 'job_key',
  text: 'skills',
  query: 'TypeScript',
  write: { table: 'jobs', key: 'job_key', column: 'match' },
  ...overrides,
});

const matches = (db: SqlItemDatabase) => Object.fromEntries(db.query('SELECT job_key, match FROM jobs ORDER BY job_key').map((row) => [row.job_key, row.match === null ? null : Number(Number(row.match).toFixed(3))]));

describe('ranking by similarity', () => {
  it('scores only the rows its query returns, by cosine similarity to the query, and writes every score', async () => {
    const { db, use } = await jobsDatabase();
    const source = fakeSource();
    expect(await rankRows(use, source, request())).toEqual({ scored: 3, embedded: 3 });
    // Go is filtered out by the rows query, and a row with no text gets no score.
    expect(matches(db)).toEqual({ go: null, none: null, py: 0, ts: 1, web: 0.994 });
    // The query and each row's text, in one batch; a text the same as the query is embedded once.
    expect(source.calls).toEqual([['TypeScript', 'TypeScript React', 'Python']]);
  });

  it('embeds each text once per source, the query too, and again for another source', async () => {
    const { db, use } = await jobsDatabase();
    const source = fakeSource();
    await rankRows(use, source, request());
    db.execute("UPDATE jobs SET evaluation = 'Not evaluated' WHERE job_key = 'go'");
    expect(await rankRows(use, source, request())).toEqual({ scored: 4, embedded: 1 });
    expect(source.calls.at(-1)).toEqual(['Go']);
    expect(matches(db).go).toBeCloseTo(0.11, 2);
    // Another model's vectors are not comparable: it embeds everything again, and keeps its own.
    const other = fakeSource('fake/model-2');
    expect(await rankRows(use, other, request())).toEqual({ scored: 4, embedded: 4 });
    expect(db.query(`SELECT model, COUNT(*) AS kept FROM ${SIMILARITY_VECTORS_TABLE} GROUP BY model ORDER BY model`)).toEqual([
      expect.objectContaining({ model: 'fake/model-1', kept: 4 }),
      expect.objectContaining({ model: 'fake/model-2', kept: 4 }),
    ]);
  });

  it('refuses a write target that is not an identifier, rows without the named columns, and an empty query', async () => {
    const { use } = await jobsDatabase();
    await expect(rankRows(use, fakeSource(), request({ write: { table: 'jobs; DROP TABLE jobs', key: 'job_key', column: 'match' } }))).rejects.toThrow('is not a valid table');
    await expect(rankRows(use, fakeSource(), request({ rows: 'SELECT job_key FROM jobs' }))).rejects.toThrow('must return the columns "job_key" and "skills"');
    await expect(rankRows(use, fakeSource(), request({ query: '  ' }))).rejects.toThrow('no query text');
  });

  it('fails when the source does not return one vector per text, and writes nothing', async () => {
    const { db, use } = await jobsDatabase();
    const short: EmbeddingSource = { id: 'short', embed: async (texts) => texts.slice(1).map(() => [1, 0]) };
    await expect(rankRows(use, short, request())).rejects.toThrow('one vector per text');
    expect(Object.values(matches(db)).every((match) => match === null)).toBe(true);
  });
});
