import { WebAutomationError } from './errors';
import { SQL_IDENTIFIER, type SqlItemDatabase } from './sqlItemStore';

/**
 * Ranking by similarity (docs/job-search/10-skill-matching.md): scores the rows a query returns by how similar one of
 * their text columns is to a query, and writes the scores into a column. It knows nothing about what the rows are. SQL
 * does the filtering and sorting; this does the one thing SQL can't.
 */

/** The table, in the document's database, where each text's vector is kept, so a text is embedded once per source. */
export const SIMILARITY_VECTORS_TABLE = '__galaxy_similarity_vectors';

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

/** Writes each row's score (by key) into a column of a table, in one statement; a row in `keys` with no score gets null. */
function writeScores(db: SqlItemDatabase, write: { table: string; key: string; column: string }, scores: Record<string, number | null>): void {
  const table = identifier(write.table, 'table');
  const keyColumn = identifier(write.key, 'key column');
  const scoreColumn = identifier(write.column, 'score column');
  db.execute(
    `UPDATE ${table} SET ${scoreColumn} = (SELECT value FROM json_each(?) WHERE json_each.key = ${table}.${keyColumn}) WHERE ${keyColumn} IN (SELECT key FROM json_each(?))`,
    [JSON.stringify(scores), JSON.stringify(scores)],
  );
}

/**
 * Scores the rows `request.rows` returns: each row's text against the query, by cosine similarity of their vectors.
 * Texts already embedded by this source are not embedded again (the query's too: a resume's sections are the same from
 * one ranking to the next). Every score is written in one statement.
 */
export async function rankRows(useDatabase: UseDatabase, source: EmbeddingSource, request: RankRequest): Promise<RankResult> {
  // Checked before anything is embedded.
  for (const [value, role] of [[request.write.table, 'table'], [request.write.key, 'key column'], [request.write.column, 'score column']]) identifier(value, role);
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
    writeScores(db, request.write, scores);
    return { scored: scoredRows.length, embedded: embedded.length };
  });
}

/**
 * Matching by the words in short texts, with nothing sent anywhere: scores the rows a query returns
 * by how alike one of their text columns is to the closest of some examples (job titles to the ones flagged). Texts
 * are compared by their words and the three-letter pieces of them, weighted by how rare each is among the texts here,
 * so "frontend engineer" is close to "front end engineer" and "senior frontend developer", and a word every text has
 * counts for little. A score is 0 to 1, 1 for a text the same as an example. Without examples, no row has a score.
 */
export interface MatchRequest {
  /** A query returning the rows to score: their key and their text. */
  rows: string;
  key: string;
  text: string;
  /** A query returning the examples: their text, in its first column. */
  examples: string;
  write: { table: string; key: string; column: string };
}

/**
 * A text's parts, each with its weight: its words, and each word's three-letter pieces (with its edges, so a short word
 * has some). A word's pieces together weigh as much as the word, so a long word counts for no more than a short one.
 * Each two words together are a word too, as sites write them either way ("front end", "frontend").
 */
export function textFeatures(text: string): Array<[feature: string, weight: number]> {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const joined = words.slice(1).map((word, index) => `${words[index]}${word}`);
  return [...words.flatMap((word): Array<[string, number]> => {
    const padded = ` ${word} `;
    const pieces = Array.from({ length: Math.max(padded.length - 2, 0) }, (_, index) => `#${padded.slice(index, index + 3)}`);
    return [[word, 1], ...pieces.map((piece): [string, number] => [piece, 1 / pieces.length])];
  }), ...joined.map((word): [string, number] => [word, 1])];
}

function weighted(features: Array<[string, number]>, rarity: Map<string, number>): Map<string, number> {
  const vector = new Map<string, number>();
  for (const [feature, weight] of features) vector.set(feature, (vector.get(feature) ?? 0) + weight * (rarity.get(feature) ?? 0));
  return vector;
}

function sparseCosine(left: Map<string, number>, right: Map<string, number>): number {
  let dot = 0;
  for (const [feature, weight] of left) dot += weight * (right.get(feature) ?? 0);
  const norm = (vector: Map<string, number>) => Math.sqrt([...vector.values()].reduce((sum, weight) => sum + weight * weight, 0));
  const lengths = norm(left) * norm(right);
  return lengths ? dot / lengths : 0;
}

/** Scores the rows `request.rows` returns against the closest example, and writes every score in one statement. */
export function matchRows(useDatabase: UseDatabase, request: MatchRequest): Promise<{ scored: number; examples: number }> {
  for (const [value, role] of [[request.write.table, 'table'], [request.write.key, 'key column'], [request.write.column, 'score column']]) identifier(value, role);
  return useDatabase((db) => {
    const rows = db.query(request.rows).map((row) => {
      if (!(request.key in row) || !(request.text in row)) {
        throw new WebAutomationError('invalid_request', `The rows query must return the columns "${request.key}" and "${request.text}".`);
      }
      return { key: String(row[request.key]), features: textFeatures(String(row[request.text] ?? '')) };
    });
    const examples = db.query(request.examples).map((row) => textFeatures(String(Object.values(row)[0] ?? ''))).filter((features) => features.length);
    // How rare each part is among the texts here: a part in every text weighs least.
    const texts = [...rows.map((row) => row.features), ...examples];
    const counts = new Map<string, number>();
    for (const features of texts) for (const feature of new Set(features.map(([feature]) => feature))) counts.set(feature, (counts.get(feature) ?? 0) + 1);
    const rarity = new Map([...counts].map(([feature, count]) => [feature, Math.log((texts.length + 1) / (count + 1)) + 1]));
    const exampleVectors = examples.map((features) => weighted(features, rarity));
    const scores = Object.fromEntries(rows.map((row) => {
      const vector = weighted(row.features, rarity);
      return [row.key, exampleVectors.length && row.features.length ? Math.max(...exampleVectors.map((example) => sparseCosine(vector, example))) : null];
    }));
    writeScores(db, request.write, scores);
    return { scored: rows.length, examples: examples.length };
  });
}
