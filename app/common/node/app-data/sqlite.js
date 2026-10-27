import {copyFile, mkdir, readFile, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// A database of the app is never opened on the device: the station pulls the
// file with its journal (-wal, -shm), works on a copy on this Mac and, for a
// change, pushes the main file back.

export const PAGE_SIZE = 100;
// tables up to this many rows are compared row by row between reads
export const DIFF_ROWS = 5000;
const QUERY_ROWS = 500;

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

const exists = async (file) => !!(await stat(file).catch(() => null));

/** Whether the database file says it is in WAL mode (bytes 18 and 19 of its header are 2). */
export async function isWalFile(file) {
  const head = await readFile(file).then((buffer) => buffer.subarray(0, 20));
  return head.length >= 20 && head[18] === 2 && head[19] === 2;
}

/**
 * A copy of a database to read and change on this Mac, with what its journal
 * held merged in and its journal mode set to DELETE, so a read-only
 * connection needs no -shm.
 * @param {string} source the pulled main file; its -wal and -shm, when pulled, lie next to it
 * @param {string} work where the copy goes
 */
export async function prepareCopy(source, work) {
  await mkdir(path.dirname(work), {recursive: true});
  for (const suffix of ['-wal', '-shm', '-journal']) {
    await rm(work + suffix, {force: true});
  }
  await copyFile(source, work);
  for (const suffix of ['-wal', '-shm']) {
    if (await exists(source + suffix)) {
      await copyFile(source + suffix, work + suffix);
    }
  }
  const db = new DatabaseSync(work);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec('PRAGMA journal_mode=DELETE');
  } finally {
    db.close();
  }
  return work;
}

/**
 * The copy made ready to go back to the device: in WAL mode again when the app
 * used it, with nothing left in a journal, so the main file alone is the whole database.
 */
export function finishCopy(work, {wal}) {
  const db = new DatabaseSync(work);
  try {
    if (wal) {
      db.exec('PRAGMA journal_mode=WAL');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }
  } finally {
    // the last connection closing a WAL database merges and deletes its -wal
    db.close();
  }
}

const open = (file, readOnly = true) => new DatabaseSync(file, {readOnly});

// integers come as BigInt, so one beyond 2^53 does not stop the read; plainRow makes the rest numbers
const prepare = (db, sql) => {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  return statement;
};
const count = (db, sql, ...params) => Number(prepare(db, sql).get(...params).n);

function withDb(file, fn, readOnly = true) {
  const db = open(file, readOnly);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function tableInfo(db, name) {
  const columns = db
    .prepare(`PRAGMA table_info(${quote(name)})`)
    .all()
    .map((column) => ({name: column.name, type: column.type || '', pk: column.pk}));
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql ?? '';
  const pk = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
  const withoutRowid = /WITHOUT\s+ROWID/i.test(sql);
  return {
    columns,
    keys: withoutRowid || pk.length > 1 ? pk.map((column) => column.name) : pk.length === 1 ? [pk[0].name] : ['rowid'],
  };
}

const tableNames = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);

/** The tables of a database with their columns and how many rows each has. */
export function describeDb(file) {
  return withDb(file, (db) =>
    tableNames(db).map((name) => {
      const {columns, keys} = tableInfo(db, name);
      const rows = count(db, `SELECT count(*) AS n FROM ${quote(name)}`);
      return {name, rows, columns, keys};
    }),
  );
}

// values that cross IPC and JSON as they are: big integers as text, blobs as their size
function plainRow(row) {
  const result = {};
  for (const [name, value] of Object.entries(row)) {
    if (typeof value === 'bigint') {
      result[name] = Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    } else if (value instanceof Uint8Array) {
      result[name] = {blob: value.length};
    } else {
      result[name] = value;
    }
  }
  return result;
}

/**
 * One page of a table, sorted and filtered by a column.
 * @param {{offset?: number, limit?: number, sort?: {column: string, desc?: boolean}, filter?: {column: string, text: string}}} options
 */
export function readRows(file, table, {offset = 0, limit = PAGE_SIZE, sort, filter} = {}) {
  return withDb(file, (db) => {
    const {columns, keys} = tableInfo(db, table);
    const names = new Set(columns.map((column) => column.name));
    const where = filter?.text && names.has(filter.column) ? `WHERE CAST(${quote(filter.column)} AS TEXT) LIKE ?` : '';
    const params = where ? [`%${filter.text}%`] : [];
    const order = sort && names.has(sort.column) ? `ORDER BY ${quote(sort.column)} ${sort.desc ? 'DESC' : 'ASC'}` : '';
    const key = keys[0] === 'rowid' ? 'rowid AS "rowid", ' : '';
    const total = count(db, `SELECT count(*) AS n FROM ${quote(table)} ${where}`, ...params);
    const rows = prepare(db, `SELECT ${key}* FROM ${quote(table)} ${where} ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset)
      .map(plainRow);
    return {columns, keys, rows, total, offset};
  });
}

/**
 * Every table for comparing two reads: its rows when it is small enough,
 * only its count when it is not.
 */
export function tablesForDiff(file, dbName, maxRows = DIFF_ROWS) {
  return withDb(file, (db) =>
    tableNames(db).map((name) => {
      const {keys} = tableInfo(db, name);
      const total = count(db, `SELECT count(*) AS n FROM ${quote(name)}`);
      const select =
        keys[0] === 'rowid' ? `SELECT rowid AS "rowid", * FROM ${quote(name)}` : `SELECT * FROM ${quote(name)}`;
      const rows = total <= maxRows ? prepare(db, select).all().map(plainRow) : null;
      return {file: dbName, table: name, keys, rows, count: total};
    }),
  );
}

const isReadOnlyError = (error) => /readonly|read-only|attempt to write/i.test(String(error?.message ?? error));

/**
 * Runs SQL a person typed. A query that only reads runs at once; one that
 * changes data runs only when confirmed, and says how many rows it touched.
 * @returns {{kind: 'rows', columns: string[], rows: object[], truncated: boolean}
 *   | {kind: 'confirm'} | {kind: 'changed', changes: number} | {kind: 'error', message: string}}
 */
export function runSql(file, sql, {confirmed = false} = {}) {
  const text = String(sql ?? '').trim();
  if (!text) {
    return {kind: 'error', message: 'Empty query'};
  }
  try {
    return withDb(file, (db) => {
      const statement = prepare(db, text);
      const rows = [];
      let truncated = false;
      // iterate() and columns() come with Node 23.4; the tests may run on an older Node
      for (const row of statement.iterate ? statement.iterate() : statement.all()) {
        if (rows.length >= QUERY_ROWS) {
          truncated = true;
          break;
        }
        rows.push(plainRow(row));
      }
      const columns = statement.columns ? statement.columns().map((column) => column.name) : Object.keys(rows[0] ?? {});
      return {kind: 'rows', columns, rows, truncated};
    });
  } catch (error) {
    // more than one statement cannot be prepared at once; it is treated as a change
    const many = /more than one statement|multiple statements/i.test(String(error?.message));
    if (!isReadOnlyError(error) && !many) {
      return {kind: 'error', message: String(error?.message ?? error)};
    }
  }
  if (!confirmed) {
    return {kind: 'confirm'};
  }
  try {
    return withDb(
      file,
      (db) => {
        const before = count(db, 'SELECT total_changes() AS n');
        db.exec(text);
        return {kind: 'changed', changes: count(db, 'SELECT total_changes() AS n') - before};
      },
      false,
    );
  } catch (error) {
    return {kind: 'error', message: String(error?.message ?? error)};
  }
}

/**
 * Rows anywhere in a database whose value contains the text, as
 * {table, column, key, value}.
 */
export function searchDb(file, dbName, text, limit = 50) {
  const query = String(text ?? '').trim();
  if (!query) {
    return [];
  }
  return withDb(file, (db) => {
    const found = [];
    for (const name of tableNames(db)) {
      const {columns, keys} = tableInfo(db, name);
      const keyList = keys.map((key) => (key === 'rowid' ? 'rowid AS "rowid"' : quote(key))).join(', ');
      for (const column of columns) {
        if (found.length >= limit) {
          return found;
        }
        const rows = prepare(
          db,
          `SELECT ${keyList}, ${quote(column.name)} AS "__value" FROM ${quote(name)} WHERE CAST(${quote(column.name)} AS TEXT) LIKE ? LIMIT ?`,
        ).all(`%${query}%`, limit - found.length);
        for (const row of rows) {
          const plain = plainRow(row);
          found.push({
            file: dbName,
            table: name,
            column: column.name,
            key: JSON.stringify(keys.map((key) => plain[key] ?? null)),
            value: plain.__value,
          });
        }
      }
    }
    return found;
  });
}
