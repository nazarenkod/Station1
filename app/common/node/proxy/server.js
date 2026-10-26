import os from 'node:os';

import {getLocal} from 'mockttp';

import {createTrafficRuleEngine} from '../../shared/findings/traffic-rules.js';
import {PRODUCT_NAME} from '../../shared/product.js';
import {parseHeaderLines, planFor, redirectUrl} from '../../shared/proxy/mock-rules.js';
import {ensureCa} from './ca.js';

const MAX_EXCHANGES = 3000;
const MAX_BODY_TEXT = 512 * 1024;
const BATCH_INTERVAL_MS = 200;
const PAUSE_TIMEOUT_MS = 5 * 60 * 1000;
const DUPLICATE_LOOKBACK = 200;
// the address a device opens to get the certificate, answered by the proxy itself
export const CA_HOST = 'vi.proxy';

const TEXT_TYPE = /json|text|xml|javascript|x-www-form-urlencoded|graphql|html|csv|yaml/i;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const contentType = (headers) => String(headers?.['content-type'] ?? '');

async function bodyText(body, headers) {
  const type = contentType(headers);
  const size = body?.buffer?.length ?? 0;
  if (!size) {
    return {text: '', size: 0, binary: false};
  }
  if (type && !TEXT_TYPE.test(type)) {
    return {text: null, size, binary: true};
  }
  let text;
  try {
    text = (await body.getText()) ?? '';
  } catch {
    return {text: null, size, binary: true};
  }
  return {
    text: text.length > MAX_BODY_TEXT ? text.slice(0, MAX_BODY_TEXT) : text,
    size,
    binary: false,
    truncated: text.length > MAX_BODY_TEXT,
  };
}

/**
 * The machine's addresses a phone on the same network can reach.
 */
export function lanAddresses() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) => (addresses ?? []).map((address) => ({name, ...address})))
    .filter((address) => address.family === 'IPv4' && !address.internal)
    .map((address) => ({name: address.name, address: address.address}));
}

const caPage = (
  port,
) => `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${PRODUCT_NAME} CA</title>
<body style="font-family:-apple-system,system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;line-height:1.5">
<h1>${PRODUCT_NAME}</h1>
<p>Цей пристрій іде в мережу через проксі ${PRODUCT_NAME} (порт ${port}). Щоб проксі бачив HTTPS, встановіть сертифікат і довіртеся йому.</p>
<p><a href="/ca.pem" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#6b4eff;color:#fff;text-decoration:none">Завантажити сертифікат</a></p>
<p><b>iPhone:</b> Параметри › Профіль завантажено › Встановити, потім Параметри › Загальні › Про пристрій › Довіра до сертифікатів › увімкніть ${PRODUCT_NAME} CA.</p>
<p><b>Android:</b> Налаштування › Безпека › Шифрування й облікові дані › Встановити сертифікат › Сертифікат CA.</p>
</body></html>`;

/**
 * The HTTP(S) proxy of the workstation: every request and response the
 * device makes through it, rewrite rules, breakpoints, and the traffic
 * rules flagging errors, slow answers, duplicates and missing fields.
 */
export class ProxyServer {
  constructor({dataDir, onEvent}) {
    this.dataDir = dataDir;
    this.onEvent = onEvent;
    this.server = null;
    this.ca = null;
    this.port = null;
    this.mockRules = [];
    this.mocksEnabled = true;
    this.breakpointsEnabled = true;
    this.engine = createTrafficRuleEngine();
    this.trafficRules = {};
    this.exchanges = new Map();
    this.findings = new Map();
    this.pauses = new Map();
    this.tlsFailures = new Map();
    this.seq = 0;
    this.pending = {exchanges: new Map(), findings: new Set(), changed: false};
    this.timer = null;
  }

  status() {
    return {
      running: !!this.server,
      port: this.port,
      ca: this.ca && {certPath: this.ca.certPath, fingerprint: this.ca.fingerprint, validTo: this.ca.validTo},
      addresses: lanAddresses(),
      caUrl: `http://${CA_HOST}/`,
      mocksEnabled: this.mocksEnabled,
      breakpointsEnabled: this.breakpointsEnabled,
      tlsFailures: [...this.tlsFailures.values()],
    };
  }

  snapshot() {
    return {
      status: this.status(),
      exchanges: [...this.exchanges.values()],
      findings: [...this.findings.values()],
      pauses: [...this.pauses.values()].map(({resolve: _resolve, ...pause}) => pause),
    };
  }

  async start({port = 8890} = {}) {
    if (this.server) {
      return this.status();
    }
    this.ca = await ensureCa(this.dataDir);
    const server = getLocal({https: {keyPath: this.ca.keyPath, certPath: this.ca.certPath}, recordTraffic: false});
    // the port may be taken: the next free ones are tried
    let lastError;
    for (let candidate = port; candidate < port + 10; candidate++) {
      try {
        await server.start(candidate);
        this.port = candidate;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) {
      throw lastError;
    }
    await server.forAnyRequest().thenPassThrough({
      beforeRequest: (request) => this.beforeRequest(request),
      beforeResponse: (response, request) => this.beforeResponse(response, request),
    });
    await server.on('request', (request) => this.onRequest(request));
    await server.on('response', (response) => this.onResponse(response));
    await server.on('abort', (request) => this.onAbort(request));
    await server.on('tls-client-error', (failure) => this.onTlsFailure(failure));
    this.server = server;
    this.timer = setInterval(() => this.emit(), BATCH_INTERVAL_MS);
    this.pending.changed = true;
    return this.status();
  }

  async stop() {
    for (const pause of this.pauses.values()) {
      pause.resolve({action: 'release'});
    }
    this.pauses.clear();
    clearInterval(this.timer);
    this.timer = null;
    const server = this.server;
    this.server = null;
    await server?.stop();
    this.pending.changed = true;
    this.emit();
  }

  // ---- settings from the screen

  setMockRules(rules) {
    this.mockRules = rules ?? [];
  }

  setModes({mocksEnabled, breakpointsEnabled}) {
    if (mocksEnabled !== undefined) {
      this.mocksEnabled = mocksEnabled;
    }
    if (breakpointsEnabled !== undefined) {
      this.breakpointsEnabled = breakpointsEnabled;
      if (!breakpointsEnabled) {
        for (const pause of this.pauses.values()) {
          pause.resolve({action: 'release'});
        }
      }
    }
    this.pending.changed = true;
  }

  setTrafficRules(rules) {
    this.trafficRules = rules ?? {};
    this.engine = createTrafficRuleEngine(this.trafficRules);
    // every kept exchange is judged again by the new rules
    this.findings = new Map();
    const ordered = [...this.exchanges.values()].sort((a, b) => a.seq - b.seq);
    for (const exchange of ordered) {
      exchange.flags = exchange.flags.filter((flag) => ['mock', 'paused', 'held', 'aborted', 'replay'].includes(flag));
      if (exchange.status !== null) {
        this.judge(exchange, ordered);
      }
    }
    this.emit({reset: true});
  }

  clear() {
    this.exchanges = new Map();
    this.findings = new Map();
    this.tlsFailures = new Map();
    this.emit({reset: true});
  }

  // ---- breakpoints

  pause(kind, exchangeId, data) {
    return new Promise((resolve) => {
      const id = `${exchangeId}:${kind}`;
      const timeout = setTimeout(() => this.resume(id, {action: 'release'}), PAUSE_TIMEOUT_MS);
      this.pauses.set(id, {
        id,
        exchangeId,
        kind,
        data,
        since: Date.now(),
        resolve: (decision) => {
          clearTimeout(timeout);
          resolve(decision);
        },
      });
      this.flag(exchangeId, 'paused', true);
      this.pending.changed = true;
    });
  }

  resume(pauseId, decision) {
    const pause = this.pauses.get(pauseId);
    if (!pause) {
      return false;
    }
    this.pauses.delete(pauseId);
    this.flag(pause.exchangeId, 'paused', false);
    // a person held it: its duration says nothing about the server
    this.flag(pause.exchangeId, 'held', true);
    pause.resolve(decision);
    this.pending.changed = true;
    return true;
  }

  // ---- the hooks mockttp calls for every request

  async beforeRequest(request) {
    const url = new URL(request.url);
    if (url.hostname === CA_HOST) {
      return {response: this.caResponse(url.pathname)};
    }
    const plan = this.mocksEnabled ? planFor(this.mockRules, request.method, request.url) : planFor([], '', '');
    request.plan = plan;
    // a breakpoint alone changes nothing by itself: only real rewrites mark the request
    if (plan.respond || plan.redirect || plan.fail || plan.delayMs) {
      this.flag(request.id, 'mock', true, plan.ruleIds);
    }
    if (plan.delayMs) {
      await delay(plan.delayMs);
    }
    if (plan.fail) {
      return {response: 'close'};
    }
    if (plan.respond) {
      return {
        response: {
          statusCode: Number(plan.respond.status) || 200,
          headers: {'content-type': 'application/json; charset=utf-8', ...parseHeaderLines(plan.respond.headers)},
          body: plan.respond.body ?? '',
        },
      };
    }
    let result = {};
    if (plan.redirect?.target) {
      try {
        result.url = redirectUrl(request.url, plan.redirect.target);
      } catch {
        // a broken target leaves the request as it was
      }
    }
    if (plan.breakRequest && this.breakpointsEnabled) {
      const body = await request.body.getText().catch(() => '');
      const decision = await this.pause('request', request.id, {
        method: request.method,
        url: result.url ?? request.url,
        headers: request.headers,
        body: body ?? '',
      });
      if (decision.action === 'abort') {
        return {response: 'close'};
      }
      if (decision.action === 'edit') {
        result = {
          ...result,
          method: decision.method,
          url: decision.url,
          headers: decision.headers,
          body: decision.body,
        };
      }
    }
    return Object.keys(result).length ? result : undefined;
  }

  async beforeResponse(response, request) {
    const plan = request.plan ?? planFor(this.mocksEnabled ? this.mockRules : [], request.method, request.url);
    if (!plan.breakResponse || !this.breakpointsEnabled) {
      return undefined;
    }
    const body = await response.body.getText().catch(() => '');
    const decision = await this.pause('response', request.id, {
      status: response.statusCode,
      headers: response.headers,
      body: body ?? '',
    });
    if (decision.action === 'abort') {
      return 'close';
    }
    if (decision.action === 'edit') {
      const headers = {...decision.headers};
      // the body is sent decoded and re-sized: old length and encoding no longer apply
      delete headers['content-length'];
      delete headers['content-encoding'];
      return {statusCode: Number(decision.status) || response.statusCode, headers, body: decision.body ?? ''};
    }
    return undefined;
  }

  caResponse(pathname) {
    if (pathname === '/ca.pem' || pathname === '/ca.crt') {
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/x-x509-ca-cert',
          'content-disposition': 'attachment; filename="vision-inspector-ca.crt"',
        },
        body: this.ca.cert,
      };
    }
    return {statusCode: 200, headers: {'content-type': 'text/html; charset=utf-8'}, body: caPage(this.port)};
  }

  // ---- what happened

  flag(id, flag, on, ruleIds = null) {
    const exchange = this.exchanges.get(id);
    if (!exchange) {
      // the hooks can run before the request event arrives
      this.earlyFlags ??= new Map();
      const flags = this.earlyFlags.get(id) ?? {flags: new Set(), ruleIds: []};
      if (on) {
        flags.flags.add(flag);
      } else {
        flags.flags.delete(flag);
      }
      if (ruleIds) {
        flags.ruleIds = ruleIds;
      }
      this.earlyFlags.set(id, flags);
      return;
    }
    exchange.flags = on ? [...new Set([...exchange.flags, flag])] : exchange.flags.filter((f) => f !== flag);
    if (ruleIds) {
      exchange.mockRules = ruleIds;
    }
    this.touch(exchange);
  }

  touch(exchange) {
    this.pending.exchanges.set(exchange.id, exchange);
  }

  async onRequest(request) {
    if (new URL(request.url).hostname === CA_HOST) {
      return;
    }
    const body = await bodyText(request.body, request.headers);
    const early = this.earlyFlags?.get(request.id);
    this.earlyFlags?.delete(request.id);
    const exchange = {
      id: request.id,
      seq: ++this.seq,
      method: request.method,
      url: request.url,
      protocol: request.protocol,
      httpVersion: request.httpVersion,
      remoteIp: request.remoteIpAddress ?? null,
      startedAt: request.timingEvents.startTime,
      requestHeaders: request.headers,
      requestBody: body.text,
      requestSize: body.size,
      requestBinary: body.binary,
      status: null,
      statusMessage: '',
      responseHeaders: {},
      responseBody: null,
      responseSize: 0,
      responseBinary: false,
      durationMs: null,
      timings: null,
      flags: early ? [...early.flags] : [],
      mockRules: early?.ruleIds ?? [],
      duplicateOf: [],
    };
    this.exchanges.set(exchange.id, exchange);
    if (this.exchanges.size > MAX_EXCHANGES) {
      const oldest = this.exchanges.keys().next().value;
      this.exchanges.delete(oldest);
    }
    this.touch(exchange);
  }

  async onResponse(response) {
    const exchange = this.exchanges.get(response.id);
    if (!exchange) {
      return;
    }
    const body = await bodyText(response.body, response.headers);
    const t = response.timingEvents;
    exchange.status = response.statusCode;
    exchange.statusMessage = response.statusMessage ?? '';
    exchange.responseHeaders = response.headers;
    exchange.responseBody = body.text;
    exchange.responseSize = body.size;
    exchange.responseBinary = body.binary;
    exchange.responseTruncated = !!body.truncated;
    const end = t.responseSentTimestamp ?? t.headersSentTimestamp;
    exchange.durationMs = end ? Math.round(end - t.startTimestamp) : null;
    exchange.timings = {
      request: t.bodyReceivedTimestamp ? Math.round(t.bodyReceivedTimestamp - t.startTimestamp) : null,
      wait:
        t.headersSentTimestamp && t.bodyReceivedTimestamp
          ? Math.round(t.headersSentTimestamp - t.bodyReceivedTimestamp)
          : null,
      download:
        t.responseSentTimestamp && t.headersSentTimestamp
          ? Math.round(t.responseSentTimestamp - t.headersSentTimestamp)
          : null,
    };
    const recent = [...this.exchanges.values()].slice(-DUPLICATE_LOOKBACK);
    this.judge(exchange, recent);
    this.touch(exchange);
  }

  judge(exchange, recent) {
    const {flags, findings, duplicateOf, slowLimit, missing} = this.engine.check(exchange, recent);
    exchange.flags = [...new Set([...exchange.flags, ...flags])];
    exchange.duplicateOf = duplicateOf;
    exchange.slowLimit = slowLimit;
    exchange.missing = missing;
    // the earlier copies of a duplicate are duplicates too
    for (const seq of duplicateOf) {
      const other = [...this.exchanges.values()].find((candidate) => candidate.seq === seq);
      if (other && !other.flags.includes('dupe')) {
        other.flags = [...other.flags, 'dupe'];
        this.touch(other);
      }
    }
    for (const finding of findings) {
      const known = this.findings.get(finding.id);
      this.findings.set(
        finding.id,
        known
          ? {...known, count: known.count + 1, lastSeq: exchange.seq, evidence: finding.evidence}
          : {...finding, count: 1, firstSeq: exchange.seq, lastSeq: exchange.seq},
      );
      this.pending.findings.add(finding.id);
    }
  }

  onAbort(request) {
    const exchange = this.exchanges.get(request.id);
    if (exchange) {
      exchange.flags = [...new Set([...exchange.flags, 'aborted'])];
      exchange.error = request.error?.message ?? 'aborted';
      this.touch(exchange);
    }
  }

  // a device that refuses the proxy's certificate: not trusted yet, or the app pins its certificates
  onTlsFailure(failure) {
    const host = failure.tlsMetadata?.sniHostname ?? failure.destination?.hostname ?? 'unknown';
    const key = `${failure.remoteIpAddress}|${host}`;
    const known = this.tlsFailures.get(key);
    this.tlsFailures.set(key, {
      host,
      client: failure.remoteIpAddress ?? '',
      cause: failure.failureCause,
      count: (known?.count ?? 0) + 1,
      at: Date.now(),
    });
    this.pending.changed = true;
  }

  // ---- to the screen

  addReplay(exchange) {
    const replay = {...exchange, seq: ++this.seq, flags: ['replay'], mockRules: [], duplicateOf: []};
    this.exchanges.set(replay.id, replay);
    this.touch(replay);
    return replay;
  }

  emit({reset = false} = {}) {
    const {exchanges, findings, changed} = this.pending;
    if (!reset && !exchanges.size && !findings.size && !changed) {
      return;
    }
    this.pending = {exchanges: new Map(), findings: new Set(), changed: false};
    this.onEvent(
      reset
        ? {reset: true, ...this.snapshot()}
        : {
            exchanges: [...exchanges.values()],
            findings: [...findings].map((id) => this.findings.get(id)).filter(Boolean),
            status: this.status(),
            pauses: [...this.pauses.values()].map(({resolve: _resolve, ...pause}) => pause),
          },
    );
  }
}
