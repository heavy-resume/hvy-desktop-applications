import type { ScriptingDbApi } from '../../../heavy-file-format/src/plugins/scripting/runtime';
import type { DocumentItem, DocumentItemStore } from './recordSink';

/**
 * Items as rows of a table in the document's SQLite database, the one `hvy.db-table` shows. The table is the
 * document's: it creates it, with whatever other columns it needs (status, scores, notes), and the store writes only
 * the key column, the record column, and the columns its fields are mapped to.
 */
export interface SqlItemStoreConfig {
  kind: 'sql';
  table: string;
  /** Holds the item's key; the table makes it unique, so an item is found by a query. */
  keyColumn: string;
  /** Holds the item's identity and provenance as JSON, as a card's record file does. */
  recordColumn: string;
  /** Item field name → the column holding its value. */
  columns: Record<string, string>;
  /** When the item was first found, as an ISO time: written once, not moved by a later run. */
  collectedAtColumn?: string;
}

/** The database a store writes through: the document's, as scripts' `doc.db` reaches it. */
export type SqlItemDatabase = Pick<ScriptingDbApi, 'query' | 'execute'>;

interface StoredRecord {
  key: string;
  url: string;
  state: DocumentItem['state'];
  problem?: string;
  provenance: DocumentItem['provenance'];
}

/** A table or column name the store writes: plain identifiers only, so a name is never SQL. */
export const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const quoted = (name: string) => `"${name}"`;

export function createSqlItemStore(db: SqlItemDatabase, config: SqlItemStoreConfig): DocumentItemStore {
  const table = quoted(config.table);
  const fieldColumns = Object.entries(config.columns);

  function read(row: Record<string, unknown>): DocumentItem | null {
    const recordText = row[config.recordColumn];
    if (typeof recordText !== 'string' || !recordText) return null;
    const record = JSON.parse(recordText) as StoredRecord;
    const fields = Object.fromEntries(fieldColumns.flatMap(([name, column]) => {
      const value = row[column];
      return value === null || value === undefined || value === '' ? [] : [[name, value]];
    }));
    return {
      key: record.key,
      url: record.url,
      fields,
      provenance: record.provenance,
      state: record.state,
      ...(record.problem ? { problem: record.problem } : {}),
    };
  }

  function rowFor(key: string): Record<string, unknown> | null {
    return db.query(`SELECT * FROM ${table} WHERE ${quoted(config.keyColumn)} = ?`, [key])[0] ?? null;
  }

  return {
    get: (key) => {
      const row = rowFor(key);
      return row ? read(row) : null;
    },
    list: () => db.query(`SELECT * FROM ${table}`).flatMap((row) => read(row) ?? []),
    put: (item) => {
      const existing = rowFor(item.key);
      const record: StoredRecord = {
        key: item.key,
        url: item.url,
        state: item.state,
        provenance: item.provenance,
        ...(item.problem ? { problem: item.problem } : {}),
      };
      const values: Array<[string, unknown]> = [[config.recordColumn, JSON.stringify(record)]];
      for (const [name, column] of fieldColumns) {
        const value = name === 'url' && item.fields.url === undefined ? item.url : item.fields[name];
        // A new row keeps the table's default (an evaluation saying "Not evaluated") for fields it has no value for.
        if (!existing && (value === undefined || value === null)) continue;
        values.push([column, value === undefined || value === null ? null : String(value)]);
      }
      // When an item was found is when it was first found: a later run does not move it.
      if (config.collectedAtColumn && !existing?.[config.collectedAtColumn]) {
        values.push([config.collectedAtColumn, new Date(item.provenance.collectedAt).toISOString()]);
      }
      if (existing) {
        db.execute(
          `UPDATE ${table} SET ${values.map(([column]) => `${quoted(column)} = ?`).join(', ')} WHERE ${quoted(config.keyColumn)} = ?`,
          [...values.map(([, value]) => value), item.key],
        );
        return;
      }
      const columns = [config.keyColumn, ...values.map(([column]) => column)];
      db.execute(
        `INSERT INTO ${table} (${columns.map(quoted).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        [item.key, ...values.map(([, value]) => value)],
      );
    },
  };
}

/** Problems that would stop a SQL item store from working on this document's database. */
export function validateSqlItemStore(db: SqlItemDatabase, config: SqlItemStoreConfig): string[] {
  const columns = new Set(db.query(`PRAGMA table_info(${quoted(config.table)})`).map((row) => String(row.name)));
  if (!columns.size) return [`The document's database has no table "${config.table}".`];
  const needed: Array<[string, string]> = [
    [config.keyColumn, 'the key'],
    [config.recordColumn, 'the record'],
    ...Object.entries(config.columns).map(([name, column]): [string, string] => [column, `field "${name}"`]),
    ...(config.collectedAtColumn ? [[config.collectedAtColumn, 'when an item was found'] as [string, string]] : []),
  ];
  const errors = needed.filter(([column]) => !columns.has(column)).map(([column, role]) => `Table "${config.table}" has no column "${column}" for ${role}.`);
  const unique = db.query(`PRAGMA index_list(${quoted(config.table)})`)
    .filter((index) => Number(index.unique) === 1)
    .some((index) => {
      const indexed = db.query(`PRAGMA index_info(${quoted(String(index.name))})`).map((row) => String(row.name));
      return indexed.length === 1 && indexed[0] === config.keyColumn;
    });
  if (columns.has(config.keyColumn) && !unique) errors.push(`Table "${config.table}" must make "${config.keyColumn}" unique (a primary key or a unique column), so each item is one row.`);
  return errors;
}
