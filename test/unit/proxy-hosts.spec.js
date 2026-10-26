import {describe, expect, it} from 'vitest';

import {groupByHost} from '../../app/common/renderer/components/Proxy/exchange-utils.js';

const x = (url, extra = {}) => ({
  url,
  method: 'GET',
  status: 200,
  durationMs: 100,
  responseSize: 10,
  startedAt: 1,
  ...extra,
});

describe('requests by domain', function () {
  it('counts each domain’s requests, failures, slow ones, time and size, the busiest first', function () {
    const groups = groupByHost([
      x('https://api.bank.ua/a'),
      x('https://api.bank.ua/b?q=1', {status: 500, durationMs: 300}),
      x('https://api.bank.ua/c', {flags: ['slow'], durationMs: 2000}),
      x('https://analytics.example.com/e', {startedAt: 9}),
    ]);
    expect(groups.map((g) => [g.host, g.count, g.errors, g.slow, Math.round(g.avgMs), g.size])).toEqual([
      ['api.bank.ua', 3, 1, 1, 800, 30],
      ['analytics.example.com', 1, 0, 0, 100, 10],
    ]);
    expect(groups[1].lastAt).toBe(9);
  });
});
