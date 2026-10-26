import {LOG_LEVELS} from '../../../shared/findings/log-rules.js';

/**
 * What the search box says, word by word: plain words must all be there (in
 * the tag or the text), `-word` must not, `tag:` and `-tag:` pick or drop
 * tags, `pid:` picks a process, `/…/` is a regular expression, and "two
 * words" in quotes stay together.
 */
export function parseQuery(text = '') {
  const query = {words: [], excluded: [], tags: [], hiddenTags: [], pids: [], regex: null, error: null};
  const tokens = text.match(/-?\w+:"[^"]*"|-?"[^"]*"|\/(?:\\.|[^/])+\/|\S+/g) ?? [];
  for (const raw of tokens) {
    const negative = raw.startsWith('-') && raw.length > 1;
    const token = (negative ? raw.slice(1) : raw).replace(/"/g, '');
    const [, key, value] = token.match(/^(tag|pid):(.+)$/i) ?? [];
    if (raw.length > 2 && raw.startsWith('/') && raw.endsWith('/')) {
      try {
        query.regex = new RegExp(raw.slice(1, -1), 'i');
      } catch (error) {
        query.error = error.message;
      }
    } else if (key?.toLowerCase() === 'tag') {
      (negative ? query.hiddenTags : query.tags).push(value.toLowerCase());
    } else if (key?.toLowerCase() === 'pid' && !negative) {
      query.pids.push(value);
    } else if (token) {
      (negative ? query.excluded : query.words).push(token.toLowerCase());
    }
  }
  return query;
}

export const isEmptyQuery = (query) =>
  !query.words.length &&
  !query.excluded.length &&
  !query.tags.length &&
  !query.hiddenTags.length &&
  !query.pids.length &&
  !query.regex;

/**
 * Whether a log line passes the filters: the app or the whole device, the
 * lowest level, the tags picked or hidden with a click, a rule, and the
 * search box.
 */
export function matchesEntry(entry, {scope = 'device', minLevel = 'V', tags, hiddenTags, rule, query}) {
  if (scope === 'app' && !entry.forApp) {
    return false;
  }
  if (LOG_LEVELS.indexOf(entry.level) < LOG_LEVELS.indexOf(minLevel)) {
    return false;
  }
  const tag = entry.tag.toLowerCase();
  if (tags?.size && !tags.has(entry.tag)) {
    return false;
  }
  if (hiddenTags?.has(entry.tag)) {
    return false;
  }
  if (rule && !entry.hits?.includes(rule)) {
    return false;
  }
  if (!query || isEmptyQuery(query)) {
    return true;
  }
  if (query.tags.length && !query.tags.some((t) => tag.includes(t))) {
    return false;
  }
  if (query.hiddenTags.some((t) => tag.includes(t))) {
    return false;
  }
  if (query.pids.length && !query.pids.includes(String(entry.pid))) {
    return false;
  }
  const text = `${tag} ${entry.message.toLowerCase()}`;
  if (query.excluded.some((word) => text.includes(word))) {
    return false;
  }
  if (!query.words.every((word) => text.includes(word))) {
    return false;
  }
  return !query.regex || query.regex.test(entry.tag) || query.regex.test(entry.message);
}

/**
 * The parts of a message the search found, for marking them: [text, found] pairs.
 */
export function highlightParts(message, query) {
  if (!query || (!query.words.length && !query.regex)) {
    return [[message, false]];
  }
  const sources = query.words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (query.regex) {
    sources.push(query.regex.source);
  }
  let pattern;
  try {
    pattern = new RegExp(`(${sources.join('|')})`, 'gi');
  } catch {
    return [[message, false]];
  }
  const parts = [];
  let last = 0;
  for (const match of message.matchAll(pattern)) {
    if (!match[0]) {
      break;
    }
    if (match.index > last) {
      parts.push([message.slice(last, match.index), false]);
    }
    parts.push([match[0], true]);
    last = match.index + match[0].length;
  }
  if (last < message.length) {
    parts.push([message.slice(last), false]);
  }
  return parts.length ? parts : [[message, false]];
}

/**
 * A rule pattern from a log line: its text with numbers, ids and addresses
 * made general, so the rule catches the same line next time.
 */
export function patternFromLine(message) {
  const line = message.split('\n')[0].slice(0, 120);
  return line
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/0x[0-9a-f]+/gi, '0x[0-9a-f]+')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, '[0-9a-f-]+')
    .replace(/\d+/g, '\\d+');
}
