import {describe, expect, it} from 'vitest';

import {
  highlightParts,
  matchesEntry,
  parseQuery,
  patternFromLine,
} from '../../app/common/renderer/components/Logs/log-filter.js';

const line = (tag, message, extra = {}) => ({
  kind: 'line',
  level: 'I',
  pid: 22306,
  tag,
  message,
  forApp: true,
  ...extra,
});

describe('the log search box', function () {
  it('reads words, exclusions, tags, a pid, a regular expression and quoted phrases', function () {
    expect(parseQuery('timeout -noise tag:Net -tag:Wifi pid:22306 /HTTP \\d{3}/ "two words"')).toMatchObject({
      words: ['timeout', 'two words'],
      excluded: ['noise'],
      tags: ['net'],
      hiddenTags: ['wifi'],
      pids: ['22306'],
      error: null,
    });
    expect(parseQuery('/[/').error).toBeTruthy();
  });

  it('keeps the lines that match all of it', function () {
    const query = parseQuery('timeout tag:net -retry');
    expect(matchesEntry(line('Network', 'Request timeout after 30s'), {query})).toBe(true);
    expect(matchesEntry(line('Network', 'Request timeout, retry 2'), {query})).toBe(false);
    expect(matchesEntry(line('Wifi', 'timeout'), {query})).toBe(false);
    expect(matchesEntry(line('Net', 'HTTP 503'), {query: parseQuery('/http 5\\d\\d/')})).toBe(true);
  });

  it('applies the app scope, the level, the tags picked or hidden, and a rule', function () {
    const system = line('locationd', 'fix', {forApp: false});
    expect(matchesEntry(system, {scope: 'app'})).toBe(false);
    expect(matchesEntry(system, {scope: 'device'})).toBe(true);
    expect(matchesEntry(line('A', 'x', {level: 'D'}), {minLevel: 'W'})).toBe(false);
    expect(matchesEntry(line('A', 'x', {level: 'E'}), {minLevel: 'W'})).toBe(true);
    expect(matchesEntry(line('A', 'x'), {tags: new Set(['B'])})).toBe(false);
    expect(matchesEntry(line('A', 'x'), {hiddenTags: new Set(['A'])})).toBe(false);
    expect(matchesEntry(line('A', 'x', {hits: ['log-anr']}), {rule: 'log-anr'})).toBe(true);
  });
});

describe('found text and rules from a line', function () {
  it('marks what the search found', function () {
    expect(highlightParts('Request timeout after 30s', parseQuery('timeout'))).toEqual([
      ['Request ', false],
      ['timeout', true],
      [' after 30s', false],
    ]);
  });

  it('makes a pattern that catches the same line with other numbers', function () {
    const pattern = new RegExp(patternFromLine('Retry 3 of 5 for 0x16e3f54a8 (id 42)'));
    expect(pattern.test('Retry 1 of 5 for 0xdeadbeef (id 7)')).toBe(true);
  });
});
