// What a stored value is, beyond its type: a token, JSON, a moment, base64,
// a link. The station shows it in a readable form next to the raw value.

const JWT = /^(?:Bearer\s+)?([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]*)$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$|^[A-Za-z0-9_-]+$/;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;

// 2000-01-01 to 2100-01-01: wider would take ids and counters for moments
const SECONDS = [946684800, 4102444800];
const MILLIS = [SECONDS[0] * 1000, SECONDS[1] * 1000];

function decodeBase64Url(part) {
  const normal = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normal + '='.repeat((4 - (normal.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A JWT taken apart, or null when the text is not one. `exp` and `iat` are in milliseconds. */
export function readJwt(text, now = Date.now()) {
  const match = JWT.exec(String(text ?? '').trim());
  if (!match) {
    return null;
  }
  let header;
  let payload;
  try {
    header = parseJson(decodeBase64Url(match[1]));
    payload = parseJson(decodeBase64Url(match[2]));
  } catch {
    return null;
  }
  if (!header || typeof header !== 'object' || !header.alg || !payload || typeof payload !== 'object') {
    return null;
  }
  const exp = Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  return {
    header,
    payload,
    exp,
    iat: Number.isFinite(payload.iat) ? payload.iat * 1000 : null,
    expiresIn: exp === null ? null : exp - now,
  };
}

const printable = (text) => {
  if (!text.length) {
    return false;
  }
  let good = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127 && (code < 0x80 || code >= 0xa0))) {
      good++;
    }
  }
  return good / text.length > 0.95;
};

/** The text inside base64, when it holds text; null otherwise. */
export function readBase64Text(text) {
  const value = String(text ?? '').trim();
  // short ones and plain words are base64 by accident
  if (value.length < 12 || !BASE64.test(value) || /^[a-z]+$/i.test(value) || /^\d+$/.test(value)) {
    return null;
  }
  try {
    const decoded = decodeBase64Url(value);
    return printable(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** A moment from seconds or milliseconds since 1970, or null when the number is not one. */
export function readUnixTime(value) {
  const number = typeof value === 'number' ? value : /^\d{10}(\d{3})?$/.test(String(value ?? '')) ? Number(value) : NaN;
  if (!Number.isFinite(number)) {
    return null;
  }
  if (number >= SECONDS[0] && number < SECONDS[1]) {
    return {ms: Math.round(number * 1000), unit: 's'};
  }
  if (number >= MILLIS[0] && number < MILLIS[1]) {
    return {ms: Math.round(number), unit: 'ms'};
  }
  return null;
}

/**
 * What a value is, for the badge next to it: jwt, json, time, base64, url,
 * or null when it is nothing in particular.
 */
export function recognize(value, {type, now = Date.now()} = {}) {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return null;
  }
  if (type === 'date') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? {kind: 'time', ms, unit: 'date'} : null;
  }
  if (typeof value === 'number' || type === 'long' || type === 'int') {
    const time = readUnixTime(typeof value === 'number' ? value : String(value));
    return time ? {kind: 'time', ...time} : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  const jwt = readJwt(text, now);
  if (jwt) {
    return {kind: 'jwt', ...jwt};
  }
  if (/^[[{]/.test(text)) {
    const json = parseJson(text);
    if (json !== undefined && typeof json === 'object' && json !== null) {
      return {kind: 'json', value: json};
    }
  }
  if (URL_LIKE.test(text)) {
    return {kind: 'url', href: text};
  }
  const time = readUnixTime(text);
  if (time) {
    return {kind: 'time', ...time};
  }
  const decoded = readBase64Text(text);
  return decoded ? {kind: 'base64', text: decoded} : null;
}

/**
 * How long until a moment, in the largest whole unit, for "expires in 14 min".
 * @returns {{past: boolean, count: number, unit: 'sec' | 'min' | 'hour' | 'day'}}
 */
export function relativeTime(ms, now = Date.now()) {
  const delta = ms - now;
  const seconds = Math.abs(delta) / 1000;
  const [count, unit] =
    seconds < 60
      ? [Math.round(seconds), 'sec']
      : seconds < 3600
        ? [Math.round(seconds / 60), 'min']
        : seconds < 86400 * 2
          ? [Math.round(seconds / 3600), 'hour']
          : [Math.round(seconds / 86400), 'day'];
  return {past: delta < 0, count, unit};
}

/** A value as one line of text, for tables, search and the change feed. */
export function valueText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
