// The station journal: what the station does inside (commands it runs, calls
// from the interface, errors), kept for whoever has to find out why it hangs.

export const JOURNAL_LIMIT = 5000;
// a command or call running longer than this is marked as slow
export const SLOW_MS = 5000;
export const LEVELS = ['error', 'warn', 'info', 'debug'];
export const SOURCES = ['command', 'ipc', 'appium', 'proxy', 'ui', 'station'];

const MASK = '•••';
const DETAIL_LIMIT = 4000;

const SECRET_PATTERNS = [
  // headers: Authorization: Bearer abc, Cookie: a=b
  [
    /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|private-token)(["']?\s*[:=]\s*)[^\n]+/gi,
    `$1$2${MASK}`,
  ],
  [/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, `$1 ${MASK}`],
  // key=value and "key": "value" pairs, in URLs, JSON and arguments
  [
    /\b([\w-]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|client[_-]?secret)[\w-]*)(["']?\s*[:=]\s*["']?)([^\s"'&,;}]+)/gi,
    `$1$2${MASK}`,
  ],
  // known token shapes: GitLab, Anthropic, OpenAI, GitHub, Jira (Atlassian)
  [/\b(glpat-|sk-ant-|sk-|ghp_|gho_|github_pat_|ATATT)[\w-]{8,}/g, `$1${MASK}`],
];

/**
 * Masks tokens, keys and passwords in a text before it is kept or shown.
 */
export function redact(text) {
  if (text == null) {
    return text;
  }
  let result = String(text);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

const tail = (text, limit = DETAIL_LIMIT) => (text.length > limit ? `…${text.slice(-limit)}` : text);

const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${String(arg).replaceAll("'", "'\\''")}'`);

/**
 * A command as one would type it in a terminal, with secrets masked.
 */
export function describeCommand(command, args = []) {
  return redact([command, ...args].map((part) => quote(String(part))).join(' '));
}

/**
 * How a command ended, for its journal record: a timeout is an error, a
 * failure or a missing tool a warning; a failure keeps the end of stderr.
 * stdout is never kept: it may be a whole environment or a file.
 */
export function commandOutcome(result) {
  if (result.timedOut) {
    return {level: 'error', outcome: 'timeout', detail: tail(redact(result.stderr ?? ''))};
  }
  if (result.missing) {
    return {level: 'warn', outcome: 'missing'};
  }
  if (!result.ok) {
    return {level: 'warn', outcome: `exit ${result.code ?? '?'}`, detail: tail(redact(result.stderr ?? ''))};
  }
  return {level: 'info', outcome: 'exit 0'};
}

/**
 * The records of one run of the station: added at once or opened and closed
 * later (a command, a call). Holds the newest `limit` records; a record still
 * running is never dropped.
 */
export function createJournal({limit = JOURNAL_LIMIT, now = () => Date.now()} = {}) {
  let entries = [];
  let nextId = 1;
  const listeners = new Set();

  const emit = (entry) => {
    for (const listener of listeners) {
      listener(entry);
    }
  };

  const trim = () => {
    if (entries.length <= limit) {
      return;
    }
    let extra = entries.length - limit;
    entries = entries.filter((entry) => {
      if (extra > 0 && entry.state !== 'running') {
        extra--;
        return false;
      }
      return true;
    });
  };

  const clean = (entry) => ({
    ...entry,
    text: redact(entry.text ?? ''),
    ...(entry.detail ? {detail: tail(redact(entry.detail))} : {}),
  });

  const add = (entry) => {
    const record = {id: nextId++, time: now(), level: 'info', source: 'station', ...clean(entry)};
    entries.push(record);
    trim();
    emit(record);
    return record;
  };

  return {
    add,
    /** Opens a record that runs; returns its id for `end`. */
    begin(entry) {
      return add({level: 'debug', ...entry, state: 'running'}).id;
    },
    /** Closes a running record with how it ended. */
    end(id, patch = {}) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) {
        return null;
      }
      const record = entries[index];
      const updated = {...record, ...clean({...record, ...patch}), state: 'done', duration: now() - record.time};
      entries[index] = updated;
      emit(updated);
      return updated;
    },
    list: () => entries.slice(),
    clear() {
      // a record still running stays: its end must find it
      entries = entries.filter((entry) => entry.state === 'running');
      emit(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Applies a record that changed to a list of records: replaces the one with
 * the same id or appends it. Used where records arrive as a stream.
 */
export function mergeEntries(entries, changed) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of changed) {
    byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * What the dot of the journal in the title bar says: the errors and
 * warnings recorded since the person last looked at the journal, each record
 * once (a command that failed is one record, however often it changed).
 * @returns {{errors: number, warnings: number, status: 'ok' | 'warn' | 'error'}}
 */
export function journalHealth(entries, since = 0) {
  const latest = new Map();
  for (const entry of entries ?? []) {
    latest.set(entry.id, entry);
  }
  let errors = 0;
  let warnings = 0;
  for (const entry of latest.values()) {
    if ((entry.time ?? 0) < since) {
      continue;
    }
    if (entry.level === 'error') {
      errors++;
    } else if (entry.level === 'warn') {
      warnings++;
    }
  }
  return {errors, warnings, status: errors ? 'error' : warnings ? 'warn' : 'ok'};
}

const LEVEL_FILTER = {
  error: ['error'],
  warn: ['error', 'warn'],
  all: LEVELS,
};

/**
 * The records matching a level (`error`, `warn` or `all`), sources (none
 * means all) and a search text.
 */
export function filterEntries(entries, {level = 'all', sources = [], query = ''} = {}) {
  const levels = LEVEL_FILTER[level] ?? LEVELS;
  const needle = query.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      levels.includes(entry.level) &&
      (!sources.length || sources.includes(entry.source)) &&
      (!needle || `${entry.text}\n${entry.detail ?? ''}`.toLowerCase().includes(needle)),
  );
}

/**
 * Records still running, longest first, with how long they have been running.
 */
export function runningEntries(entries, now = Date.now()) {
  return entries
    .filter((entry) => entry.state === 'running')
    .map((entry) => ({...entry, elapsed: now - entry.time, slow: now - entry.time >= SLOW_MS}))
    .sort((a, b) => b.elapsed - a.elapsed);
}

const pad = (value, size = 2) => String(value).padStart(size, '0');

export function formatTime(time) {
  const date = new Date(time);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function formatDuration(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The summary of a run as lines `name: value`.
 */
export function formatSummary(summary = {}) {
  const shellEnv = summary.shellEnv;
  const lines = [
    ['app', summary.app && `${summary.app} ${summary.version ?? ''}`.trim()],
    ['started', summary.startedAt && new Date(summary.startedAt).toISOString()],
    ['os', summary.os && `${summary.os} ${summary.arch ?? ''}`.trim()],
    ['electron', summary.electron],
    ['node', summary.node],
    ['shell', summary.shell],
    [
      'shell env',
      shellEnv &&
        (shellEnv.ok
          ? `read in ${formatDuration(shellEnv.ms)}`
          : `${shellEnv.timedOut ? 'timed out' : 'failed'} after ${formatDuration(shellEnv.ms)}`),
    ],
    ['PATH', summary.path],
    ['ANDROID_HOME', summary.androidHome],
    ['JAVA_HOME', summary.javaHome],
  ];
  return lines
    .filter(([, value]) => value)
    .flatMap(([name, value]) =>
      // a PATH reads as its folders, one a line, in the order they are searched
      name === 'PATH'
        ? [
            `${name}:`,
            ...String(value)
              .split(':')
              .filter(Boolean)
              .map((dir) => `  ${redact(dir)}`),
          ]
        : [`${name}: ${redact(value)}`],
    );
}

/**
 * The whole journal as text: the summary, then every record, oldest first.
 */
export function formatJournal({summary, entries = [], now = Date.now()}) {
  const records = entries.map((entry) => {
    const timing =
      entry.state === 'running'
        ? ` (running ${formatDuration(now - entry.time)})`
        : entry.duration != null
          ? ` (${formatDuration(entry.duration)})`
          : '';
    const outcome = entry.outcome ? ` → ${entry.outcome}` : '';
    const head = `${formatTime(entry.time)} ${entry.level.toUpperCase().padEnd(5)} ${entry.source.padEnd(7)} ${entry.text}${outcome}${timing}`;
    return entry.detail ? `${head}\n${entry.detail.replace(/^/gm, '    ')}` : head;
  });
  return [...formatSummary(summary), '', ...records].join('\n');
}
