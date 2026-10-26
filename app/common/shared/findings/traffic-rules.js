import {urlMatcher} from '../proxy/mock-rules.js';
import {makeFinding} from './findings.js';

/**
 * The traffic rules with their defaults; a project changes the numbers and
 * the lists in its rules.
 */
export const TRAFFIC_RULES = {
  duplicates: {
    enabled: true,
    severity: 'medium',
    windowMs: 2000,
    minRepeats: 2,
    // what makes two requests the same besides the method and the path
    query: 'all',
    ignoreParams: [],
    body: 'all',
    ignoreFields: [],
    // "GET */orders/*/status poll 1000", "*/profile allow 3 in 30s", "*/ping ignore"
    expected: [],
    // patterns that are never duplicates, kept from before the expected repeats
    ignore: [],
  },
  slow: {enabled: true, severity: 'medium', defaultMs: 1500, overrides: []},
  errors: {enabled: true, severity: 'high', except: []},
  // "*/api/* header:Authorization", "GET */profile response.body:data.user.id"
  contract: {enabled: true, severity: 'medium', required: []},
  ignore: {hosts: [], paths: []},
};

export function mergeTrafficRules(overrides = {}) {
  return Object.fromEntries(
    Object.entries(TRAFFIC_RULES).map(([key, rule]) => [key, {...rule, ...(overrides[key] ?? {})}]),
  );
}

// /api/v2/cards/1287/details and /api/v2/cards/1288/details are the same endpoint
export function endpointOf(url) {
  try {
    const {host, pathname} = new URL(url);
    const path = pathname
      .split('/')
      .map((segment) =>
        /^\d+$/.test(segment) ||
        /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
        (/^[0-9a-f]{16,}$/i.test(segment) && /\d/.test(segment))
          ? '{id}'
          : segment,
      )
      .join('/');
    return {host, path};
  } catch {
    return {host: '', path: url};
  }
}

// "GET /api/v2/history* 2500" -> a matcher and a number
const parseLine = (line) => {
  const parts = String(line).trim().split(/\s+/);
  const method = /^[A-Z]+$/.test(parts[0]) && parts.length > 1 ? parts.shift() : null;
  const number = parts.length > 1 && /^\d+$/.test(parts.at(-1)) ? Number(parts.pop()) : null;
  const matches = urlMatcher(parts.join(' '));
  return {
    line: String(line).trim(),
    test: (exchange) => (!method || exchange.method === method) && matches(exchange.url),
    number,
  };
};

// a method, then the address pattern, then what the line says about it
const splitLine = (line) => {
  const parts = String(line).trim().split(/\s+/).filter(Boolean);
  const method = /^[A-Z]+$/.test(parts[0]) && parts.length > 1 ? parts.shift() : null;
  return {method, pattern: parts.shift() ?? '', rest: parts};
};

const matcherOf = (method, pattern) => {
  const matches = urlMatcher(pattern);
  return (exchange) => (!method || exchange.method === method) && matches(exchange.url);
};

// "1500ms", "30s", "2m" or a bare number of milliseconds
export function parseDuration(text) {
  const [, number, unit = 'ms'] = String(text ?? '').match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i) ?? [];
  if (!number) {
    return null;
  }
  return Math.round(Number(number) * {ms: 1, s: 1000, m: 60_000}[unit.toLowerCase()]);
}

/**
 * A line of expected repeats: `poll <ms>`, `allow <N> in <time>` or `ignore`.
 * A line it cannot read gives null and is left out.
 */
export function parseExpectedRepeat(line) {
  const {method, pattern, rest} = splitLine(line);
  const [mode, ...args] = rest.map((part) => part.toLowerCase());
  const test = matcherOf(method, pattern);
  if (!pattern) {
    return null;
  }
  if (mode === 'ignore') {
    return {test, mode};
  }
  if (mode === 'poll') {
    const intervalMs = parseDuration(args[0] ?? '0');
    return intervalMs === null ? null : {test, mode, intervalMs};
  }
  if (mode === 'allow' && /^\d+$/.test(args[0] ?? '') && args[1] === 'in') {
    const withinMs = parseDuration(args[2]);
    return withinMs === null ? null : {test, mode, times: Number(args[0]), withinMs};
  }
  return null;
}

/**
 * A line of required fields: the address and one or more of `header:<Name>`,
 * `response.header:<Name>` and `response.body:<path.to.field>`.
 */
export function parseRequirement(line) {
  const {method, pattern, rest} = splitLine(line);
  const needs = rest
    .map((part) => part.match(/^(header|response\.header|response\.body):(.+)$/i))
    .filter(Boolean)
    .map(([text, where, name]) => ({text, where: where.toLowerCase(), name}));
  return pattern && needs.length ? {test: matcherOf(method, pattern), needs} : null;
}

// "data.items[0].id" -> ['data', 'items', '0', 'id']
const pathParts = (path) =>
  path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

const hasPath = (value, path) => {
  let current = value;
  for (const part of pathParts(path)) {
    if (current === null || typeof current !== 'object' || !(part in current)) {
      return false;
    }
    current = current[part];
  }
  return true;
};

const parseJson = (text) => {
  try {
    return {ok: true, value: JSON.parse(text)};
  } catch {
    return {ok: false};
  }
};

// drops a field by its path from the root, or by its name at any depth
const withoutFields = (value, fields) => {
  const names = new Set(fields.filter((field) => !field.includes('.')));
  const paths = fields.filter((field) => field.includes('.')).map(pathParts);
  const walk = (node, at) => {
    if (Array.isArray(node)) {
      return node.map((item, index) => walk(item, [...at, String(index)]));
    }
    if (node === null || typeof node !== 'object') {
      return node;
    }
    return Object.fromEntries(
      Object.keys(node)
        .sort()
        .filter((key) => {
          const here = [...at, key];
          return !names.has(key) && !paths.some((path) => path.join('.') === here.join('.'));
        })
        .map((key) => [key, walk(node[key], [...at, key])]),
    );
  };
  return walk(value, []);
};

/**
 * What a request is compared by when looking for duplicates: the method, the
 * address with or without its query and the body, both without the parts
 * that change on every call (a timestamp, a nonce).
 */
export function duplicateSignature(exchange, rule = TRAFFIC_RULES.duplicates) {
  let url = exchange.url;
  try {
    const parsed = new URL(exchange.url);
    if (rule.query === 'none') {
      parsed.search = '';
    } else {
      const ignored = new Set(rule.ignoreParams ?? []);
      const params = [...parsed.searchParams]
        .filter(([name]) => !ignored.has(name))
        .sort(([a], [b]) => a.localeCompare(b));
      parsed.search = new URLSearchParams(params).toString();
    }
    url = parsed.toString();
  } catch {
    // an address URL cannot read is compared as it is
  }
  let body = exchange.requestBody ?? '';
  if (rule.body === 'none') {
    body = '';
  } else if (rule.ignoreFields?.length && body) {
    const json = parseJson(body);
    if (json.ok) {
      body = JSON.stringify(withoutFields(json.value, rule.ignoreFields));
    }
  }
  return `${exchange.method} ${url}\n${body}`;
}

/**
 * Checks completed exchanges one by one. Duplicates look back at the
 * exchanges of the last window; the caller passes them in.
 */
export function createTrafficRuleEngine(overrides = {}) {
  const rules = mergeTrafficRules(overrides);
  const ignoredHosts = rules.ignore.hosts.map((host) => urlMatcher(host));
  const ignoredPaths = rules.ignore.paths.map((path) => urlMatcher(path));
  const slowOverrides = rules.slow.overrides.map(parseLine);
  const errorExceptions = rules.errors.except.map(parseLine);
  const expectedRepeats = [
    ...rules.duplicates.expected.map(parseExpectedRepeat).filter(Boolean),
    ...rules.duplicates.ignore.map((pattern) => ({
      test: (exchange) => urlMatcher(pattern)(exchange.url),
      mode: 'ignore',
    })),
  ];
  const requirements = rules.contract.required.map(parseRequirement).filter(Boolean);

  const isIgnored = (exchange) => {
    const {host, path} = endpointOf(exchange.url);
    return ignoredHosts.some((match) => match(host)) || ignoredPaths.some((match) => match(path));
  };

  // the limit for an exchange and where it comes from: an endpoint line, or the default
  const slowLimitFor = (exchange) => {
    const rule = slowOverrides.find((candidate) => candidate.test(exchange) && candidate.number !== null);
    return rule ? {ms: rule.number, rule: rule.line} : {ms: rules.slow.defaultMs, rule: null};
  };
  const thresholdFor = (exchange) => slowLimitFor(exchange).ms;

  const signature = (exchange) => duplicateSignature(exchange, rules.duplicates);

  // the earlier copies of an exchange, oldest first, and how many make a duplicate
  const duplicatesOf = (exchange, recent) => {
    const mine = signature(exchange);
    const earlier = recent
      .filter((other) => other.id !== exchange.id && exchange.startedAt >= other.startedAt && signature(other) === mine)
      .sort((a, b) => a.startedAt - b.startedAt);
    const expected = expectedRepeats.find((rule) => rule.test(exchange));
    if (expected?.mode === 'ignore') {
      return null;
    }
    if (expected?.mode === 'poll') {
      // a series of polls is fine; asking again sooner than the interval is not
      const previous = earlier.at(-1);
      return previous && exchange.startedAt - previous.startedAt < expected.intervalMs
        ? {copies: [previous], windowMs: expected.intervalMs}
        : null;
    }
    const windowMs = expected?.mode === 'allow' ? expected.withinMs : rules.duplicates.windowMs;
    const limit = expected?.mode === 'allow' ? expected.times + 1 : rules.duplicates.minRepeats;
    const copies = earlier.filter((other) => exchange.startedAt - other.startedAt <= windowMs);
    return copies.length + 1 >= limit ? {copies, windowMs} : null;
  };

  const missingOf = (exchange) => {
    const missing = [];
    for (const requirement of requirements.filter((candidate) => candidate.test(exchange))) {
      for (const need of requirement.needs) {
        const name = need.name.toLowerCase();
        if (need.where === 'header' && exchange.requestHeaders?.[name] === undefined) {
          missing.push(need.text);
        } else if (need.where === 'response.header' && exchange.responseHeaders?.[name] === undefined) {
          missing.push(need.text);
        } else if (
          need.where === 'response.body' &&
          exchange.status >= 200 &&
          exchange.status < 300 &&
          !exchange.responseTruncated
        ) {
          const json = parseJson(exchange.responseBody ?? '');
          if (!json.ok || !hasPath(json.value, need.name)) {
            missing.push(need.text);
          }
        }
      }
    }
    return [...new Set(missing)];
  };

  return {
    rules,
    isIgnored,
    thresholdFor,
    slowLimitFor,
    /**
     * @returns {{flags: string[], findings: object[], duplicateOf: number[], slowLimit: ?{ms: number, rule: ?string}, missing: string[]}}
     */
    check(exchange, recent = [], scope = '') {
      if (isIgnored(exchange)) {
        return {flags: ['ignored'], findings: [], duplicateOf: [], slowLimit: null, missing: []};
      }
      // a rewrite rule made this answer on purpose: it is not the server's fault
      if (exchange.flags?.includes('mock')) {
        return {flags: [], findings: [], duplicateOf: [], slowLimit: null, missing: []};
      }
      const {host, path} = endpointOf(exchange.url);
      const endpoint = `${exchange.method} ${host}${path}`;
      const flags = [];
      const findings = [];
      const finding = (rule, severity, params, evidence) =>
        makeFinding({
          tool: 'proxy',
          rule,
          severity,
          scope,
          subject: `${endpoint} ${params.status ?? ''}`,
          params,
          evidence,
        });

      if (
        rules.errors.enabled &&
        exchange.status >= 400 &&
        !errorExceptions.some(
          (rule) => rule.test(exchange) && (rule.number === null || rule.number === exchange.status),
        )
      ) {
        flags.push('error');
        findings.push(
          finding('traffic-error', rules.errors.severity, {endpoint, status: exchange.status}, [
            `${exchange.method} ${exchange.url} → ${exchange.status}`,
          ]),
        );
      }

      let slowLimit = null;
      if (rules.slow.enabled && exchange.durationMs !== null && !exchange.flags?.includes('held')) {
        slowLimit = slowLimitFor(exchange);
        const limit = slowLimit.ms;
        if (exchange.durationMs > limit) {
          flags.push('slow');
          findings.push(
            finding('traffic-slow', rules.slow.severity, {endpoint, ms: exchange.durationMs, limit}, [
              `${exchange.method} ${exchange.url} · ${exchange.durationMs} ms`,
            ]),
          );
        }
      }

      const missing = rules.contract.enabled ? missingOf(exchange) : [];
      if (missing.length) {
        flags.push('contract');
        findings.push(
          finding('traffic-contract', rules.contract.severity, {endpoint, missing: missing.join(', ')}, [
            `${exchange.method} ${exchange.url} · ${missing.join(', ')}`,
          ]),
        );
      }

      let duplicateOf = [];
      const duplicate = rules.duplicates.enabled ? duplicatesOf(exchange, recent) : null;
      if (duplicate) {
        duplicateOf = duplicate.copies.map((other) => other.seq);
        flags.push('dupe');
        findings.push(
          finding(
            'traffic-duplicate',
            rules.duplicates.severity,
            {endpoint, count: duplicateOf.length + 1, windowMs: duplicate.windowMs},
            [`${exchange.method} ${exchange.url} ×${duplicateOf.length + 1}`],
          ),
        );
      }
      return {flags, findings, duplicateOf, slowLimit, missing};
    },
  };
}
