import {valueText} from './values.js';

// What changed between two reads of an app's data. A read is
// {prefs: [{file, entries}], tables: [{file, table, keys, rows, count}], files: [{path, size, mtime, kind}]}.
// The first read has nothing to compare with and gives no changes.

const same = (a, b) => valueText(a) === valueText(b);

function diffPrefs(before = [], after = []) {
  const changes = [];
  const old = new Map(before.map((file) => [file.file, file]));
  const fresh = new Map(after.map((file) => [file.file, file]));
  for (const file of after) {
    const previous = new Map((old.get(file.file)?.entries ?? []).map((entry) => [entry.key, entry]));
    for (const entry of file.entries ?? []) {
      const was = previous.get(entry.key);
      if (!was) {
        changes.push({section: 'prefs', file: file.file, kind: 'added', key: entry.key, after: entry.value});
      } else if (!same(was.value, entry.value) || was.type !== entry.type) {
        changes.push({
          section: 'prefs',
          file: file.file,
          kind: 'changed',
          key: entry.key,
          before: was.value,
          after: entry.value,
        });
      }
      previous.delete(entry.key);
    }
    for (const gone of previous.values()) {
      changes.push({section: 'prefs', file: file.file, kind: 'removed', key: gone.key, before: gone.value});
    }
  }
  for (const file of before) {
    if (!fresh.has(file.file)) {
      for (const gone of file.entries ?? []) {
        changes.push({section: 'prefs', file: file.file, kind: 'removed', key: gone.key, before: gone.value});
      }
    }
  }
  return changes;
}

/** The key of a row: its primary key columns, or its rowid. */
export const rowKey = (row, keys) => JSON.stringify(keys.map((name) => row[name] ?? null));

function diffTable(was, now) {
  const base = {section: 'db', file: now.file, table: now.table};
  // a table too big to compare row by row says only how many rows it has now
  if (!was.rows || !now.rows) {
    return was.count === now.count
      ? []
      : [{...base, kind: 'changed', key: null, before: {rows: was.count}, after: {rows: now.count}}];
  }
  const changes = [];
  const previous = new Map(was.rows.map((row) => [rowKey(row, was.keys), row]));
  for (const row of now.rows) {
    const key = rowKey(row, now.keys);
    const old = previous.get(key);
    if (!old) {
      changes.push({...base, kind: 'added', key, after: row});
    } else {
      const columns = Object.keys(row).filter((name) => !same(old[name], row[name]));
      if (columns.length) {
        changes.push({...base, kind: 'changed', key, columns, before: old, after: row});
      }
    }
    previous.delete(key);
  }
  for (const [key, row] of previous) {
    changes.push({...base, kind: 'removed', key, before: row});
  }
  return changes;
}

function diffTables(before = [], after = []) {
  const id = (table) => `${table.file}\u0000${table.table}`;
  const old = new Map(before.map((table) => [id(table), table]));
  const changes = [];
  for (const table of after) {
    const was = old.get(id(table));
    if (was) {
      changes.push(...diffTable(was, table));
      old.delete(id(table));
    } else if (before.some((one) => one.file === table.file)) {
      // a new table in a known database
      changes.push({
        section: 'db',
        file: table.file,
        table: table.table,
        kind: 'added',
        key: null,
        after: {rows: table.count},
      });
    }
  }
  for (const gone of old.values()) {
    changes.push({
      section: 'db',
      file: gone.file,
      table: gone.table,
      kind: 'removed',
      key: null,
      before: {rows: gone.count},
    });
  }
  return changes;
}

// preferences and databases have their own sections; their files would only repeat them
const PLAIN = (file) => !['prefs', 'sqlite', 'sqlite-aux'].includes(file.kind);

function diffFiles(before = [], after = []) {
  const old = new Map(before.filter(PLAIN).map((file) => [file.path, file]));
  const changes = [];
  for (const file of after.filter(PLAIN)) {
    const was = old.get(file.path);
    if (!was) {
      changes.push({section: 'files', file: file.path, kind: 'added', after: {size: file.size}});
    } else if (was.size !== file.size || was.mtime !== file.mtime) {
      changes.push({
        section: 'files',
        file: file.path,
        kind: 'changed',
        before: {size: was.size},
        after: {size: file.size},
      });
    }
    old.delete(file.path);
  }
  for (const gone of old.values()) {
    changes.push({section: 'files', file: gone.path, kind: 'removed', before: {size: gone.size}});
  }
  return changes;
}

/** The changes from one read to the next; none when there is no earlier read. */
export function diffReads(before, after) {
  if (!before || !after) {
    return [];
  }
  return [
    ...diffPrefs(before.prefs, after.prefs),
    ...diffTables(before.tables, after.tables),
    ...diffFiles(before.files, after.files),
  ];
}

/**
 * How the last changes colour what is on screen: by place, 'added',
 * 'changed' or 'removed'. A place is `prefs|file|key`, `db|file|table|row`
 * or `files|path`.
 */
export function highlights(changes) {
  const marks = {};
  for (const change of changes) {
    marks[placeOf(change)] = change.kind;
  }
  return marks;
}

export function placeOf(change) {
  if (change.section === 'prefs') {
    return `prefs|${change.file}|${change.key}`;
  }
  if (change.section === 'db') {
    return `db|${change.file}|${change.table}|${change.key ?? ''}`;
  }
  return `files|${change.file}`;
}

/** The newest changes first, no more than `limit`. */
export function appendChanges(feed, changes, limit = 500) {
  return [...changes.slice().reverse(), ...feed].slice(0, limit);
}
