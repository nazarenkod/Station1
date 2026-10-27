import {LOG_LEVELS} from '../findings/log-rules.js';
import {endpointOf, mergeTrafficRules, TRAFFIC_RULES} from '../findings/traffic-rules.js';
import {MOCK_ACTIONS} from '../proxy/mock-rules.js';
import {compileMasks, maskHeaders, maskText, maskUrl} from './privacy.js';

// What the station tools give the agent and how they change the station,
// as plain functions over the data: the proxy's exchanges, the log entries,
// the findings, the settings. Summaries first; rows, bodies and fields only
// when asked for. Everything that leaves goes through the masks.

const DEFAULT_ROWS = 20;
const DEFAULT_LOG_ROWS = 50;
const DEFAULT_BODY = 4000;
const MAX_ROWS = 100;

const minutesAgo = (minutes, now) => (minutes ? now - minutes * 60000 : 0);
const clampRows = (limit, fallback) => Math.max(1, Math.min(MAX_ROWS, Number(limit) || fallback));

// "4xx", "5xx", "422", "error" (no answer)
function statusMatches(status, wanted) {
  if (!wanted) {
    return true;
  }
  const text = String(wanted).toLowerCase();
  if (text === 'error') {
    return status === null || status === undefined;
  }
  if (/^\dxx$/.test(text)) {
    return Math.floor((status ?? 0) / 100) === Number(text[0]);
  }
  return String(status) === text;
}

const flagsOf = (exchange) => [...new Set((exchange.flags ?? []).map((flag) => flag.kind ?? flag.rule ?? flag))];

// ---- traffic

/**
 * What the traffic looks like without its rows: endpoints by count, with
 * statuses, times and flags.
 */
export function trafficStats(exchanges, {sinceMinutes, host, now = Date.now()} = {}) {
  const since = minutesAgo(sinceMinutes, now);
  const groups = new Map();
  let total = 0;
  for (const exchange of exchanges) {
    if (exchange.startedAt < since) {
      continue;
    }
    const endpoint = endpointOf(exchange.url);
    if (host && !endpoint.host.includes(host)) {
      continue;
    }
    total++;
    const key = `${exchange.method} ${endpoint.host}${endpoint.path}`;
    const group = groups.get(key) ?? {endpoint: key, count: 0, statuses: {}, maxMs: 0, totalMs: 0, timed: 0, flags: {}};
    group.count++;
    const status = exchange.status ?? 'no answer';
    group.statuses[status] = (group.statuses[status] ?? 0) + 1;
    if (exchange.durationMs !== null && exchange.durationMs !== undefined) {
      group.totalMs += exchange.durationMs;
      group.timed++;
      group.maxMs = Math.max(group.maxMs, exchange.durationMs);
    }
    for (const flag of flagsOf(exchange)) {
      group.flags[flag] = (group.flags[flag] ?? 0) + 1;
    }
    groups.set(key, group);
  }
  const endpoints = [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 40)
    .map(({totalMs, timed, ...group}) => ({...group, avgMs: timed ? Math.round(totalMs / timed) : null}));
  return {requests: total, endpoints: groups.size, top: endpoints};
}

/** One line of a request: enough to pick it, its id to get it whole. */
function trafficLine(exchange, masks) {
  const flags = flagsOf(exchange);
  return [
    exchange.id,
    exchange.method,
    maskUrl(exchange.url, masks),
    exchange.status ?? 'no answer',
    exchange.durationMs === null || exchange.durationMs === undefined ? '' : `${exchange.durationMs}ms`,
    flags.length ? `flags: ${flags.join(',')}` : '',
    new Date(exchange.startedAt).toISOString().slice(11, 19),
  ]
    .filter((part) => part !== '')
    .join(' · ');
}

/** Requests that match, newest first, a line each, in pages. */
export function trafficSearch(exchanges, filters = {}, {now = Date.now(), masks = compileMasks()} = {}) {
  const since = minutesAgo(filters.sinceMinutes, now);
  const method = filters.method?.toUpperCase();
  const path = filters.path ? String(filters.path).toLowerCase() : null;
  const matching = exchanges
    .filter(
      (exchange) =>
        exchange.startedAt >= since &&
        (!method || exchange.method === method) &&
        (!filters.host || endpointOf(exchange.url).host.includes(filters.host)) &&
        (!path || exchange.url.toLowerCase().includes(path)) &&
        statusMatches(exchange.status, filters.status) &&
        (!filters.flag || flagsOf(exchange).some((flag) => String(flag).includes(filters.flag))),
    )
    .sort((a, b) => b.startedAt - a.startedAt);
  const limit = clampRows(filters.limit, DEFAULT_ROWS);
  const offset = Math.max(0, Number(filters.offset) || 0);
  return {
    total: matching.length,
    offset,
    rows: matching.slice(offset, offset + limit).map((exchange) => trafficLine(exchange, masks)),
    more: Math.max(0, matching.length - offset - limit),
  };
}

// "response.body.items[0].id" -> the value at that path of a parsed body
function pick(value, path) {
  let current = value;
  for (const part of path.split(/\.|\[(\d+)\]/).filter(Boolean)) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[/^\d+$/.test(part) ? Number(part) : part];
  }
  return current;
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * One request: method, address, status, time, findings, headers without
 * secrets and a part of each body; with `fields` only those JSON paths
 * (`request.body.purpose`, `response.body.items[0].id`, `request.query.page`).
 */
export function trafficGet(exchange, {fields, bodyLimit = DEFAULT_BODY, masks = compileMasks()} = {}) {
  if (!exchange) {
    return {error: 'No request with this id; search again, the proxy keeps the last few thousand.'};
  }
  const base = {
    id: exchange.id,
    method: exchange.method,
    url: maskUrl(exchange.url, masks),
    status: exchange.status ?? 'no answer',
    durationMs: exchange.durationMs ?? null,
    flags: flagsOf(exchange),
    mockedBy: exchange.mockRules?.length ? exchange.mockRules : undefined,
  };
  const body = (text, binary) =>
    binary ? `(binary, ${text?.length ?? 0} bytes)` : maskText(String(text ?? '').slice(0, bodyLimit), masks);
  if (fields?.length) {
    const sources = {
      request: {
        body: parseJson(exchange.requestBody),
        headers: maskHeaders(exchange.requestHeaders, masks),
        query: Object.fromEntries(new URL(exchange.url, 'http://x').searchParams),
      },
      response: {body: parseJson(exchange.responseBody), headers: maskHeaders(exchange.responseHeaders, masks)},
    };
    const values = Object.fromEntries(
      fields.map((field) => {
        const value = pick(sources, field);
        const text = value === undefined ? '(absent)' : JSON.stringify(value);
        return [field, maskText(text.slice(0, bodyLimit), masks)];
      }),
    );
    return {...base, fields: values};
  }
  return {
    ...base,
    requestHeaders: maskHeaders(exchange.requestHeaders, masks),
    requestBody: body(exchange.requestBody, exchange.requestBinary),
    responseHeaders: maskHeaders(exchange.responseHeaders, masks),
    responseBody: body(exchange.responseBody, exchange.responseBinary),
    bodiesCut:
      (exchange.requestBody?.length ?? 0) > bodyLimit || (exchange.responseBody?.length ?? 0) > bodyLimit || undefined,
  };
}

// ---- logs

const levelAtLeast = (level, min) => LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(min ?? 'V');

// a log line carries "MM-DD" and "HH:MM:SS.mmm" without a year; null when it has no time
const logTime = (entry, now) => {
  if (!entry.date || !entry.time) {
    return null;
  }
  const parsed = Date.parse(`${new Date(now).getFullYear()}-${entry.date}T${entry.time}`);
  return Number.isNaN(parsed) ? null : parsed;
};
const before = (entry, since, now) => {
  const time = since ? logTime(entry, now) : null;
  return time !== null && time < since;
};

/** What the log looks like without its lines: levels, the busiest tags, the errors. */
export function logsStats(entries, {sinceMinutes, now = Date.now()} = {}) {
  const since = minutesAgo(sinceMinutes, now);
  const levels = {};
  const tags = new Map();
  let total = 0;
  for (const entry of entries) {
    if (entry.kind === 'marker' || before(entry, since, now)) {
      continue;
    }
    total++;
    levels[entry.level] = (levels[entry.level] ?? 0) + 1;
    const tag = tags.get(entry.tag) ?? {tag: entry.tag, count: 0, errors: 0};
    tag.count++;
    if (levelAtLeast(entry.level, 'E')) {
      tag.errors++;
    }
    tags.set(entry.tag, tag);
  }
  const top = [...tags.values()].sort((a, b) => b.errors - a.errors || b.count - a.count).slice(0, 25);
  return {lines: total, levels, tags: tags.size, top};
}

// a line is known by its sequence number, the same the log tool shows
const logLine = (entry, index, masks) =>
  `#${entry.seq ?? index} ${entry.time ?? ''} ${entry.level} ${entry.tag}: ${maskText(
    String(entry.message ?? '')
      .split('\n')[0]
      .slice(0, 300),
    masks,
  )}`;

/** Lines that match, newest first, with a few lines around each when asked. */
export function logsSearch(entries, filters = {}, {now = Date.now(), masks = compileMasks()} = {}) {
  const since = minutesAgo(filters.sinceMinutes, now);
  let regex = null;
  if (filters.regex) {
    try {
      regex = new RegExp(filters.regex, 'i');
    } catch {
      return {error: `Not a valid regular expression: ${filters.regex}`};
    }
  }
  const text = filters.text ? String(filters.text).toLowerCase() : null;
  const hits = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (
      entry.kind !== 'marker' &&
      !before(entry, since, now) &&
      levelAtLeast(entry.level, filters.level) &&
      (!filters.tag || entry.tag === filters.tag) &&
      (!text || String(entry.message).toLowerCase().includes(text)) &&
      (!regex || regex.test(entry.message))
    ) {
      hits.push(index);
    }
  }
  const limit = clampRows(filters.limit, DEFAULT_LOG_ROWS);
  const offset = Math.max(0, Number(filters.offset) || 0);
  const around = Math.min(5, Math.max(0, Number(filters.context) || 0));
  const rows = hits.slice(offset, offset + limit).map((index) => {
    if (!around) {
      return logLine(entries[index], index, masks);
    }
    const from = Math.max(0, index - around);
    return entries
      .slice(from, index + around + 1)
      .filter((entry) => entry.kind !== 'marker')
      .map((entry, at) => `${from + at === index ? '>' : ' '} ${logLine(entry, from + at, masks)}`)
      .join('\n');
  });
  return {total: hits.length, offset, rows, more: Math.max(0, hits.length - offset - limit)};
}

// ---- findings

/** The findings of the station by source and severity, then the first ones. */
export function findingsList(findings, {source, severity, limit} = {}, {masks = compileMasks()} = {}) {
  const matching = findings.filter(
    (finding) => (!source || finding.tool === source) && (!severity || finding.severity === severity),
  );
  const counts = {};
  for (const finding of matching) {
    counts[`${finding.tool}/${finding.severity}`] = (counts[`${finding.tool}/${finding.severity}`] ?? 0) + 1;
  }
  return {
    total: matching.length,
    counts,
    rows: matching.slice(0, clampRows(limit, DEFAULT_ROWS)).map((finding) => ({
      id: finding.id,
      tool: finding.tool,
      rule: finding.rule,
      severity: finding.severity,
      subject: maskText(String(finding.subject ?? '').slice(0, 200), masks),
      count: finding.count ?? undefined,
    })),
  };
}

// ---- changes: each gives the new value of a setting, or an error

const ruleId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/**
 * A mock rule added, changed, removed, turned on or off. The rule takes the
 * shape the proxy's rule editor makes.
 * @returns {{value: object, summary: string} | {error: string}}
 */
export function changeMock(config, {op, rule = {}, id}) {
  const rules = [...(config.mockRules ?? [])];
  const at = rules.findIndex((one) => one.id === (id ?? rule.id));
  if (op === 'add') {
    if (!rule.url) {
      return {error: 'A mock rule needs a url pattern (* for anything), e.g. "*/api/v2/limits".'};
    }
    if (rule.action && !MOCK_ACTIONS.includes(rule.action)) {
      return {error: `action is one of ${MOCK_ACTIONS.join(', ')}`};
    }
    const added = {
      id: ruleId(),
      name: '',
      enabled: true,
      method: '',
      action: 'respond',
      headers: '',
      body: '',
      target: '',
      delayMs: 3000,
      stage: 'response',
      ...rule,
      status: String(rule.status ?? '200'),
    };
    return {
      value: {...config, mockRules: [...rules, added]},
      summary: `mock ${added.action} ${added.method || '*'} ${added.url}`,
      id: added.id,
    };
  }
  if (at < 0) {
    return {error: 'No mock rule with this id; read the rules with settings_get group "proxy".'};
  }
  if (op === 'remove') {
    return {
      value: {...config, mockRules: rules.filter((_, index) => index !== at)},
      summary: `mock removed ${rules[at].url}`,
    };
  }
  if (op === 'enable' || op === 'disable') {
    rules[at] = {...rules[at], enabled: op === 'enable'};
    return {value: {...config, mockRules: rules}, summary: `mock ${op}d ${rules[at].url}`};
  }
  if (op === 'update') {
    rules[at] = {...rules[at], ...rule, id: rules[at].id};
    return {value: {...config, mockRules: rules}, summary: `mock changed ${rules[at].url}`};
  }
  return {error: 'op is one of add, update, remove, enable, disable'};
}

/** Traffic rules changed by parts: only the known rules and their fields. */
export function changeTrafficRules(config, rules = {}) {
  const current = config.trafficRules ?? {};
  const next = {...current};
  for (const [name, patch] of Object.entries(rules ?? {})) {
    if (!TRAFFIC_RULES[name] || typeof patch !== 'object' || patch === null) {
      return {error: `Unknown traffic rule "${name}"; the rules are ${Object.keys(TRAFFIC_RULES).join(', ')}.`};
    }
    const known = Object.fromEntries(Object.entries(patch).filter(([field]) => field in TRAFFIC_RULES[name]));
    next[name] = {...current[name], ...known};
  }
  mergeTrafficRules(next);
  return {value: {...config, trafficRules: next}, summary: `traffic rules ${Object.keys(rules).join(', ')}`};
}

/** A custom log rule added, changed or removed, or a built-in one switched. */
export function changeLogRules(config, {op, rule = {}, id}) {
  const custom = [...(config.custom ?? [])];
  if (op === 'override') {
    if (!id) {
      return {error: 'Give the id of the built-in rule, e.g. "log-strict-mode".'};
    }
    return {
      value: {...config, overrides: {...config.overrides, [id]: {...config.overrides?.[id], ...rule}}},
      summary: `log rule ${id} changed`,
    };
  }
  if (op === 'add') {
    try {
      new RegExp(rule.pattern, 'i');
    } catch {
      return {error: 'pattern must be a valid regular expression'};
    }
    if (!rule.pattern || !rule.name) {
      return {error: 'A log rule needs a name and a pattern.'};
    }
    const added = {id: ruleId(), severity: 'medium', scope: 'app', minLevel: 'V', tag: '', ...rule};
    return {value: {...config, custom: [...custom, added]}, summary: `log rule added ${added.name}`, id: added.id};
  }
  const at = custom.findIndex((one) => one.id === (id ?? rule.id));
  if (at < 0) {
    return {error: 'No custom log rule with this id.'};
  }
  if (op === 'remove') {
    return {
      value: {...config, custom: custom.filter((_, index) => index !== at)},
      summary: `log rule removed ${custom[at].name}`,
    };
  }
  custom[at] = {...custom[at], ...rule, id: custom[at].id};
  return {value: {...config, custom}, summary: `log rule changed ${custom[at].name}`};
}

const VIEW_FIELDS = {
  proxy: ['view', 'hiddenHosts', 'onlyHosts'],
  logs: ['scope', 'minLevel', 'query', 'tags', 'hiddenTags'],
};

/** A filter of the proxy or the log, by its known fields only. */
export function changeView(view, which, patch = {}) {
  const fields = VIEW_FIELDS[which];
  if (!fields) {
    return {error: 'which is proxy or logs'};
  }
  const known = Object.fromEntries(Object.entries(patch ?? {}).filter(([field]) => fields.includes(field)));
  if (!Object.keys(known).length) {
    return {error: `Nothing to change; the fields are ${fields.join(', ')}.`};
  }
  return {value: {...view, ...known}, summary: `${which} filter ${Object.keys(known).join(', ')}`};
}
