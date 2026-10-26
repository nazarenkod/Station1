// Small helpers the proxy screens share.

export const hostAndPath = (url) => {
  try {
    const parsed = new URL(url);
    return {host: parsed.host, path: `${parsed.pathname}${parsed.search}`};
  } catch {
    return {host: '', path: url};
  }
};

export const formatDuration = (ms) => {
  if (ms === null || ms === undefined) {
    return '';
  }
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
};

export function formatSize(bytes) {
  if (!bytes) {
    return bytes === 0 ? '0 B' : '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * A body as people read it: JSON indented, anything else as it came.
 */
export function prettyBody(text) {
  if (!text) {
    return text ?? '';
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

const shellQuote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;

/**
 * The request as a curl command, to send it again from a terminal.
 */
export function toCurl(exchange) {
  const parts = ['curl', '-X', exchange.method, shellQuote(exchange.url)];
  for (const [name, value] of Object.entries(exchange.requestHeaders ?? {})) {
    if (['host', 'content-length', 'connection'].includes(name.toLowerCase())) {
      continue;
    }
    for (const v of Array.isArray(value) ? value : [value]) {
      parts.push('-H', shellQuote(`${name}: ${v}`));
    }
  }
  if (exchange.requestBody) {
    parts.push('--data-raw', shellQuote(exchange.requestBody));
  }
  return parts.join(' ');
}

export const headerLines = (headers = {}) =>
  Object.entries(headers)
    .flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map((v) => `${name}: ${v}`))
    .join('\n');

export const statusTone = (exchange) => {
  if (exchange.flags?.includes('paused')) {
    return 'paused';
  }
  if (exchange.status === null) {
    return exchange.flags?.includes('aborted') ? 'error' : 'pending';
  }
  if (exchange.status === 0 || exchange.status >= 400) {
    return 'error';
  }
  return exchange.status >= 300 ? 'redirect' : 'ok';
};

export const FILTERS = ['all', 'error', 'slow', 'dupe', 'mock', 'paused'];

export function matchesFilter(exchange, filter) {
  if (filter === 'all') {
    return true;
  }
  return exchange.flags?.includes(filter);
}
