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
 * The table, in the document's database, where each fetched query is kept as which text it was (its hash, so its vector
 * is found) and when it was fetched: not its text. A fetched query (a resume) is fetched again only when asked.
 */
export const SIMILARITY_QUERIES_TABLE = '__galaxy_similarity_queries';

/**
 * Turns texts into vectors, one per text, in order. Its id names where the vectors come from and with what model:
 * vectors from different sources are never compared, and changing the source embeds the texts again.
 */
export interface EmbeddingSource {
  id: string;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * A query fetched from elsewhere (sections of a served document): fetched once, then ranked by as it was, until
 * `refresh`, or until the embedding source changes (its vector is per source).
 */
export interface FetchedQuery {
  /** What it is, the same from one ranking to the next: the document, its sections, and the block serving it. */
  id: string;
  fetch(): Promise<string>;
  /** Fetch it again, though it is kept. */
  refresh: boolean;
  /** The time to keep as when it was fetched. */
  now(): string;
}

export interface RankRequest {
  /** A query returning the rows to score: their key and their text. Only these rows are embedded and scored. */
  rows: string;
  /** The column of `rows` that identifies a row. */
  key: string;
  /** The column of `rows` whose text is compared with the query. A row with no text gets no score. */
  text: string;
  query: string | FetchedQuery;
  /** Where each row's score goes: the column of a table, by its key column. */
  write: { table: string; key: string; column: string };
}

export interface RankResult {
  /** Rows given a score. */
  scored: number;
  /** Texts embedded by this ranking (the rest were already kept). */
  embedded: number;
  /** When a fetched query was fetched (this ranking, or the one that kept it); null for a query given as text. */
  queryFetchedAt: string | null;
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
 * Texts already embedded by this source are not embedded again, and a fetched query is not fetched again unless asked
 * (its vector is kept, and which text it was). Every score is written in one statement.
 */
export async function rankRows(useDatabase: UseDatabase, source: EmbeddingSource, request: RankRequest): Promise<RankResult> {
  // Checked before anything is embedded.
  for (const [value, role] of [[request.write.table, 'table'], [request.write.key, 'key column'], [request.write.column, 'score column']]) identifier(value, role);
  const fetched = typeof request.query === 'string' ? null : request.query;
  if (!fetched && !(request.query as string).trim()) throw new WebAutomationError('invalid_request', 'There is no query text to rank by.');

  const { rows, keptQuery } = await useDatabase((db) => {
    db.execute(`CREATE TABLE IF NOT EXISTS ${SIMILARITY_VECTORS_TABLE} (text_hash TEXT NOT NULL, model TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (text_hash, model))`);
    db.execute(`CREATE TABLE IF NOT EXISTS ${SIMILARITY_QUERIES_TABLE} (query TEXT PRIMARY KEY, text_hash TEXT NOT NULL, fetched_at TEXT NOT NULL)`);
    // A fetched query kept, with its vector from this source: ranked by without fetching it.
    const kept = fetched && !fetched.refresh ? db.query(
      `SELECT q.text_hash, q.fetched_at FROM ${SIMILARITY_QUERIES_TABLE} q JOIN ${SIMILARITY_VECTORS_TABLE} v ON v.text_hash = q.text_hash AND v.model = ? WHERE q.query = ?`,
      [source.id, fetched.id],
    )[0] : undefined;
    return { keptQuery: kept ? { hash: String(kept.text_hash), fetchedAt: String(kept.fetched_at) } : null, rows: db.query(request.rows).map((row) => {
      if (!(request.key in row) || !(request.text in row)) {
        throw new WebAutomationError('invalid_request', `The rows query must return the columns "${request.key}" and "${request.text}".`);
      }
      return { key: String(row[request.key]), text: String(row[request.text] ?? '').trim() };
    }) };
  });
  // The query's text, unless it is kept: given, or fetched now.
  const queryText = fetched ? (keptQuery ? null : await fetched.fetch()) : request.query as string;
  if (queryText !== null && !queryText.trim()) throw new WebAutomationError('invalid_request', 'There is no query text to rank by.');
  const queryFetchedAt = fetched ? keptQuery?.fetchedAt ?? fetched.now() : null;
  const scoredRows = rows.filter((row) => row.text);
  const texts = [...new Set([...(queryText !== null ? [queryText] : []), ...scoredRows.map((row) => row.text)])];
  const hashes = new Map<string, string>(await Promise.all(texts.map(async (text) => [text, await sha256(text)] as [string, string])));
  const queryHash = keptQuery?.hash ?? hashes.get(queryText!)!;

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
    if (fetched && !keptQuery) {
      db.execute(`INSERT OR REPLACE INTO ${SIMILARITY_QUERIES_TABLE} (query, text_hash, fetched_at) VALUES (?, ?, ?)`, [fetched.id, queryHash, queryFetchedAt]);
    }
    const vectors = new Map(db.query(
      `SELECT text_hash, vector FROM ${SIMILARITY_VECTORS_TABLE} WHERE model = ? AND text_hash IN (SELECT value FROM json_each(?))`,
      [source.id, JSON.stringify([...hashes.values(), queryHash])],
    ).map((row) => [String(row.text_hash), decodeVector(row.vector)]));
    const query = vectors.get(queryHash)!;
    const scores = Object.fromEntries(scoredRows.map((row) => [row.key, cosine(query, vectors.get(hashes.get(row.text)!)!)]));
    writeScores(db, request.write, scores);
    return { scored: scoredRows.length, embedded: embedded.length, queryFetchedAt };
  });
}

/**
 * Matching by the words in short texts, with nothing sent anywhere (docs/job-search/10-skill-matching.md, "match"):
 * scores the rows a query returns by how much of the closest example their text has. An example is its words, each
 * weighted by how rare it is among the rows, and its longer groups of words, in order ("software engineer", "senior
 * engineer"): a row's score is the weighted share of the words it has, and of the groups (`phraseShare` of the score).
 * Words and groups the row has that the example does not cost it nothing. A score is 0 to 1, 1 for a row with all of an
 * example; without examples, no row has one.
 */
export interface MatchRequest {
  /** A query returning the rows to score: their key and their text. */
  rows: string;
  key: string;
  text: string;
  /** A query returning the examples: their text, in its first column. */
  examples: string;
  /** Of a score, what an example's groups of words make up (0 to 1); its single words make up the rest. Default 0.3. */
  phraseShare?: number;
  /**
   * How many times an example's ending word counts: the one of its words that the most rows end with ("engineer" in
   * job titles, which end with what the work is). Found by word endings, not grammar. Default 1: no word is special.
   */
  endingWordWeight?: number;
  /** Words that say how much rather than what (such as "senior" or "ii" in job titles), and how much they count. */
  minorWords?: string[];
  /** Default 0.3. */
  minorWeight?: number;
  write: { table: string; key: string; column: string };
}

/** The words of a text taken into its groups: each word doubles them, and a title is rarely longer. */
const MAX_GROUP_WORDS = 8;

/** A text's words, compared without a plural "s" ("engineers", "engineer"). */
function textWords(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, MAX_GROUP_WORDS)
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}

/**
 * A text's groups of words, each with its size: every choice of its words, kept in order, and also with each two
 * neighbors joined, as sites write them either way ("front end", "frontend").
 */
export function wordGroups(text: string): Map<string, number> {
  const words = textWords(text);
  const variants = [words, ...words.slice(1).map((word, index) => [...words.slice(0, index), `${words[index]}${word}`, ...words.slice(index + 2)])];
  const groups = new Map<string, number>();
  for (const variant of variants) {
    for (let chosen = 1; chosen < 1 << variant.length; chosen += 1) {
      const group = variant.filter((_, index) => chosen & (1 << index));
      groups.set(group.join(' '), group.length);
    }
  }
  return groups;
}

/** Scores the rows `request.rows` returns by how much of the closest example they have, and writes every score in one statement. */
export function matchRows(useDatabase: UseDatabase, request: MatchRequest): Promise<{ scored: number; examples: number }> {
  for (const [value, role] of [[request.write.table, 'table'], [request.write.key, 'key column'], [request.write.column, 'score column']]) identifier(value, role);
  const minor = new Set((request.minorWords ?? []).map((word) => word.toLowerCase()));
  const phraseShare = request.phraseShare ?? 0.3;
  const endingWeight = request.endingWordWeight ?? 1;
  const minorWeight = request.minorWeight ?? 0.3;
  return useDatabase((db) => {
    const rows = db.query(request.rows).map((row) => {
      if (!(request.key in row) || !(request.text in row)) {
        throw new WebAutomationError('invalid_request', `The rows query must return the columns "${request.key}" and "${request.text}".`);
      }
      const text = String(row[request.text] ?? '');
      return { key: String(row[request.key]), last: textWords(text).pop(), groups: wordGroups(text) };
    });
    // How many rows have each group (a word is a group of one), and end with each word.
    const rowsWith = new Map<string, number>();
    const endings = new Map<string, number>();
    for (const row of rows) {
      for (const group of row.groups.keys()) rowsWith.set(group, (rowsWith.get(group) ?? 0) + 1);
      if (row.last) endings.set(row.last, (endings.get(row.last) ?? 0) + 1);
    }
    const rarity = (group: string) => Math.log((rows.length + 1) / ((rowsWith.get(group) ?? 0) + 1)) + 1;
    const examples = db.query(request.examples).map((row) => {
      const text = String(Object.values(row)[0] ?? '');
      const words = [...new Set(textWords(text))];
      const ending = words.filter((word) => !minor.has(word)).reduce<string | undefined>((found, word) => (found === undefined || (endings.get(word) ?? 0) >= (endings.get(found) ?? 0) ? word : found), undefined);
      const weight = (word: string) => (minor.has(word) ? minorWeight : word === ending ? endingWeight : 1) * rarity(word);
      // Its longer groups that some row has: the others no row can match.
      const groups = [...wordGroups(text)].filter(([group, size]) => size > 1 && rowsWith.has(group));
      return { words, weight, total: words.reduce((sum, word) => sum + weight(word), 0), groups, groupsTotal: groups.reduce((sum, [group, size]) => sum + size * rarity(group), 0) };
    }).filter((example) => example.words.length);
    const share = (row: Map<string, number>, example: (typeof examples)[number]) => {
      // A word is had when the row has it, or has it joined with its neighbor ("frontend" for "front end").
      const had = (word: string, index: number) => row.has(word) || (index > 0 && row.has(example.words[index - 1] + word)) || (index < example.words.length - 1 && row.has(word + example.words[index + 1]));
      const words = example.words.reduce((sum, word, index) => sum + (had(word, index) ? example.weight(word) : 0), 0) / example.total;
      const groups = example.groupsTotal ? example.groups.reduce((sum, [group, size]) => sum + (row.has(group) ? size * rarity(group) : 0), 0) / example.groupsTotal : words;
      return (1 - phraseShare) * words + phraseShare * groups;
    };
    const scores = Object.fromEntries(rows.map((row) => [row.key, examples.length && row.groups.size ? Math.max(...examples.map((example) => share(row.groups, example))) : null]));
    writeScores(db, request.write, scores);
    return { scored: rows.length, examples: examples.length };
  });
}
