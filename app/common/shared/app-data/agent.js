import {MASK, maskText} from '../agent/privacy.js';
import {readJwt, valueText} from './values.js';

// What the agent sees of an app's data: the shape first, values only when it
// asks, and never a token, a password or a secret.

// a key that names what it keeps: a token, a password, a session
export const SECRET_KEY = /token|passw|secret|session|auth|api[-_]?key|private[-_]?key|credential|cookie|pin$|cvv|otp/i;

/**
 * A value as the agent may see it. A JWT says only when it expires; a value
 * under a secret key is hidden; text goes through the masking patterns.
 */
export function valueForAgent(key, value, masks, now = Date.now()) {
  const text = valueText(value);
  const jwt = readJwt(text, now);
  if (jwt) {
    return jwt.exp === null
      ? `${MASK} (JWT without exp)`
      : `${MASK} (JWT, ${jwt.expiresIn < 0 ? 'expired' : 'expires'} ${new Date(jwt.exp).toISOString()})`;
  }
  if (SECRET_KEY.test(key ?? '')) {
    return text ? MASK : '';
  }
  return maskText(text, masks);
}

/** A row of a table with its secret columns and values hidden. */
export const rowForAgent = (row, masks, now) =>
  Object.fromEntries(Object.entries(row ?? {}).map(([name, value]) => [name, valueForAgent(name, value, masks, now)]));

/**
 * The shape of the data without a single value: preference files with their
 * keys and types, databases with their tables and rows, the biggest files.
 */
export function statsForAgent(snapshot) {
  if (!snapshot) {
    return {error: 'The data tab has not read the app yet.'};
  }
  if (snapshot.error) {
    return {error: snapshot.error.reason, detail: snapshot.error.detail ?? null};
  }
  return {
    app: snapshot.target?.appId,
    access: snapshot.target?.access,
    readAt: snapshot.readAt ? new Date(snapshot.readAt).toISOString() : null,
    prefs: (snapshot.prefs ?? []).map((file) => ({
      file: file.file,
      encrypted: !!file.encrypted || undefined,
      keys: file.encrypted ? file.entries.length : file.entries.map((entry) => `${entry.key}: ${entry.type}`),
    })),
    dbs: (snapshot.dbs ?? []).map((db) => ({
      file: db.file,
      tables: (db.tables ?? []).map((table) => `${table.name} (${table.rows})`),
    })),
    files: {
      count: snapshot.totals?.files ?? 0,
      bytes: snapshot.totals?.bytes ?? 0,
      biggest: [...(snapshot.files ?? [])]
        .sort((a, b) => b.size - a.size)
        .slice(0, 10)
        .map((file) => `${file.path} (${file.size} B)`),
    },
  };
}
