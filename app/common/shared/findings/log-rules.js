import {makeFinding} from './findings.js';

export const LOG_LEVELS = ['V', 'D', 'I', 'W', 'E', 'F'];
const levelIndex = (level) => Math.max(0, LOG_LEVELS.indexOf(level));

/**
 * The built-in log rules. `scope: app` looks only at the app's own process;
 * `device` reads the whole stream, because some problems of the app are
 * written by the system (an ANR comes from system_server).
 */
export const LOG_RULES = {
  'log-crash': {severity: 'high', scope: 'app'},
  'log-native-crash': {severity: 'high', scope: 'device'},
  'log-anr': {severity: 'high', scope: 'device'},
  'log-strict-mode': {severity: 'low', scope: 'app'},
  'log-ios-exception': {severity: 'high', scope: 'app'},
};

// numbers, ids and addresses change from one run to the next; the problem does not
const normalize = (text) =>
  text
    .replace(/0x[0-9a-f]+/gi, '0x…')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '…')
    .replace(/\d+/g, '#')
    .slice(0, 200);

const firstLine = (message) => message.split('\n', 1)[0];

// the exception line of a Java stack trace: "java.lang.IllegalStateException: text"
const exceptionOf = (message) =>
  message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^([\w$]+\.)+[\w$]*(Exception|Error|Throwable)\b/.test(line)) ?? '';

const BUILT_IN = {
  'log-crash': (entry) => {
    if (entry.tag !== 'AndroidRuntime' || !entry.message.startsWith('FATAL EXCEPTION')) {
      return null;
    }
    const exception = exceptionOf(entry.message);
    const type = exception.split(':')[0];
    // the same crash is the same exception thrown from the same place, whatever the message says
    const frame = /^\s*at ([\w$.<>]+)\(/m.exec(entry.message)?.[1] ?? '';
    return {subject: `${type || normalize(firstLine(entry.message))} @ ${frame}`, params: {exception: type}};
  },
  'log-native-crash': (entry, context) => {
    const match = /^Fatal signal (\d+) \((\w+)\).*?pid \d+ \(([^)]+)\)/.exec(entry.message);
    if (entry.tag !== 'libc' || !match) {
      return null;
    }
    return {
      subject: `${match[2]} ${match[3]}`,
      params: {signal: match[2], process: match[3]},
      forApp: context.isApp(entry),
    };
  },
  'log-anr': (entry, context) => {
    const match = /^ANR in (\S+)/.exec(entry.message);
    if (entry.tag !== 'ActivityManager' || !match) {
      return null;
    }
    const reason = /Reason: (.*)/.exec(entry.message)?.[1] ?? '';
    return {
      subject: `${match[1]} ${normalize(reason)}`,
      params: {app: match[1], reason},
      forApp: !!context.appId && match[1].startsWith(context.appId),
    };
  },
  'log-strict-mode': (entry) => {
    if (entry.tag !== 'StrictMode' || !/Violation/.test(entry.message)) {
      return null;
    }
    const violation = /(\w+Violation)/.exec(entry.message)?.[1] ?? 'Violation';
    return {subject: violation, params: {violation}};
  },
  'log-ios-exception': (entry) => {
    const match = /Terminating app due to uncaught exception '(\w+)'/.exec(entry.message);
    return match ? {subject: match[1], params: {exception: match[1]}} : null;
  },
};

/**
 * A project's own rule: a pattern (a regular expression) in the message,
 * optionally only for a tag and from a level up.
 */
export function compileCustomRule(rule) {
  let pattern;
  try {
    pattern = new RegExp(rule.pattern, 'i');
  } catch {
    return null;
  }
  const tag = rule.tag?.trim() || null;
  const minLevel = levelIndex(rule.minLevel ?? 'V');
  return {
    id: `log-custom-${rule.id}`,
    severity: rule.severity ?? 'medium',
    scope: rule.scope ?? 'app',
    name: rule.name,
    check: (entry) => {
      if ((tag && entry.tag !== tag) || levelIndex(entry.level) < minLevel) {
        return null;
      }
      const match = pattern.exec(entry.message);
      return match ? {subject: normalize(match[0]), params: {name: rule.name, match: match[0].slice(0, 120)}} : null;
    },
  };
}

/**
 * Checks log entries one by one against the built-in rules (with the
 * project's overrides) and the custom ones. `context.isApp(entry)` tells
 * whether an entry comes from the app's process.
 */
export function createLogRuleEngine({overrides = {}, custom = []} = {}) {
  const rules = [
    ...Object.entries(BUILT_IN)
      .map(([id, check]) => ({id, check, ...LOG_RULES[id], ...(overrides[id] ?? {})}))
      .filter((rule) => rule.enabled !== false),
    ...custom
      .filter((rule) => rule.enabled !== false)
      .map(compileCustomRule)
      .filter(Boolean),
  ];

  return {
    rules,
    check(entry, context) {
      const hits = [];
      for (const rule of rules) {
        if (rule.scope === 'app' && !context.isApp(entry)) {
          continue;
        }
        const hit = rule.check(entry, context);
        if (!hit) {
          continue;
        }
        const {forApp = rule.scope === 'app', ...details} = hit;
        const custom = rule.id.startsWith('log-custom-');
        hits.push({
          ...makeFinding({
            tool: 'logs',
            rule: rule.id,
            severity: rule.severity,
            scope: context.appId ?? '',
            ...details,
            subject: `${rule.id}\n${details.subject}`,
            evidence: [firstLine(entry.message)],
          }),
          // the texts of every custom rule are one template filled with its name
          textKey: custom ? 'log-custom' : rule.id,
          forApp,
        });
      }
      return hits;
    },
  };
}
