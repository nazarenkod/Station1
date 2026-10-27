import {valueText} from './values.js';

// One search over all the data of an app: keys and values of preferences,
// file names and the text inside text files. Rows of databases are searched
// by SQLite itself and merged in by the caller.

export const SEARCH_LIMIT = 50;

/** Where the text is in a line: [start, end), case-insensitive; null when it is not there. */
export function matchRange(line, text) {
  const index = String(line ?? '')
    .toLowerCase()
    .indexOf(String(text ?? '').toLowerCase());
  return index < 0 ? null : [index, index + text.length];
}

// a long line cut around the match, so the result shows where it is
function excerpt(line, range, room = 60) {
  const start = Math.max(0, range[0] - room);
  const end = Math.min(line.length, range[1] + room);
  return {
    text: `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`,
    range: [range[0] - start + (start > 0 ? 1 : 0), range[1] - start + (start > 0 ? 1 : 0)],
  };
}

/**
 * @param {object} data
 * @param {{file: string, entries: {key: string, value: any}[]}[]} data.prefs
 * @param {{path: string}[]} data.files
 * @param {{path: string, text: string}[]} data.texts the text files read for the search
 * @param {{file: string, table: string, column: string, key: string, value: any}[]} [data.rows] matches SQLite found
 * @param {string} text
 */
export function searchAppData({prefs = [], files = [], texts = [], rows = []}, text, limit = SEARCH_LIMIT) {
  const query = String(text ?? '').trim();
  if (!query) {
    return {query, prefs: [], rows: [], files: [], texts: [], total: 0};
  }
  const found = {query, prefs: [], rows: [], files: [], texts: []};

  for (const file of prefs) {
    for (const entry of file.entries ?? []) {
      if (found.prefs.length >= limit) {
        break;
      }
      const value = valueText(entry.value);
      const inKey = matchRange(entry.key, query);
      const inValue = matchRange(value, query);
      if (inKey || inValue) {
        found.prefs.push({
          file: file.file,
          key: entry.key,
          keyRange: inKey,
          value: inValue ? excerpt(value, inValue) : {text: value.slice(0, 120), range: null},
        });
      }
    }
  }

  found.rows = rows.slice(0, limit).map((row) => {
    const value = valueText(row.value);
    const range = matchRange(value, query);
    return {...row, value: range ? excerpt(value, range) : {text: value.slice(0, 120), range: null}};
  });

  for (const file of files) {
    if (found.files.length >= limit) {
      break;
    }
    const range = matchRange(file.path, query);
    if (range) {
      found.files.push({path: file.path, range});
    }
  }

  for (const {path, text: content} of texts) {
    const lines = String(content ?? '').split('\n');
    for (let i = 0; i < lines.length && found.texts.length < limit; i++) {
      const range = matchRange(lines[i], query);
      if (range) {
        found.texts.push({path, line: i + 1, ...excerpt(lines[i], range)});
      }
    }
  }

  found.total = found.prefs.length + found.rows.length + found.files.length + found.texts.length;
  return found;
}
