import {copyFile, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {fileKind, isSqlite, isSqliteSidecar, prefsFormat} from '../../shared/app-data/classify.js';
import {parseDataStore, writeDataStore} from '../../shared/app-data/datastore.js';
import {appendChanges, diffReads, highlights} from '../../shared/app-data/diff.js';
import {parsePlistPrefs, writePlistPrefs} from '../../shared/app-data/plist.js';
import {isEncryptedPrefs, parseSharedPrefs, writeSharedPrefs} from '../../shared/app-data/prefs-android.js';
import {searchAppData} from '../../shared/app-data/search.js';
import {plistToXml, xmlToBinaryPlist} from './plist-files.js';
import {describeDb, finishCopy, isWalFile, prepareCopy, readRows, runSql, searchDb, tablesForDiff} from './sqlite.js';
import {openTransport} from './transport.js';

// The data of one app on one device: read into a mirror on this Mac,
// compared with the read before, changed with a copy of what was there.
// Each pair of device and app keeps its own change feed and edits.

export const WATCH_MS = 3000;
const TEXT_LIMIT = 256 * 1024;
const SEARCH_BYTES = 20 * 1024 * 1024;
const PREVIEW_TEXT = 1024 * 1024;
const PREVIEW_IMAGE = 5 * 1024 * 1024;

const safeName = (text) => String(text).replace(/[^\w.-]+/g, '_');
const exists = async (file) => !!(await stat(file).catch(() => null));

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

/** A hex dump of the first bytes, 16 to a line. */
export function hexDump(bytes, limit = 512) {
  const lines = [];
  const part = bytes.subarray(0, limit);
  for (let offset = 0; offset < part.length; offset += 16) {
    const row = part.subarray(offset, offset + 16);
    const hex = [...row].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    const text = [...row].map((byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${text}`);
  }
  return lines.join('\n');
}

/**
 * @param {object} deps
 * @param {string} deps.dataDir the station's data folder
 * @param {(device: object, appId: string) => Promise<object>} [deps.open] opens a transport
 * @param {(state: object) => void} [deps.onUpdate] the new state for the window
 * @param {() => number} [deps.now]
 */
export function createAppDataService({dataDir, open = openTransport, onUpdate = () => {}, now = () => Date.now()}) {
  const targets = new Map();
  let current = null;
  let screen = null;
  let watching = false;
  let timer = null;
  let nextId = 1;

  const keyOf = (device, appId) => `${device.id}|${appId}`;

  function target() {
    if (!current) {
      throw new Error('No device and app chosen');
    }
    return current;
  }

  const state = () =>
    current
      ? {
          snapshot: current.snapshot,
          changes: current.changes,
          edits: current.edits,
          marks: current.marks,
          busy: current.busy,
          watching,
        }
      : {snapshot: null, changes: [], edits: [], marks: {}, busy: false, watching};

  const emit = () => onUpdate(state());

  function select(device, appId) {
    if (!device || !appId) {
      current = null;
      emit();
      return state();
    }
    const key = keyOf(device, appId);
    if (!targets.has(key)) {
      const dir = path.join(dataDir, 'app-data', safeName(device.id), safeName(appId));
      targets.set(key, {
        device,
        appId,
        dir,
        mirror: path.join(dir, 'mirror'),
        work: path.join(dir, 'work'),
        backups: path.join(dir, 'backups'),
        transport: null,
        pulled: new Map(),
        parsed: new Map(),
        read: null,
        snapshot: null,
        changes: [],
        edits: [],
        marks: {},
        busy: false,
      });
    }
    current = targets.get(key);
    // the device may have changed state (booted, reconnected) since
    current.device = device;
    emit();
    return state();
  }

  async function transportOf(one) {
    if (one.transport) {
      return one.transport;
    }
    const opened = await open(one.device, one.appId);
    if (opened.error) {
      const error = new Error(opened.error.reason);
      error.access = opened.error;
      throw error;
    }
    one.transport = opened.transport;
    return one.transport;
  }

  const mirrorPath = (one, file) => path.join(one.mirror, ...file.split('/'));
  const workPath = (one, file) => path.join(one.work, ...file.split('/'));

  // a file from the device into the mirror, unless the mirror has this very version
  async function pull(one, file, {force = false} = {}) {
    const info = typeof file === 'string' ? null : file;
    const name = info ? info.path : file;
    const local = mirrorPath(one, name);
    const known = one.pulled.get(name);
    if (!force && info && known && known.size === info.size && known.mtime === info.mtime && (await exists(local))) {
      return local;
    }
    const bytes = await one.transport.read(name);
    await mkdir(path.dirname(local), {recursive: true});
    await writeFile(local, bytes);
    one.pulled.set(name, info ? {size: info.size, mtime: info.mtime} : {size: bytes.length, mtime: 0});
    return local;
  }

  async function readPrefsFile(one, file, format, info) {
    if (format === 'plist') {
      const xml = one.transport.readPrefs
        ? await one.transport.readPrefs(file)
        : await plistToXml(await readFile(await pull(one, info ?? file)));
      return parsePlistPrefs(xml);
    }
    const local = await pull(one, info ?? file);
    const bytes = await readFile(local);
    return format === 'datastore' ? parseDataStore(bytes) : parseSharedPrefs(bytes.toString('utf8'));
  }

  // a database pulled with its journal and opened as a copy; again only when one of them changed
  async function readDb(one, info, sidecars) {
    const signature = JSON.stringify([info.size, info.mtime, ...sidecars.map((side) => [side.size, side.mtime])]);
    const known = one.parsed.get(info.path);
    if (known?.signature === signature) {
      return known;
    }
    const main = await pull(one, info);
    // a journal left from the previous pull would be merged in again
    for (const suffix of ['-wal', '-shm']) {
      if (!sidecars.some((side) => side.path === info.path + suffix)) {
        await rm(main + suffix, {force: true});
      }
    }
    for (const side of sidecars) {
      await pull(one, side);
    }
    const head = (await readFile(main)).subarray(0, 100);
    if (!isSqlite(head)) {
      return null;
    }
    const work = await prepareCopy(main, workPath(one, info.path));
    const parsed = {
      signature,
      work,
      wal: await isWalFile(main),
      tables: describeDb(work),
      diff: tablesForDiff(work, info.path),
    };
    one.parsed.set(info.path, parsed);
    return parsed;
  }

  async function refresh() {
    const one = target();
    if (one.busy) {
      return state();
    }
    one.busy = true;
    emit();
    try {
      const transport = await transportOf(one);
      const listed = await transport.list();
      const platform = transport.platform;
      const byPath = new Map(listed.map((file) => [file.path, file]));

      const prefs = [];
      for (const file of listed) {
        const format = prefsFormat(file.path, platform);
        if (!format) {
          continue;
        }
        try {
          const entries = await readPrefsFile(one, file.path, format, file);
          prefs.push({file: file.path, format, encrypted: isEncryptedPrefs(entries), entries, size: file.size});
        } catch (error) {
          prefs.push({file: file.path, format, entries: [], size: file.size, error: String(error.message)});
        }
      }

      const dbs = [];
      const tables = [];
      for (const file of listed) {
        if (fileKind(file.path, {platform}) !== 'sqlite') {
          continue;
        }
        const sidecars = ['-wal', '-shm'].map((suffix) => byPath.get(file.path + suffix)).filter(Boolean);
        try {
          const parsed = await readDb(one, file, sidecars);
          if (parsed) {
            dbs.push({file: file.path, size: file.size, tables: parsed.tables});
            tables.push(...parsed.diff);
          }
        } catch (error) {
          dbs.push({file: file.path, size: file.size, tables: [], error: String(error.message)});
        }
      }

      const dbFiles = new Set(dbs.map((db) => db.file));
      const files = listed.map((file) => ({
        ...file,
        kind: dbFiles.has(file.path) ? 'sqlite' : fileKind(file.path, {platform}),
      }));

      const read = {prefs, tables, files};
      const found = diffReads(one.read, read).map((change) => ({...change, id: nextId++, at: now(), screen}));
      one.read = read;
      one.changes = appendChanges(one.changes, found);
      if (found.length) {
        one.marks = highlights(found);
      }
      one.snapshot = {
        target: {deviceId: one.device.id, appId: one.appId, platform, access: transport.access},
        readAt: now(),
        error: null,
        prefs,
        dbs,
        files,
        totals: {
          prefs: prefs.length,
          dbs: dbs.length,
          files: files.length,
          bytes: files.reduce((sum, file) => sum + file.size, 0),
        },
      };
    } catch (error) {
      one.transport = error.access ? null : one.transport;
      one.snapshot = {
        target: {deviceId: one.device.id, appId: one.appId},
        readAt: now(),
        error: error.access ?? {reason: 'failed', detail: String(error.message ?? error)},
        prefs: [],
        dbs: [],
        files: [],
        totals: {prefs: 0, dbs: 0, files: 0, bytes: 0},
      };
      // a transport that stopped working is opened again next time
      if (!error.access) {
        one.transport = null;
      }
    } finally {
      one.busy = false;
    }
    emit();
    return state();
  }

  function watch(on) {
    watching = !!on;
    clearTimeout(timer);
    timer = null;
    const tick = async () => {
      if (!watching) {
        return;
      }
      if (current) {
        await refresh().catch(() => {});
      }
      if (watching) {
        timer = setTimeout(tick, WATCH_MS);
      }
    };
    if (watching) {
      timer = setTimeout(tick, WATCH_MS);
    }
    emit();
    return state();
  }

  function setScreen(title) {
    screen = title ?? null;
  }

  // ---- changes, each with a copy of what was there before ----

  async function backupFile(one, file, editId) {
    const dir = path.join(one.backups, String(editId));
    const transport = one.transport;
    const format = prefsFormat(file, transport.platform);
    const listed = one.read?.files ?? [];
    const present = listed.some((entry) => entry.path === file);
    if (!present) {
      return {path: file, existed: false};
    }
    if (format === 'plist' && transport.writePrefs) {
      const xml = await transport.readPrefs(file);
      const local = path.join(dir, 'prefs.xml');
      await mkdir(dir, {recursive: true});
      await writeFile(local, xml);
      return {path: file, existed: true, prefsXml: local};
    }
    const parts = [];
    for (const suffix of ['', '-wal', '-shm']) {
      if (suffix && !listed.some((entry) => entry.path === file + suffix)) {
        continue;
      }
      const bytes = await transport.read(file + suffix);
      const local = path.join(dir, `${parts.length}`);
      await mkdir(dir, {recursive: true});
      await writeFile(local, bytes);
      parts.push({path: file + suffix, local});
    }
    return {path: file, existed: true, parts};
  }

  async function restore(one, backup) {
    const transport = one.transport;
    if (!backup.existed) {
      await transport.remove(backup.path).catch(() => {});
      return;
    }
    if (backup.prefsXml) {
      await transport.writePrefs(backup.path, await readFile(backup.prefsXml, 'utf8'));
      return;
    }
    for (const part of backup.parts) {
      await transport.write(part.path, await readFile(part.local));
    }
    // a journal the database did not have then must not be read over it
    for (const suffix of ['-wal', '-shm']) {
      if (!backup.parts.some((part) => part.path === backup.path + suffix)) {
        await removeSidecar(transport, backup.path + suffix);
      }
    }
  }

  async function removeSidecar(transport, file) {
    try {
      await transport.remove(file);
    } catch (error) {
      // an iPhone cannot delete: an empty -wal is read as no journal at all
      if (error.code === 'notSupported' && file.endsWith('-wal')) {
        await transport.write(file, new Uint8Array(0));
      }
    }
  }

  /**
   * Stops the app, makes the change with a copy of each file it touches,
   * reads the data again and starts the app when asked.
   */
  async function change(files, summary, apply, {relaunch = true} = {}) {
    const one = target();
    await transportOf(one);
    one.busy = true;
    emit();
    const id = nextId++;
    try {
      await one.transport.stop();
      const backups = [];
      for (const file of files) {
        backups.push(await backupFile(one, file, id));
      }
      const result = await apply(one);
      const edit = {id, at: now(), files, summary, backups, reverted: false};
      one.edits = [edit, ...one.edits];
      one.busy = false;
      await refresh();
      if (relaunch) {
        await one.transport.launch();
      }
      return {ok: true, edit: {...edit, backups: undefined}, result};
    } catch (error) {
      return {ok: false, error: String(error.message ?? error), code: error.code};
    } finally {
      one.busy = false;
      emit();
    }
  }

  // the entries of a preferences file as the stopped app left it; none for a new file
  async function currentEntries(one, file) {
    const format = prefsFormat(file, one.transport.platform);
    if (!format) {
      throw new Error(`${file} is not a preferences file`);
    }
    const onDevice = (await one.transport.list()).some((entry) => entry.path === file);
    if (!onDevice) {
      return {format, entries: []};
    }
    if (format !== 'plist' || !one.transport.readPrefs) {
      await pull(one, file, {force: true});
    }
    return {format, entries: await readPrefsFile(one, file, format)};
  }

  async function writeEntries(one, file, format, entries) {
    if (format === 'plist') {
      const xml = writePlistPrefs(entries);
      if (one.transport.writePrefs) {
        await one.transport.writePrefs(file, xml);
      } else {
        await one.transport.write(file, await xmlToBinaryPlist(xml));
      }
      return;
    }
    const bytes = format === 'datastore' ? writeDataStore(entries) : Buffer.from(writeSharedPrefs(entries), 'utf8');
    await one.transport.write(file, bytes);
  }

  /** Sets a key (a new one is added), with its type. */
  async function setPref(file, key, value, type, options) {
    return await change(
      [file],
      {kind: 'pref', file, key},
      async (one) => {
        const {format, entries} = await currentEntries(one, file);
        const before = entries.find((entry) => entry.key === key);
        const next = before
          ? entries.map((entry) => (entry.key === key ? {key, type, value} : entry))
          : [...entries, {key, type, value}];
        await writeEntries(one, file, format, next);
        return {before: before?.value, after: value};
      },
      options,
    );
  }

  async function removePref(file, key, options) {
    return await change(
      [file],
      {kind: 'prefRemoved', file, key},
      async (one) => {
        const {format, entries} = await currentEntries(one, file);
        await writeEntries(
          one,
          file,
          format,
          entries.filter((entry) => entry.key !== key),
        );
      },
      options,
    );
  }

  async function workCopy(one, file) {
    const parsed = one.parsed.get(file);
    if (!parsed) {
      throw new Error(`${file} is not a database the station has read`);
    }
    return parsed;
  }

  async function table(file, name, options) {
    const one = target();
    return readRows((await workCopy(one, file)).work, name, options);
  }

  /** SQL on a database: a read at once, a change with the app stopped and a copy of the database. */
  async function query(file, sql, {confirmed = false, relaunch = true} = {}) {
    const one = target();
    const first = runSql((await workCopy(one, file)).work, sql);
    if (first.kind !== 'confirm' || !confirmed) {
      return first;
    }
    const done = await change(
      [file],
      {kind: 'sql', file, sql: String(sql).slice(0, 200)},
      async (current) => {
        // the database as the stopped app left it
        const listed = await current.transport.list();
        const info = listed.find((entry) => entry.path === file);
        const sidecars = ['-wal', '-shm']
          .map((suffix) => listed.find((entry) => entry.path === file + suffix))
          .filter(Boolean);
        current.parsed.delete(file);
        const fresh = await readDb(current, info, sidecars);
        const result = runSql(fresh.work, sql, {confirmed: true});
        if (result.kind !== 'changed') {
          throw new Error(result.message ?? 'The query changed nothing');
        }
        finishCopy(fresh.work, {wal: fresh.wal});
        await current.transport.write(file, await readFile(fresh.work));
        for (const suffix of ['-wal', '-shm']) {
          await removeSidecar(current.transport, file + suffix);
        }
        current.parsed.delete(file);
        return result;
      },
      {relaunch},
    );
    return done.ok ? done.result : {kind: 'error', message: done.error};
  }

  /** Puts a file from this Mac into the sandbox. */
  async function put(file, localFile, options) {
    return await change(
      [file],
      {kind: 'put', file},
      async (one) => {
        await one.transport.write(file, await readFile(localFile));
      },
      options,
    );
  }

  async function removeFile(file, options) {
    return await change(
      [file],
      {kind: 'removed', file},
      async (one) => {
        await one.transport.remove(file);
      },
      options,
    );
  }

  /** Brings back the files of one edit as they were before it; later edits of those files go with it. */
  async function revert(editId, {relaunch = true} = {}) {
    const one = target();
    await transportOf(one);
    const live = one.edits.filter((edit) => !edit.reverted);
    // the oldest copy of each file is what it was before all of them
    const chosen = editId === 'all' ? live : live.filter((edit) => edit.id === editId);
    if (!chosen.length) {
      return {ok: false, error: 'Nothing to bring back'};
    }
    const touched = new Set(chosen.flatMap((edit) => edit.files));
    const oldest = new Map();
    for (const edit of [...live].reverse()) {
      if (editId !== 'all' && edit.id < editId) {
        continue;
      }
      for (const backup of edit.backups) {
        if (touched.has(backup.path) && !oldest.has(backup.path)) {
          oldest.set(backup.path, backup);
        }
      }
    }
    one.busy = true;
    emit();
    try {
      await one.transport.stop();
      for (const backup of oldest.values()) {
        await restore(one, backup);
        one.parsed.delete(backup.path);
      }
      for (const edit of live) {
        if (editId === 'all' || (edit.id >= editId && edit.files.some((file) => touched.has(file)))) {
          edit.reverted = true;
        }
      }
      one.busy = false;
      await refresh();
      if (relaunch) {
        await one.transport.launch();
      }
      return {ok: true};
    } catch (error) {
      return {ok: false, error: String(error.message ?? error)};
    } finally {
      one.busy = false;
      emit();
    }
  }

  /** Clears the app's data as a new install would; no copy is made. */
  async function clear() {
    const one = target();
    await transportOf(one);
    one.busy = true;
    emit();
    try {
      await one.transport.stop();
      await one.transport.clear();
      one.parsed.clear();
      one.busy = false;
      await refresh();
      return {ok: true};
    } catch (error) {
      return {ok: false, error: String(error.message ?? error), code: error.code};
    } finally {
      one.busy = false;
      emit();
    }
  }

  /** Deletes the mirror and the copies of this app on this device; the edits can no longer go back. */
  async function clearBackups() {
    const one = target();
    await rm(one.dir, {recursive: true, force: true});
    one.pulled.clear();
    one.parsed.clear();
    one.edits = [];
    emit();
    return state();
  }

  /** What a file holds, for its preview. */
  async function fileContent(file) {
    const one = target();
    const transport = await transportOf(one);
    const info = one.read?.files.find((entry) => entry.path === file);
    const local = await pull(one, info ?? file, {force: !info});
    const bytes = await readFile(local);
    const kind = fileKind(file, {platform: transport.platform, head: bytes.subarray(0, 64)});
    const base = {path: file, size: bytes.length, kind};
    if (kind === 'image') {
      const ext = /\.([^.]+)$/.exec(file)?.[1]?.toLowerCase();
      return bytes.length <= PREVIEW_IMAGE && IMAGE_TYPES[ext]
        ? {...base, image: `data:${IMAGE_TYPES[ext]};base64,${bytes.toString('base64')}`}
        : {...base, hex: hexDump(bytes)};
    }
    if (kind === 'plist' || kind === 'prefs') {
      if (prefsFormat(file, transport.platform) === 'datastore') {
        return {...base, text: JSON.stringify(parseDataStore(bytes), null, 2)};
      }
      try {
        return {...base, text: transport.platform === 'ios' ? await plistToXml(bytes) : bytes.toString('utf8')};
      } catch {
        return {...base, hex: hexDump(bytes)};
      }
    }
    if (['text', 'json', 'xml'].includes(kind)) {
      const text = bytes.subarray(0, PREVIEW_TEXT).toString('utf8');
      if (kind === 'json') {
        try {
          return {...base, text: JSON.stringify(JSON.parse(text), null, 2)};
        } catch {
          // shown as it is
        }
      }
      return {...base, text, truncated: bytes.length > PREVIEW_TEXT};
    }
    return {...base, hex: hexDump(bytes)};
  }

  /** Copies a file, or every file under a folder, to this Mac. */
  async function saveTo(prefix, destination) {
    const one = target();
    await transportOf(one);
    const files = (one.read?.files ?? []).filter((file) => file.path === prefix || file.path.startsWith(`${prefix}/`));
    if (!files.length) {
      throw new Error(`${prefix} is not in the sandbox`);
    }
    const single = files.length === 1 && files[0].path === prefix;
    for (const file of files) {
      const local = await pull(one, file);
      const out = single
        ? destination
        : path.join(destination, ...file.path.slice(prefix.length).split('/').filter(Boolean));
      await mkdir(path.dirname(out), {recursive: true});
      await copyFile(local, out);
    }
    return {files: files.length};
  }

  /** One search over everything: preferences, rows, file names and the text of text files. */
  async function search(text) {
    const one = target();
    await transportOf(one);
    const query = String(text ?? '').trim();
    if (!query || !one.snapshot) {
      return searchAppData({}, query);
    }
    const rows = [];
    for (const db of one.snapshot.dbs) {
      const parsed = one.parsed.get(db.file);
      if (parsed) {
        rows.push(...searchDb(parsed.work, db.file, query, 50 - rows.length));
      }
    }
    const texts = [];
    let budget = SEARCH_BYTES;
    for (const file of one.snapshot.files) {
      if (!['text', 'json', 'xml'].includes(file.kind) || file.size > TEXT_LIMIT || file.size > budget) {
        continue;
      }
      budget -= file.size;
      try {
        texts.push({path: file.path, text: (await readFile(await pull(one, file))).toString('utf8')});
      } catch {
        // a file gone since the read is skipped
      }
    }
    return searchAppData(
      {prefs: one.snapshot.prefs, files: one.snapshot.files.filter((file) => !isSqliteSidecar(file.path)), texts, rows},
      query,
    );
  }

  return {
    select,
    refresh,
    watch,
    setScreen,
    state,
    table,
    query,
    setPref,
    removePref,
    put,
    removeFile,
    revert,
    clear,
    clearBackups,
    fileContent,
    saveTo,
    search,
    stop: () => watch(false),
  };
}
