import {describe, expect, it} from 'vitest';

import {PERF_RULES, perfFindings} from '../../app/common/shared/perf/perf-rules.js';

const MB = 1024 * 1024;
const T0 = 1_000_000;

// a sample a second from `from` for `seconds`, with the values the function gives
const samples = (from, seconds, values) =>
  Array.from({length: seconds}, (_, i) => ({at: T0 + (from + i) * 1000, cpu: 5, memory: 100 * MB, ...values(i)}));

const screen = (second, key, title = key) => ({at: T0 + second * 1000, kind: 'screen', key, title});

describe('perf findings without a baseline', () => {
  it('finds CPU high for long on the screen it happened on, once for every stretch there', () => {
    const list = [
      ...samples(0, 20, (i) => ({cpu: i >= 2 && i < 2 + PERF_RULES.cpuSeconds ? 60 + i : 5})),
      ...samples(20, 20, (i) => ({cpu: i < 5 ? 90 : 5})),
    ];
    const findings = perfFindings({samples: list, markers: [screen(0, 'feed', 'Feed')], endAt: T0 + 40_000});
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      tool: 'perf',
      rule: 'perf-cpu-high',
      severity: 'medium',
      count: 1,
      params: {screen: 'Feed', seconds: PERF_RULES.cpuSeconds, percent: 60 + 2 + PERF_RULES.cpuSeconds - 1},
    });
  });

  it('says nothing of short CPU bursts or of samples without CPU', () => {
    const list = samples(0, 30, (i) => ({cpu: i % 10 < 5 ? 95 : null}));
    expect(perfFindings({samples: list, markers: [], endAt: T0 + 30_000})).toEqual([]);
  });

  it('finds memory that grows each time the same screen opens again', () => {
    const list = samples(0, 60, (i) => ({memory: (100 + i) * MB}));
    const markers = [
      screen(0, 'cart', 'Cart'),
      screen(10, 'home'),
      screen(20, 'cart', 'Cart'),
      screen(30, 'home'),
      screen(45, 'cart', 'Cart'),
    ];
    const [finding] = perfFindings({samples: list, markers, endAt: T0 + 60_000});
    expect(finding).toMatchObject({rule: 'perf-memory-growth', count: 3, params: {screen: 'Cart', mb: 45, visits: 3}});
  });

  it('does not take a small growth or one visit for a leak', () => {
    const list = samples(0, 40, (i) => ({memory: (300 + i / 4) * MB}));
    const markers = [screen(0, 'cart'), screen(10, 'home'), screen(30, 'cart')];
    expect(perfFindings({samples: list, markers, endAt: T0 + 40_000})).toEqual([]);
  });
});
