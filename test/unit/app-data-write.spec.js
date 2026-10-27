import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {hexDump, createAppDataService} from '../../app/common/node/app-data/service.js';
import {writeSharedPrefs, parseSharedPrefs} from '../../app/common/shared/app-data/prefs-android.js';

const PREFS = 'shared_prefs/app.xml';
const DB = 'databases/app.db';

let dir;

// a device in memory: files by path, each write moves the clock, every call is kept
function fakeDevice(files) {
  const fs = new Map(Object.entries(files).map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const mtimes = new Map();
  const calls = [];
  let clock = 1000;
  const touch = (name) => mtimes.set(name, ++clock);
  for (const name of fs.keys()) {
    touch(name);
  }
  const transport = {
    platform: 'android',
    access: 'run-as',
    async list() {
      return [...fs].map(([name, bytes]) => ({path: name, size: bytes.length, mtime: mtimes.get(name)}));
    },
    async read(name) {
      if (!fs.has(name)) {
        throw new Error(`no ${name}`);
      }
      return Buffer.from(fs.get(name));
    },
    async write(name, bytes) {
      calls.push(['write', name]);
      fs.set(name, Buffer.from(bytes));
      touch(name);
    },
    async remove(name) {
      calls.push(['remove', name]);
      fs.delete(name);
    },
    async stop() {
      calls.push(['stop']);
    },
    async launch() {
      calls.push(['launch']);
    },
    async clear() {
      calls.push(['clear']);
      fs.clear();
    },
  };
  return {fs, calls, transport, touch};
}

const prefsXml = (entries) => writeSharedPrefs(entries);
const prefsOn = (device) => parseSharedPrefs(device.fs.get(PREFS).toString('utf8'));

async function databaseBytes(setup) {
  const file = path.join(dir, `seed-${Math.random()}.db`);
  const db = new DatabaseSync(file);
  db.exec(setup);
  db.close();
  return await readFile(file);
}

async function rowsOf(bytes, sql) {
  const file = path.join(dir, `check-${Math.random()}.db`);
  await writeFile(file, bytes);
  const db = new DatabaseSync(file);
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

const emulator = {id: 'emulator-5554', kind: 'android-emulator', state: 'running'};

function serviceFor(device, extra = {}) {
  const updates = [];
  let time = 0;
  const service = createAppDataService({
    dataDir: dir,
    open: async () => ({transport: device.transport}),
    onUpdate: (state) => updates.push(state),
    now: () => ++time,
    ...extra,
  });
  service.select(emulator, 'ua.app');
  return {service, updates};
}

beforeEach(async function () {
  dir = await mkdtemp(path.join(os.tmpdir(), 'app-data-service-'));
});

afterEach(async function () {
  await rm(dir, {recursive: true, force: true});
});

describe('reading the data', function () {
  it('puts preferences, databases and files in their sections', async function () {
    const device = fakeDevice({
      [PREFS]: prefsXml([{key: 'onboarding_done', type: 'boolean', value: false}]),
      [DB]: await databaseBytes(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (1, 'a')",
      ),
      'files/config.json': '{"a":1}',
    });
    const {service} = serviceFor(device);
    const {snapshot} = await service.refresh();
    expect(snapshot.error).toBe(null);
    expect(snapshot.prefs[0].entries).toEqual([{key: 'onboarding_done', type: 'boolean', value: false}]);
    expect(snapshot.dbs[0].tables.map((table) => [table.name, table.rows])).toEqual([['users', 1]]);
    expect(snapshot.files.map((file) => [file.path, file.kind])).toEqual([
      [PREFS, 'prefs'],
      [DB, 'sqlite'],
      ['files/config.json', 'json'],
    ]);
    expect(snapshot.totals).toMatchObject({prefs: 1, dbs: 1, files: 3});
  });

  it('says why there is no access instead of an empty list', async function () {
    const service = createAppDataService({
      dataDir: dir,
      open: async () => ({error: {reason: 'releaseBuild', detail: 'run-as: package not debuggable'}}),
    });
    service.select(emulator, 'ua.app');
    const {snapshot} = await service.refresh();
    expect(snapshot.error).toEqual({reason: 'releaseBuild', detail: 'run-as: package not debuggable'});
  });

  it('feeds the changes since the last read with the screen they happened on', async function () {
    const device = fakeDevice({[PREFS]: prefsXml([{key: 'token', type: 'string', value: 'old'}])});
    const {service} = serviceFor(device);
    await service.refresh();
    service.setScreen('Оплата');
    device.fs.set(
      PREFS,
      Buffer.from(
        prefsXml([
          {key: 'token', type: 'string', value: 'new'},
          {key: 'last_card_id', type: 'int', value: 7},
        ]),
      ),
    );
    device.touch(PREFS);
    const state = await service.refresh();
    expect(state.changes.map(({kind, key, screen}) => [kind, key, screen])).toEqual([
      ['added', 'last_card_id', 'Оплата'],
      ['changed', 'token', 'Оплата'],
    ]);
    expect(state.marks).toEqual({[`prefs|${PREFS}|token`]: 'changed', [`prefs|${PREFS}|last_card_id`]: 'added'});
  });

  it('keeps a change feed and edits of their own for each device and app', async function () {
    const device = fakeDevice({[PREFS]: prefsXml([{key: 'a', type: 'string', value: '1'}])});
    const {service} = serviceFor(device);
    await service.refresh();
    await service.setPref(PREFS, 'a', '2', 'string');
    expect(service.state().edits).toHaveLength(1);
    service.select({...emulator, id: 'emulator-5556'}, 'ua.app');
    expect(service.state()).toMatchObject({snapshot: null, edits: [], changes: []});
    service.select(emulator, 'ua.app');
    expect(service.state().edits).toHaveLength(1);
  });

  it('reads only while watching', async function () {
    const device = fakeDevice({[PREFS]: prefsXml([])});
    const {service} = serviceFor(device);
    const before = device.calls.length;
    expect(service.watch(true).watching).toBe(true);
    expect(service.watch(false).watching).toBe(false);
    expect(device.calls.length).toBe(before);
  });
});

describe('changing the data', function () {
  it('stops the app, writes, reads again and starts the app', async function () {
    const device = fakeDevice({[PREFS]: prefsXml([{key: 'onboarding_done', type: 'boolean', value: true}])});
    const {service} = serviceFor(device);
    await service.refresh();
    const done = await service.setPref(PREFS, 'onboarding_done', false, 'boolean');
    expect(done.ok).toBe(true);
    expect(device.calls).toEqual([['stop'], ['write', PREFS], ['launch']]);
    expect(prefsOn(device)).toEqual([{key: 'onboarding_done', type: 'boolean', value: false}]);
    expect(service.state().snapshot.prefs[0].entries[0].value).toBe(false);
  });

  it('does not start the app again when asked not to', async function () {
    const device = fakeDevice({[PREFS]: prefsXml([])});
    const {service} = serviceFor(device);
    await service.refresh();
    await service.setPref(PREFS, 'new_key', 5, 'int', {relaunch: false});
    expect(device.calls).toEqual([['stop'], ['write', PREFS]]);
    expect(prefsOn(device)).toEqual([{key: 'new_key', type: 'int', value: 5}]);
  });

  it('brings back one edit, or all of them as they were before the first', async function () {
    const device = fakeDevice({
      [PREFS]: prefsXml([
        {key: 'a', type: 'string', value: '1'},
        {key: 'b', type: 'string', value: 'x'},
      ]),
    });
    const {service} = serviceFor(device);
    await service.refresh();
    await service.setPref(PREFS, 'a', '2', 'string');
    const second = await service.removePref(PREFS, 'b');
    expect(prefsOn(device)).toEqual([{key: 'a', type: 'string', value: '2'}]);

    expect((await service.revert(second.edit.id)).ok).toBe(true);
    expect(prefsOn(device)).toEqual([
      {key: 'a', type: 'string', value: '2'},
      {key: 'b', type: 'string', value: 'x'},
    ]);

    await service.setPref(PREFS, 'a', '3', 'string');
    expect((await service.revert('all')).ok).toBe(true);
    expect(prefsOn(device)).toEqual([
      {key: 'a', type: 'string', value: '1'},
      {key: 'b', type: 'string', value: 'x'},
    ]);
    expect(service.state().edits.every((edit) => edit.reverted)).toBe(true);
  });

  it('puts a file from this Mac into the sandbox, and takes it away on revert', async function () {
    const device = fakeDevice({[PREFS]: prefsXml([])});
    const {service} = serviceFor(device);
    await service.refresh();
    const local = path.join(dir, 'cache.json');
    await writeFile(local, '{"old":true}');
    const done = await service.put('files/cache.json', local);
    expect(device.fs.get('files/cache.json').toString()).toBe('{"old":true}');
    await service.revert(done.edit.id);
    expect(device.fs.has('files/cache.json')).toBe(false);
  });

  it('deletes a file with a copy to bring it back', async function () {
    const device = fakeDevice({'files/token.txt': 'secret'});
    const {service} = serviceFor(device);
    await service.refresh();
    const done = await service.removeFile('files/token.txt');
    expect(device.fs.has('files/token.txt')).toBe(false);
    await service.revert(done.edit.id);
    expect(device.fs.get('files/token.txt').toString()).toBe('secret');
  });

  it('changes a database with SQL on a copy, sends back one file and drops the old journal', async function () {
    const device = fakeDevice({
      [DB]: await databaseBytes(
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT); INSERT INTO orders VALUES (1, 'new'), (2, 'new')",
      ),
      [`${DB}-wal`]: '',
    });
    const {service} = serviceFor(device);
    await service.refresh();
    expect((await service.query(DB, "UPDATE orders SET status = 'paid'")).kind).toBe('confirm');
    expect(device.calls).toEqual([]);
    expect(await service.query(DB, "UPDATE orders SET status = 'paid' WHERE id = 1", {confirmed: true})).toEqual({
      kind: 'changed',
      changes: 1,
    });
    expect(device.calls).toEqual([
      ['stop'],
      ['write', DB],
      ['remove', `${DB}-wal`],
      ['remove', `${DB}-shm`],
      ['launch'],
    ]);
    expect(await rowsOf(device.fs.get(DB), 'SELECT status FROM orders ORDER BY id')).toEqual([
      {status: 'paid'},
      {status: 'new'},
    ]);
    await expect(service.table(DB, 'orders')).resolves.toMatchObject({total: 2});
  });

  it('clears the data without a copy', async function () {
    const device = fakeDevice({[PREFS]: prefsXml([{key: 'a', type: 'string', value: '1'}])});
    const {service} = serviceFor(device);
    await service.refresh();
    expect((await service.clear()).ok).toBe(true);
    expect(device.calls).toEqual([['stop'], ['clear']]);
    expect(service.state().snapshot.prefs).toEqual([]);
    expect(service.state().edits).toEqual([]);
  });

  it('says plainly when the device cannot do it', async function () {
    const device = fakeDevice({[PREFS]: prefsXml([])});
    device.transport.clear = async () => {
      throw Object.assign(new Error('An iPhone app’s data is cleared only by reinstalling it'), {code: 'notSupported'});
    };
    const {service} = serviceFor(device);
    await service.refresh();
    expect(await service.clear()).toMatchObject({ok: false, code: 'notSupported'});
  });
});

describe('looking inside', function () {
  it('searches preferences, rows and text files at once', async function () {
    const device = fakeDevice({
      [PREFS]: prefsXml([{key: 'flutter.user_id', type: 'string', value: '100500'}]),
      [DB]: await databaseBytes(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (100500, 'qa')",
      ),
      'files/session.log': 'login 100500',
    });
    const {service} = serviceFor(device);
    await service.refresh();
    const found = await service.search('100500');
    expect([found.prefs.length, found.rows.length, found.texts.length]).toEqual([1, 1, 1]);
  });

  it('shows a JSON file pretty, a binary one as hex', async function () {
    const device = fakeDevice({'files/a.json': '{"a":1}', 'files/raw': Buffer.from([0, 1, 2, 255])});
    const {service} = serviceFor(device);
    await service.refresh();
    expect((await service.fileContent('files/a.json')).text).toBe('{\n  "a": 1\n}');
    expect((await service.fileContent('files/raw')).hex).toBe(hexDump(Buffer.from([0, 1, 2, 255])));
  });

  it('saves a file or a folder to this Mac', async function () {
    const device = fakeDevice({'files/a/one.txt': '1', 'files/a/two.txt': '2'});
    const {service} = serviceFor(device);
    await service.refresh();
    const out = path.join(dir, 'saved');
    expect(await service.saveTo('files/a', out)).toEqual({files: 2});
    expect(await readFile(path.join(out, 'two.txt'), 'utf8')).toBe('2');
  });
});
