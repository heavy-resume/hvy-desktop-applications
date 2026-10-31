import { WebAutomationError } from './errors';
import { SQL_IDENTIFIER, type SqlItemDatabase } from './sqlItemStore';

/**
 * Ranking by similarity (docs/job-search/10-skill-matching.md): scores the rows a query returns by how similar one of
 * their text columns is to a query, and writes the scores into a column. It knows nothing about what the rows are. SQL
 * does the filtering and sorting; this does the one thing SQL can't.
 */

/** The table, in the document's database, where each text's vector is kept, so a text is embedded once per source. */
export const SIMILARITY_VECTORS_TABLE = 'similarity_vectors';

/**
 * Turns texts into vectors, one per text, in order. Its id names where the vectors come from and with what model:
 * vectors from different sources are never compared, and changing the source embeds the texts again.
 */
export interface EmbeddingSource {
  id: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface RankRequest {
  /** A query returning the rows to score: their key and their text. Only these rows are embedded and scored. */
  rows: string;
  /** The column of `rows` that identifies a row. */
  key: string;
  /** The column of `rows` whose text is compared with the query. A row with no text gets no score. */
  text: string;
  query: string;
  /** Where each row's score goes: the column of a table, by its key column. */
  write: { table: string; key: string; column: string };
}

export interface RankResult {
  /** Rows given a score. */
  scored: number;
  /** Texts embedded by this ranking (the rest were already kept). */
  embedded: number;
}

/** Uses the document's database: each use on a fresh copy, one at a time (sqlSink's useDocumentDatabase). */
export type UseDatabase = <T>(use: (db: SqlItemDatabase) => T) => Promise<T>;

/** Texts sent to the embedding source at once. */
const EMBED_BATCH = 64;

function identifier(value: string, role: string): string {
  if (!SQL_IDENTIFIER.test(value)) throw new WebAutomationError('invalid_request', `"${value}" is not a valid ${role}.`);
  return `"${value}"`;
}

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Vectors are kept as 32-bit floats, a quarter the size of their JSON.
function encodeVector(vector: number[]): Uint8Array {
  return new Uint8Array(Float32Array.from(vector).buffer);
}

function decodeVector(bytes: unknown): Float32Array {
  if (!(bytes instanceof Uint8Array)) throw new WebAutomationError('invalid_request', `A kept vector in ${SIMILARITY_VECTORS_TABLE} is not bytes.`);
  // A copy, so the floats start on a 4-byte boundary.
  return new Float32Array(bytes.slice().buffer);
}

function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) throw new WebAutomationError('invalid_request', 'Vectors of different lengths cannot be compared.');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

/**
 * Scores the rows `request.rows` returns: each row's text against the query, by cosine similarity of their vectors.
 * Texts already embedded by this source are not embedded again (the query's too: a resume's sections are the same from
 * one ranking to the next). Every score is written in one statement.
 */
export async function rankRows(useDatabase: UseDatabase, source: EmbeddingSource, request: RankRequest): Promise<RankResult> {
  const table = identifier(request.write.table, 'table');
  const keyColumn = identifier(request.write.key, 'key column');
  const scoreColumn = identifier(request.write.column, 'score column');
  if (!request.query.trim()) throw new WebAutomationError('invalid_request', 'There is no query text to rank by.');

  const rows = await useDatabase((db) => {
    db.execute(`CREATE TABLE IF NOT EXISTS ${SIMILARITY_VECTORS_TABLE} (text_hash TEXT NOT NULL, model TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (text_hash, model))`);
    return db.query(request.rows).map((row) => {
      if (!(request.key in row) || !(request.text in row)) {
        throw new WebAutomationError('invalid_request', `The rows query must return the columns "${request.key}" and "${request.text}".`);
      }
      return { key: String(row[request.key]), text: String(row[request.text] ?? '').trim() };
    });
  });
  const scoredRows = rows.filter((row) => row.text);
  const texts = [...new Set([request.query, ...scoredRows.map((row) => row.text)])];
  const hashes = new Map<string, string>(await Promise.all(texts.map(async (text) => [text, await sha256(text)] as [string, string])));

  const kept = await useDatabase((db) => new Set(db.query(
    `SELECT text_hash FROM ${SIMILARITY_VECTORS_TABLE} WHERE model = ? AND text_hash IN (SELECT value FROM json_each(?))`,
    [source.id, JSON.stringify([...hashes.values()])],
  ).map((row) => String(row.text_hash))));
  const missing = texts.filter((text) => !kept.has(hashes.get(text)!));
  const embedded: Array<[string, number[]]> = [];
  for (let start = 0; start < missing.length; start += EMBED_BATCH) {
    const batch = missing.slice(start, start + EMBED_BATCH);
    const vectors = await source.embed(batch);
    if (vectors.length !== batch.length) throw new WebAutomationError('invalid_request', 'The embedding source did not return one vector per text.');
    batch.forEach((text, index) => embedded.push([hashes.get(text)!, vectors[index]]));
  }

  return useDatabase((db) => {
    for (const [hash, vector] of embedded) {
      db.execute(`INSERT OR REPLACE INTO ${SIMILARITY_VECTORS_TABLE} (text_hash, model, vector) VALUES (?, ?, ?)`, [hash, source.id, encodeVector(vector)]);
    }
    const vectors = new Map(db.query(
      `SELECT text_hash, vector FROM ${SIMILARITY_VECTORS_TABLE} WHERE model = ? AND text_hash IN (SELECT value FROM json_each(?))`,
      [source.id, JSON.stringify([...hashes.values()])],
    ).map((row) => [String(row.text_hash), decodeVector(row.vector)]));
    const query = vectors.get(hashes.get(request.query)!)!;
    const scores = Object.fromEntries(scoredRows.map((row) => [row.key, cosine(query, vectors.get(hashes.get(row.text)!)!)]));
    db.execute(
      `UPDATE ${table} SET ${scoreColumn} = (SELECT value FROM json_each(?) WHERE json_each.key = ${table}.${keyColumn}) WHERE ${keyColumn} IN (SELECT key FROM json_each(?))`,
      [JSON.stringify(scores), JSON.stringify(scores)],
    );
    return { scored: scoredRows.length, embedded: embedded.length };
  });
}
