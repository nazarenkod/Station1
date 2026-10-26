import {describe, expect, it} from 'vitest';

import {
  createTrafficRuleEngine,
  duplicateSignature,
  parseDuration,
  parseExpectedRepeat,
  parseRequirement,
} from '../../app/common/shared/findings/traffic-rules.js';

const exchange = (seq, patch = {}) => ({
  id: `x${seq}`,
  seq,
  method: 'GET',
  url: 'https://api.acme.io/api/v2/limits',
  startedAt: 1000 + seq * 50,
  status: 200,
  durationMs: 200,
  requestBody: '',
  requestHeaders: {},
  responseHeaders: {},
  responseBody: '',
  flags: [],
  ...patch,
});

// checks the exchanges one by one, each against the ones before it, as the proxy does
const run = (rules, exchanges) => {
  const engine = createTrafficRuleEngine(rules);
  return exchanges.map((current, index) => engine.check(current, exchanges.slice(0, index + 1)));
};

describe('what makes two requests the same', () => {
  it('compares the query without the named params and in any order', () => {
    const rule = {query: 'all', ignoreParams: ['ts'], body: 'all', ignoreFields: []};
    const a = exchange(1, {url: 'https://api.acme.io/feed?page=1&ts=111&lang=uk'});
    const b = exchange(2, {url: 'https://api.acme.io/feed?lang=uk&ts=222&page=1'});
    const c = exchange(3, {url: 'https://api.acme.io/feed?page=2&ts=333&lang=uk'});
    expect(duplicateSignature(a, rule)).toBe(duplicateSignature(b, rule));
    expect(duplicateSignature(a, rule)).not.toBe(duplicateSignature(c, rule));
    expect(duplicateSignature(a, {...rule, query: 'none'})).toBe(duplicateSignature(c, {...rule, query: 'none'}));
  });

  it('compares the body without the named fields, by name anywhere or by path', () => {
    const rule = {query: 'all', ignoreParams: [], body: 'all', ignoreFields: ['nonce', 'meta.sentAt']};
    const a = exchange(1, {method: 'POST', requestBody: '{"amount":5,"nonce":"a1","meta":{"sentAt":1,"app":"x"}}'});
    const b = exchange(2, {method: 'POST', requestBody: '{"meta":{"app":"x","sentAt":2},"nonce":"b2","amount":5}'});
    const c = exchange(3, {method: 'POST', requestBody: '{"amount":6,"nonce":"c3","meta":{"sentAt":3,"app":"x"}}'});
    expect(duplicateSignature(a, rule)).toBe(duplicateSignature(b, rule));
    expect(duplicateSignature(a, rule)).not.toBe(duplicateSignature(c, rule));
    expect(duplicateSignature(a, {...rule, body: 'none'})).toBe(duplicateSignature(c, {...rule, body: 'none'}));
  });

  it('flags requests that differ only in an ignored param as duplicates', () => {
    const results = run({duplicates: {ignoreParams: ['ts']}}, [
      exchange(1, {url: 'https://api.acme.io/feed?ts=1'}),
      exchange(2, {url: 'https://api.acme.io/feed?ts=2'}),
    ]);
    expect(results[1].flags).toEqual(['dupe']);
  });
});

describe('expected repeats', () => {
  it('reads the lines and leaves out the ones it cannot read', () => {
    expect(parseExpectedRepeat('GET */status poll 1000')).toMatchObject({mode: 'poll', intervalMs: 1000});
    expect(parseExpectedRepeat('*/profile allow 3 in 30s')).toMatchObject({mode: 'allow', times: 3, withinMs: 30_000});
    expect(parseExpectedRepeat('*/ping ignore')).toMatchObject({mode: 'ignore'});
    expect(parseExpectedRepeat('*/ping sometimes')).toBeNull();
    expect(parseExpectedRepeat('*/x allow three in 1s')).toBeNull();
    expect(parseDuration('2m')).toBe(120_000);
    expect(parseDuration('1500ms')).toBe(1500);
    expect(parseDuration('soon')).toBeNull();
  });

  it('lets an async service be polled, and flags polling sooner than the interval', () => {
    const status = (seq, startedAt) => exchange(seq, {url: 'https://api.acme.io/orders/7/status', startedAt});
    const results = run({duplicates: {expected: ['GET */orders/*/status poll 1000']}}, [
      status(1, 0),
      status(2, 1000),
      status(3, 2100),
      status(4, 2400),
    ]);
    expect(results.map((result) => result.flags)).toEqual([[], [], [], ['dupe']]);
    expect(results[3].duplicateOf).toEqual([3]);
  });

  it('allows a request a number of times within a time and flags the next one', () => {
    const profile = (seq, startedAt) => exchange(seq, {url: 'https://api.acme.io/profile', startedAt});
    const lines = {duplicates: {expected: ['*/profile allow 2 in 10s']}};
    const results = run(lines, [profile(1, 0), profile(2, 3000), profile(3, 6000), profile(4, 30_000)]);
    expect(results.map((result) => result.flags)).toEqual([[], [], ['dupe'], []]);
    expect(results[2].findings[0]).toMatchObject({rule: 'traffic-duplicate', params: {count: 3, windowMs: 10_000}});
  });

  it('never flags what a line ignores, nor the old ignore patterns, and the first line wins', () => {
    const ping = (seq) => exchange(seq, {url: 'https://api.acme.io/ping'});
    expect(
      run({duplicates: {expected: ['*/ping ignore', '*/ping allow 0 in 1s']}}, [ping(1), ping(2)])[1].flags,
    ).toEqual([]);
    expect(run({duplicates: {ignore: ['*/ping']}}, [ping(1), ping(2)])[1].flags).toEqual([]);
    expect(run({}, [ping(1), ping(2)])[1].flags).toEqual(['dupe']);
  });
});

describe('required fields', () => {
  it('reads the lines with one or more fields', () => {
    expect(parseRequirement('POST */pay/* header:X-Request-Id response.body:data.id').needs).toEqual([
      {text: 'header:X-Request-Id', where: 'header', name: 'X-Request-Id'},
      {text: 'response.body:data.id', where: 'response.body', name: 'data.id'},
    ]);
    expect(parseRequirement('*/api/*')).toBeNull();
  });

  it('flags a request without a required header, in the request or the response', () => {
    const rules = {contract: {required: ['*/api/* header:Authorization response.header:X-Trace-Id']}};
    const engine = createTrafficRuleEngine(rules);
    const good = exchange(1, {
      url: 'https://api.acme.io/api/cards',
      requestHeaders: {authorization: 'Bearer x'},
      responseHeaders: {'x-trace-id': 'abc'},
    });
    expect(engine.check(good).flags).toEqual([]);
    const bad = exchange(2, {url: 'https://api.acme.io/api/cards'});
    const result = engine.check(bad);
    expect(result.flags).toEqual(['contract']);
    expect(result.findings[0]).toMatchObject({
      rule: 'traffic-contract',
      params: {missing: 'header:Authorization, response.header:X-Trace-Id'},
    });
    expect(engine.check(exchange(3, {url: 'https://api.acme.io/other'})).flags).toEqual([]);
  });

  it('looks for body fields in successful JSON answers only', () => {
    const engine = createTrafficRuleEngine({contract: {required: ['GET */profile response.body:data.items[0].id']}});
    const profile = (patch) => exchange(1, {url: 'https://api.acme.io/profile', ...patch});
    expect(engine.check(profile({responseBody: '{"data":{"items":[{"id":null}]}}'})).flags).toEqual([]);
    expect(engine.check(profile({responseBody: '{"data":{"items":[]}}'})).flags).toEqual(['contract']);
    expect(engine.check(profile({responseBody: '<html>'})).flags).toEqual(['contract']);
    expect(engine.check(profile({status: 503, responseBody: 'down'})).flags).toEqual(['error']);
    expect(engine.check(profile({responseBody: '{"da', responseTruncated: true})).flags).toEqual([]);
  });

  it('can be turned off', () => {
    const engine = createTrafficRuleEngine({contract: {enabled: false, required: ['*/api/* header:Authorization']}});
    expect(engine.check(exchange(1, {url: 'https://api.acme.io/api/x'})).flags).toEqual([]);
  });
});

describe('the slow limit', () => {
  it('tells which limit applied and where it comes from', () => {
    const engine = createTrafficRuleEngine({slow: {defaultMs: 1500, overrides: ['POST */transfers/* 3000']}});
    expect(engine.check(exchange(1, {durationMs: 100})).slowLimit).toEqual({ms: 1500, rule: null});
    const transfer = exchange(2, {method: 'POST', url: 'https://api.acme.io/transfers/1', durationMs: 3200});
    const result = engine.check(transfer);
    expect(result.slowLimit).toEqual({ms: 3000, rule: 'POST */transfers/* 3000'});
    expect(result.flags).toEqual(['slow']);
  });
});
