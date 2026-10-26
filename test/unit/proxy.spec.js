import {mkdtemp, rm} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {parseNetworksetupProxy} from '../../app/common/node/proxy/device-setup.js';
import {toHar} from '../../app/common/node/proxy/har.js';
import {ProxyServer} from '../../app/common/node/proxy/server.js';
import {createTrafficRuleEngine, endpointOf} from '../../app/common/shared/findings/traffic-rules.js';
import {parseHeaderLines, planFor, redirectUrl, urlMatcher} from '../../app/common/shared/proxy/mock-rules.js';

const exchange = (seq, patch = {}) => ({
  id: `x${seq}`,
  seq,
  method: 'GET',
  url: 'https://api.acme.io/api/v2/limits',
  startedAt: 1000 + seq * 50,
  status: 200,
  durationMs: 200,
  requestBody: '',
  flags: [],
  ...patch,
});

describe('rewrite rules', () => {
  it('matches URL patterns with * anywhere, or whole URLs with a scheme', () => {
    expect(urlMatcher('*/api/v2/offers*')('https://api.acme.io/api/v2/offers?page=1')).toBe(true);
    expect(urlMatcher('/limits')('https://api.acme.io/api/v2/limits')).toBe(true);
    expect(urlMatcher('https://api.acme.io/')('https://api.acme.io/other')).toBe(false);
    expect(urlMatcher('')('anything')).toBe(true);
  });

  it('plans what to do: first answer wins, delays add up, breakpoints by stage', () => {
    const rules = [
      {id: 'a', action: 'respond', url: '*/offers*', status: 200},
      {id: 'b', action: 'respond', url: '*offers*', status: 500},
      {id: 'c', action: 'delay', url: '*', delayMs: 1000},
      {id: 'd', action: 'delay', url: '*/offers', delayMs: 500, method: 'GET'},
      {id: 'e', action: 'breakpoint', url: '*/offers', stage: 'response'},
      {id: 'f', action: 'respond', url: '*', enabled: false},
    ];
    const plan = planFor(rules, 'GET', 'https://api.acme.io/api/v2/offers');
    expect(plan.respond.id).toBe('a');
    expect(plan.delayMs).toBe(1500);
    expect(plan).toMatchObject({breakRequest: false, breakResponse: true});
    expect(plan.ruleIds).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(planFor(rules, 'POST', 'https://api.acme.io/api/v2/offers').delayMs).toBe(1000);
  });

  it('maps a request to another server keeping path and query', () => {
    expect(redirectUrl('https://api.acme.io/api/v2/cards?x=1', 'https://staging.acme.io')).toBe(
      'https://staging.acme.io/api/v2/cards?x=1',
    );
    expect(redirectUrl('https://api.acme.io/v2/cards', 'http://localhost:3000/mock/')).toBe(
      'http://localhost:3000/mock/v2/cards',
    );
  });

  it('reads header lines', () => {
    expect(parseHeaderLines('Content-Type: application/json\nX-Trace:  abc:def \nbroken')).toEqual({
      'content-type': 'application/json',
      'x-trace': 'abc:def',
    });
  });
});

describe('traffic rules', () => {
  it('names an endpoint without its ids', () => {
    expect(endpointOf('https://api.acme.io/api/v2/cards/1287/details?x=1')).toEqual({
      host: 'api.acme.io',
      path: '/api/v2/cards/{id}/details',
    });
    expect(endpointOf('https://api.acme.io/tx/4bf92f3577b34da6a3ce929d0e0e4736')).toEqual({
      host: 'api.acme.io',
      path: '/tx/{id}',
    });
  });

  it('flags errors unless they are expected', () => {
    const engine = createTrafficRuleEngine({errors: {except: ['GET */templates/* 404']}});
    expect(engine.check(exchange(1, {status: 502})).flags).toEqual(['error']);
    expect(engine.check(exchange(2, {status: 404, url: 'https://api.acme.io/api/v2/templates/77'})).flags).toEqual([]);
    expect(engine.check(exchange(3, {status: 500, url: 'https://api.acme.io/api/v2/templates/77'})).flags).toEqual([
      'error',
    ]);
  });

  it('flags slow answers by the default or an endpoint limit', () => {
    const engine = createTrafficRuleEngine({slow: {defaultMs: 1500, overrides: ['*/history* 4000']}});
    expect(engine.check(exchange(1, {durationMs: 1600})).flags).toEqual(['slow']);
    const history = exchange(2, {url: 'https://api.acme.io/api/v2/history?page=1', durationMs: 3800});
    expect(engine.check(history).flags).toEqual([]);
    expect(engine.thresholdFor(history)).toBe(4000);
  });

  it('does not call slow what a person held at a breakpoint', () => {
    const engine = createTrafficRuleEngine();
    expect(engine.check(exchange(1, {durationMs: 20500, flags: ['held']})).flags).toEqual([]);
  });

  it('finds duplicates within the window, and leaves ignored and rewritten traffic alone', () => {
    const engine = createTrafficRuleEngine({ignore: {hosts: ['events.acme.io']}});
    const first = exchange(1);
    const second = exchange(2);
    const result = engine.check(second, [first, second]);
    expect(result.flags).toEqual(['dupe']);
    expect(result.duplicateOf).toEqual([1]);
    expect(result.findings[0]).toMatchObject({rule: 'traffic-duplicate', params: {count: 2}});
    const late = exchange(3, {startedAt: first.startedAt + 5000});
    expect(engine.check(late, [first, late]).flags).toEqual([]);
    expect(engine.check(exchange(4, {url: 'https://events.acme.io/v1/batch', status: 500})).flags).toEqual(['ignored']);
    expect(engine.check(exchange(5, {status: 418, flags: ['mock']})).flags).toEqual([]);
  });
});

describe('HAR and the Mac proxy', () => {
  it('writes HAR entries for answered requests', () => {
    const har = toHar([
      exchange(1, {
        requestHeaders: {accept: 'application/json'},
        responseHeaders: {'content-type': 'application/json'},
        responseBody: '{}',
        responseSize: 2,
        timings: {request: 1, wait: 150, download: 3},
      }),
      exchange(2, {status: null}),
    ]);
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0]).toMatchObject({
      request: {
        method: 'GET',
        url: 'https://api.acme.io/api/v2/limits',
        headers: [{name: 'accept', value: 'application/json'}],
      },
      response: {status: 200, content: {text: '{}', mimeType: 'application/json'}},
      timings: {send: 1, wait: 150, receive: 3},
    });
  });

  it('reads networksetup proxy state', () => {
    expect(
      parseNetworksetupProxy('Enabled: Yes\nServer: 10.0.0.5\nPort: 3128\nAuthenticated Proxy Enabled: 0\n'),
    ).toEqual({
      enabled: true,
      server: '10.0.0.5',
      port: 3128,
    });
    expect(parseNetworksetupProxy('Enabled: No\nServer: \nPort: 0\n').enabled).toBe(false);
  });
});

describe('the proxy server', () => {
  let upstream;
  let upstreamUrl;
  let proxy;
  let dataDir;
  const events = [];

  // a client that sends absolute URLs to the proxy, like a phone does for plain HTTP
  const through = (url, {method = 'GET', body} = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        {host: '127.0.0.1', port: proxy.port, path: url, method, headers: {host: new URL(url).host}},
        (response) => {
          let text = '';
          response.on('data', (chunk) => (text += chunk));
          response.on('end', () => resolve({status: response.statusCode, body: text}));
        },
      );
      request.on('error', reject);
      request.end(body);
    });

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      if (req.url.startsWith('/broken')) {
        res.writeHead(502, {'content-type': 'application/json'});
        res.end('{"error":"BAD_GATEWAY"}');
        return;
      }
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({path: req.url}));
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'vision-proxy-test-'));
    proxy = new ProxyServer({dataDir, onEvent: (event) => events.push(event)});
    await proxy.start({port: 18890});
  });

  afterAll(async () => {
    await proxy?.stop();
    upstream?.close();
    await rm(dataDir, {recursive: true, force: true});
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  it('makes its own certificate authority once', () => {
    expect(proxy.ca.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(proxy.status()).toMatchObject({running: true, port: proxy.port, caUrl: 'http://vi.proxy/'});
  });

  it('passes requests through and records them with their findings', async () => {
    expect(await through(`${upstreamUrl}/api/v2/limits`)).toEqual({status: 200, body: '{"path":"/api/v2/limits"}'});
    expect((await through(`${upstreamUrl}/broken`)).status).toBe(502);
    await settle();
    const recorded = proxy.snapshot().exchanges;
    const broken = recorded.find((x) => x.url.endsWith('/broken'));
    expect(broken).toMatchObject({status: 502, responseBody: '{"error":"BAD_GATEWAY"}'});
    expect(broken.flags).toContain('error');
    expect(proxy.snapshot().findings.map((f) => f.rule)).toContain('traffic-error');
  });

  it('answers from a rewrite rule without asking the server', async () => {
    proxy.setMockRules([{id: 'm', action: 'respond', url: '*/offers*', status: 200, body: '{"offers":[]}'}]);
    expect(await through(`${upstreamUrl}/api/v2/offers`)).toEqual({status: 200, body: '{"offers":[]}'});
    await settle();
    const offers = proxy.snapshot().exchanges.find((x) => x.url.endsWith('/offers'));
    expect(offers.flags).toContain('mock');
    expect(offers.mockRules).toEqual(['m']);
    proxy.setMockRules([]);
  });

  it('stops a response at a breakpoint and sends what the person edited', async () => {
    proxy.setMockRules([{id: 'bp', action: 'breakpoint', url: '*/cards*', stage: 'response'}]);
    const pending = through(`${upstreamUrl}/api/v2/cards`);
    while (!proxy.pauses.size) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const [pause] = proxy.pauses.values();
    expect(pause).toMatchObject({kind: 'response', data: {status: 200, body: '{"path":"/api/v2/cards"}'}});
    proxy.resume(pause.id, {action: 'edit', status: 503, headers: {'content-type': 'text/plain'}, body: 'maintenance'});
    expect(await pending).toEqual({status: 503, body: 'maintenance'});
    proxy.setMockRules([]);
  });

  it('serves the certificate to devices at vi.proxy', async () => {
    const page = await through('http://vi.proxy/');
    expect(page.body).toContain('Station#1');
    const pem = await through('http://vi.proxy/ca.pem');
    expect(pem.body).toBe(proxy.ca.cert);
  });
});
