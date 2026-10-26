import {PRODUCT_NAME} from '../../shared/product.js';

const headerList = (headers = {}) =>
  Object.entries(headers).flatMap(([name, value]) =>
    (Array.isArray(value) ? value : [value]).map((v) => ({name, value: String(v)})),
  );

const queryOf = (url) => {
  try {
    return [...new URL(url).searchParams.entries()].map(([name, value]) => ({name, value}));
  } catch {
    return [];
  }
};

/**
 * The captured exchanges as a HAR 1.2 file, which browsers, Charles and
 * Postman open.
 */
export function toHar(exchanges, version = 'dev') {
  return {
    log: {
      version: '1.2',
      creator: {name: PRODUCT_NAME, version},
      entries: exchanges
        .filter((x) => x.status !== null)
        .map((x) => ({
          startedDateTime: new Date(x.startedAt).toISOString(),
          time: x.durationMs ?? 0,
          request: {
            method: x.method,
            url: x.url,
            httpVersion: `HTTP/${x.httpVersion ?? '1.1'}`,
            headers: headerList(x.requestHeaders),
            queryString: queryOf(x.url),
            cookies: [],
            headersSize: -1,
            bodySize: x.requestSize ?? 0,
            ...(x.requestBody
              ? {postData: {mimeType: String(x.requestHeaders?.['content-type'] ?? ''), text: x.requestBody}}
              : {}),
          },
          response: {
            status: x.status,
            statusText: x.statusMessage ?? '',
            httpVersion: `HTTP/${x.httpVersion ?? '1.1'}`,
            headers: headerList(x.responseHeaders),
            cookies: [],
            content: {
              size: x.responseSize ?? 0,
              mimeType: String(x.responseHeaders?.['content-type'] ?? ''),
              ...(x.responseBody !== null ? {text: x.responseBody} : {}),
            },
            redirectURL: String(x.responseHeaders?.location ?? ''),
            headersSize: -1,
            bodySize: x.responseSize ?? 0,
          },
          cache: {},
          timings: {
            send: x.timings?.request ?? 0,
            wait: x.timings?.wait ?? x.durationMs ?? 0,
            receive: x.timings?.download ?? 0,
          },
          serverIPAddress: x.remoteIp ?? undefined,
        })),
    },
  };
}
