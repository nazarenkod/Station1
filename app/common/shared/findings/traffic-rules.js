import {urlMatcher} from '../proxy/mock-rules.js';
import {makeFinding} from './findings.js';

/**
 * The traffic rules with their defaults; a project changes the numbers and
 * the lists in its rules.
 */
export const TRAFFIC_RULES = {
  duplicates: {enabled: true, severity: 'medium', windowMs: 2000, minRepeats: 2, ignore: []},
  slow: {enabled: true, severity: 'medium', defaultMs: 1500, overrides: []},
  errors: {enabled: true, severity: 'high', except: []},
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
  return {test: (exchange) => (!method || exchange.method === method) && matches(exchange.url), number};
};

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
  const duplicateIgnore = rules.duplicates.ignore.map((pattern) => urlMatcher(pattern));

  const isIgnored = (exchange) => {
    const {host, path} = endpointOf(exchange.url);
    return ignoredHosts.some((match) => match(host)) || ignoredPaths.some((match) => match(path));
  };

  const thresholdFor = (exchange) =>
    slowOverrides.find((rule) => rule.test(exchange) && rule.number !== null)?.number ?? rules.slow.defaultMs;

  const signature = (exchange) => `${exchange.method} ${exchange.url}\n${exchange.requestBody ?? ''}`;

  return {
    rules,
    isIgnored,
    thresholdFor,
    /**
     * @returns {{flags: string[], findings: object[], duplicateOf: number[]}}
     */
    check(exchange, recent = [], scope = '') {
      if (isIgnored(exchange)) {
        return {flags: ['ignored'], findings: [], duplicateOf: []};
      }
      // a rewrite rule made this answer on purpose: it is not the server's fault
      if (exchange.flags?.includes('mock')) {
        return {flags: [], findings: [], duplicateOf: []};
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

      if (rules.slow.enabled && exchange.durationMs !== null && !exchange.flags?.includes('held')) {
        const limit = thresholdFor(exchange);
        if (exchange.durationMs > limit) {
          flags.push('slow');
          findings.push(
            finding('traffic-slow', rules.slow.severity, {endpoint, ms: exchange.durationMs, limit}, [
              `${exchange.method} ${exchange.url} · ${exchange.durationMs} ms`,
            ]),
          );
        }
      }

      let duplicateOf = [];
      if (rules.duplicates.enabled && !duplicateIgnore.some((match) => match(exchange.url))) {
        const mine = signature(exchange);
        duplicateOf = recent
          .filter(
            (other) =>
              other.id !== exchange.id &&
              exchange.startedAt - other.startedAt <= rules.duplicates.windowMs &&
              exchange.startedAt >= other.startedAt &&
              signature(other) === mine,
          )
          .map((other) => other.seq);
        if (duplicateOf.length + 1 >= rules.duplicates.minRepeats) {
          flags.push('dupe');
          findings.push(
            finding(
              'traffic-duplicate',
              rules.duplicates.severity,
              {endpoint, count: duplicateOf.length + 1, windowMs: rules.duplicates.windowMs},
              [`${exchange.method} ${exchange.url} ×${duplicateOf.length + 1}`],
            ),
          );
        } else {
          duplicateOf = [];
        }
      }
      return {flags, findings, duplicateOf};
    },
  };
}
