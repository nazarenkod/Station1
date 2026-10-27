// What a file in the sandbox is, from its path and, once pulled, its first
// bytes. Preferences and databases get their own sections; the rest are files.

const SQLITE_MAGIC = 'SQLite format 3\u0000';

const EXT_KINDS = {
  json: 'json',
  xml: 'xml',
  plist: 'plist',
  txt: 'text',
  log: 'text',
  csv: 'text',
  md: 'text',
  html: 'text',
  htm: 'text',
  js: 'text',
  css: 'text',
  yaml: 'text',
  yml: 'text',
  properties: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  svg: 'image',
};

const DB_EXTENSIONS = ['db', 'sqlite', 'sqlite3', 'sqlitedb', 'store'];

const extension = (path) => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';

/** The files SQLite keeps next to a database while it is open. */
export const isSqliteSidecar = (path) => /-(wal|shm|journal)$/.test(path);

/** The database a sidecar belongs to. */
export const sidecarOwner = (path) => path.replace(/-(wal|shm|journal)$/, '');

/**
 * The preferences format a path holds, or null. Group containers of iOS sit
 * under `@group.<id>/`.
 */
export function prefsFormat(path, platform) {
  if (platform === 'android') {
    if (/^shared_prefs\/[^/]+\.xml$/.test(path)) {
      return 'shared-prefs';
    }
    if (/^files\/datastore\/[^/]+\.preferences_pb$/.test(path)) {
      return 'datastore';
    }
    return null;
  }
  // the app's own defaults and those of its groups; not the system's ones in subfolders
  return /^(?:@[^/]+\/)?Library\/Preferences\/[^/]+\.plist$/.test(path) ? 'plist' : null;
}

const looksLikeText = (head) => {
  if (!head?.length) {
    return false;
  }
  let good = 0;
  for (const byte of head) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte !== 127)) {
      good++;
    }
  }
  return good / head.length > 0.95;
};

/** Whether the first bytes are a SQLite database. */
export function isSqlite(head) {
  if (!head || head.length < SQLITE_MAGIC.length) {
    return false;
  }
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (head[i] !== SQLITE_MAGIC.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

/**
 * The kind of a file for its section and preview: prefs, sqlite,
 * sqlite-aux, json, xml, plist, text, image or binary. `head` is the first
 * bytes when the file was pulled; without it the path decides.
 */
export function fileKind(path, {platform, head} = {}) {
  if (prefsFormat(path, platform)) {
    return 'prefs';
  }
  if (isSqliteSidecar(path)) {
    return 'sqlite-aux';
  }
  // Room names its files without an extension, in databases/
  if (head ? isSqlite(head) : DB_EXTENSIONS.includes(extension(path)) || /^databases\/[^/.]+$/.test(path)) {
    return 'sqlite';
  }
  const byExtension = EXT_KINDS[extension(path)];
  if (byExtension) {
    return byExtension;
  }
  if (head && head.length >= 8 && head[0] === 0x62 && String.fromCharCode(...head.subarray(0, 8)) === 'bplist00') {
    return 'plist';
  }
  return head && looksLikeText(head) ? 'text' : 'binary';
}
