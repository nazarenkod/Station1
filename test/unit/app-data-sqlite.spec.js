import {copyFile, mkdtemp, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  describeDb,
  finishCopy,
  isWalFile,
  prepareCopy,
  readRows,
  runSql,
  searchDb,
  tablesForDiff,
} from '../../app/common/node/app-data/sqlite.js';

let dir;
let app;
let pulled;

// a database the way an app leaves it: in WAL mode, the last rows still only in the -wal
beforeEach(async function () {
  dir = await mkdtemp(path.join(os.tmpdir(), 'app-data-sqlite-'));
  const device = path.join(dir, 'app.db');
  app = new DatabaseSync(device);
  app.exec('PRAGMA journal_mode=WAL');
  app.exec('PRAGMA wal_autocheckpoint=0');
  app.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT, total REAL)');
  app.exec('CREATE TABLE log (line TEXT)');
  const insert = app.prepare('INSERT INTO orders (id, status, total) VALUES (?, ?, ?)');
  for (let i = 1; i <= 250; i++) {
    insert.run(i, i % 2 ? 'new' : 'paid', i * 10);
  }
  app.exec("INSERT INTO log (line) VALUES ('user 100500 logged in')");
  // the pull: the main file and its journal while the app still holds them open
  pulled = path.join(dir, 'mirror', 'app.db');
  await rm(path.dirname(pulled), {recursive: true, force: true});
  await import('node:fs/promises').then((fs) => fs.mkdir(path.dirname(pulled), {recursive: true}));
  for (const suffix of ['', '-wal', '-shm']) {
    await copyFile(device + suffix, pulled + suffix);
  }
});

afterEach(async function () {
  app.close();
  await rm(dir, {recursive: true, force: true});
});

describe('a database of the app', function () {
  it('reads what is still only in the -wal journal', async function () {
    const work = await prepareCopy(pulled, path.join(dir, 'work', 'app.db'));
    const tables = describeDb(work);
    expect(tables.map((table) => [table.name, table.rows])).toEqual([
      ['log', 1],
      ['orders', 250],
    ]);
    expect(tables.find((table) => table.name === 'orders').keys).toEqual(['id']);
    expect(tables.find((table) => table.name === 'log').keys).toEqual(['rowid']);
    // the copy needs no journal to be read
    expect(await stat(`${work}-wal`).catch(() => null)).toBe(null);
  });

  it('shows a table by pages of 100, sorted and filtered by a column', async function () {
    const work = await prepareCopy(pulled, path.join(dir, 'work', 'app.db'));
    const first = readRows(work, 'orders');
    expect(first.rows).toHaveLength(100);
    expect(first.total).toBe(250);
    const last = readRows(work, 'orders', {offset: 200});
    expect(last.rows).toHaveLength(50);
    const paid = readRows(work, 'orders', {
      filter: {column: 'status', text: 'paid'},
      sort: {column: 'total', desc: true},
    });
    expect(paid.total).toBe(125);
    expect(paid.rows[0]).toEqual({id: 250, status: 'paid', total: 2500});
    expect(readRows(work, 'log').rows[0]).toEqual({rowid: 1, line: 'user 100500 logged in'});
  });

  it('runs a SELECT at once', async function () {
    const work = await prepareCopy(pulled, path.join(dir, 'work', 'app.db'));
    expect(runSql(work, "SELECT count(*) AS n FROM orders WHERE status = 'new'")).toEqual({
      kind: 'rows',
      columns: ['n'],
      rows: [{n: 125}],
      truncated: false,
    });
  });

  it('runs a query that changes data only when confirmed, and says how many rows it touched', async function () {
    const work = await prepareCopy(pulled, path.join(dir, 'work', 'app.db'));
    const update = "UPDATE orders SET status = 'cancelled' WHERE id <= 3";
    expect(runSql(work, update)).toEqual({kind: 'confirm'});
    expect(runSql(work, "SELECT count(*) AS n FROM orders WHERE status = 'cancelled'").rows[0].n).toBe(0);
    expect(runSql(work, update, {confirmed: true})).toEqual({kind: 'changed', changes: 3});
    expect(runSql(work, 'DELETE FROM log; DELETE FROM orders WHERE id = 4')).toEqual({kind: 'confirm'});
    expect(runSql(work, 'DELETE FROM log; DELETE FROM orders WHERE id = 4', {confirmed: true})).toEqual({
      kind: 'changed',
      changes: 2,
    });
  });

  it('says what is wrong with broken SQL', async function () {
    const work = await prepareCopy(pulled, path.join(dir, 'work', 'app.db'));
    expect(runSql(work, 'SELEC 1').kind).toBe('error');
  });

  it('goes back in WAL mode as one file', async function () {
    const work = await prepareCopy(pulled, path.join(dir, 'work', 'app.db'));
    expect(await isWalFile(pulled)).toBe(true);
    expect(await isWalFile(work)).toBe(false);
    finishCopy(work, {wal: true});
    expect(await isWalFile(work)).toBe(true);
    expect(await stat(`${work}-wal`).catch(() => null)).toBe(null);
    expect(describeDb(work).find((table) => table.name === 'orders').rows).toBe(250);
  });

  it('gives small tables row by row and big ones by count, for comparing reads', async function () {
    const work = await prepareCopy(pulled, path.join(dir, 'work', 'app.db'));
    const tables = tablesForDiff(work, 'databases/app.db', 100);
    expect(tables.find((table) => table.table === 'orders')).toMatchObject({rows: null, count: 250});
    expect(tables.find((table) => table.table === 'log').rows).toEqual([{rowid: 1, line: 'user 100500 logged in'}]);
  });

  it('finds a value in any column of any table', async function () {
    const work = await prepareCopy(pulled, path.join(dir, 'work', 'app.db'));
    expect(searchDb(work, 'databases/app.db', '100500')).toEqual([
      {file: 'databases/app.db', table: 'log', column: 'line', key: '[1]', value: 'user 100500 logged in'},
    ]);
    expect(searchDb(work, 'databases/app.db', '2500')[0]).toMatchObject({
      table: 'orders',
      column: 'total',
      key: '[250]',
    });
  });

  it('reads an integer beyond 2^53 as text instead of failing', async function () {
    app.exec('CREATE TABLE cache (id INTEGER PRIMARY KEY, hash INTEGER)');
    app.exec('INSERT INTO cache VALUES (1, -8942516764034068538)');
    for (const suffix of ['', '-wal', '-shm']) {
      await copyFile(path.join(dir, 'app.db') + suffix, pulled + suffix);
    }
    const work = await prepareCopy(pulled, path.join(dir, 'work', 'app.db'));
    expect(readRows(work, 'cache').rows).toEqual([{id: 1, hash: '-8942516764034068538'}]);
  });
});
