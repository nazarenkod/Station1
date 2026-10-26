// Rewrite rules of the proxy: what to do with a request that matches.
//   respond     answer from here (status, headers, body), the server is not asked
//   redirect    send the request to another origin (map remote)
//   delay       hold the request and its response for some milliseconds
//   fail        close the connection, as a network error would
//   breakpoint  stop the request or the response so a person can edit it

export const MOCK_ACTIONS = ['respond', 'redirect', 'delay', 'fail', 'breakpoint'];

const escapeRegex = (text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * A URL pattern: `*` stands for anything. A pattern with a scheme matches
 * the whole URL; otherwise it matches anywhere in it (a path, a host).
 */
export function urlMatcher(pattern) {
  const text = String(pattern ?? '').trim();
  if (!text) {
    return () => true;
  }
  const body = text.split('*').map(escapeRegex).join('.*');
  const regex = /^[a-z]+:\/\//i.test(text) ? new RegExp(`^${body}$`, 'i') : new RegExp(body, 'i');
  return (url) => regex.test(url);
}

export function ruleMatches(rule, method, url) {
  if (rule.enabled === false) {
    return false;
  }
  if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) {
    return false;
  }
  return urlMatcher(rule.url)(url);
}

/**
 * "Name: value" lines into a header object.
 */
export function parseHeaderLines(text) {
  const headers = {};
  for (const line of String(text ?? '').split('\n')) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
  }
  return headers;
}

/**
 * What the enabled rules say about one request: the first answer, redirect
 * or failure wins; delays add up; any breakpoint stops it.
 */
export function planFor(rules, method, url) {
  const matching = rules.filter((rule) => ruleMatches(rule, method, url));
  const first = (action) => matching.find((rule) => rule.action === action) ?? null;
  return {
    respond: first('respond'),
    redirect: first('redirect'),
    fail: first('fail'),
    delayMs: matching
      .filter((rule) => rule.action === 'delay')
      .reduce((sum, rule) => sum + (Number(rule.delayMs) || 0), 0),
    breakRequest: matching.some((rule) => rule.action === 'breakpoint' && rule.stage !== 'response'),
    breakResponse: matching.some((rule) => rule.action === 'breakpoint' && rule.stage !== 'request'),
    ruleIds: matching.map((rule) => rule.id),
  };
}

/**
 * The URL a map-remote rule sends a request to: the target's origin (and
 * base path) in place of the original origin; path and query are kept.
 */
export function redirectUrl(url, target) {
  const original = new URL(url);
  const to = new URL(target);
  const basePath = to.pathname.replace(/\/+$/, '');
  return `${to.origin}${basePath}${original.pathname}${original.search}`;
}
