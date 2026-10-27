import {describe, expect, it} from 'vitest';

import {readJwt, recognize, relativeTime, valueText} from '../../app/common/shared/app-data/values.js';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const b64url = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');
const jwt = (payload) => `${b64url({alg: 'HS256', typ: 'JWT'})}.${b64url(payload)}.c2lnbmF0dXJl`;

describe('recognising values', function () {
  it('takes a JWT apart and says when it expires', function () {
    const token = jwt({sub: '42', exp: NOW / 1000 + 14 * 60});
    const found = recognize(token, {now: NOW});
    expect(found.kind).toBe('jwt');
    expect(found.payload.sub).toBe('42');
    expect(found.expiresIn).toBe(14 * 60 * 1000);
    expect(readJwt(`Bearer ${token}`, NOW)?.payload.sub).toBe('42');
  });

  it('sees an expired JWT as expired', function () {
    expect(readJwt(jwt({exp: NOW / 1000 - 7200}), NOW).expiresIn).toBe(-7200 * 1000);
  });

  it('does not take three dotted words for a JWT', function () {
    expect(readJwt('ua.privatbank.ap24', NOW)).toBe(null);
    expect(readJwt('abcdefghij.klmnopqrst.uvw', NOW)).toBe(null);
  });

  it('shows JSON in a string as a tree', function () {
    expect(recognize('{"a":[1,2]}')).toEqual({kind: 'json', value: {a: [1, 2]}});
    expect(recognize('{broken')).toBe(null);
  });

  it('reads a moment from seconds and milliseconds, but not from any number', function () {
    expect(recognize(1761566400, {type: 'int'})).toEqual({kind: 'time', ms: 1761566400000, unit: 's'});
    expect(recognize('1761566400000', {type: 'long'})).toEqual({kind: 'time', ms: 1761566400000, unit: 'ms'});
    expect(recognize('1761566400')).toEqual({kind: 'time', ms: 1761566400000, unit: 's'});
    expect(recognize(7, {type: 'int'})).toBe(null);
    expect(recognize(380501234567, {type: 'long'})).toBe(null);
    expect(recognize('2026-10-27T10:00:00Z', {type: 'date'})).toEqual({
      kind: 'time',
      ms: Date.UTC(2026, 9, 27, 10),
      unit: 'date',
    });
  });

  it('decodes base64 only when there is text inside', function () {
    expect(recognize(Buffer.from('user=42;plan=gold').toString('base64'))).toEqual({
      kind: 'base64',
      text: 'user=42;plan=gold',
    });
    expect(recognize(Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]).toString('base64'))).toBe(null);
    expect(recognize('onboarding')).toBe(null);
  });

  it('makes a link of a URL', function () {
    expect(recognize('https://api.example.com/v2')).toEqual({kind: 'url', href: 'https://api.example.com/v2'});
    expect(recognize('privat24://transfer?id=1')).toEqual({kind: 'url', href: 'privat24://transfer?id=1'});
  });

  it('leaves booleans and plain text alone', function () {
    expect(recognize(true)).toBe(null);
    expect(recognize('hello world')).toBe(null);
  });
});

describe('how long until', function () {
  it('takes the largest whole unit', function () {
    expect(relativeTime(NOW + 14 * 60 * 1000, NOW)).toEqual({past: false, count: 14, unit: 'min'});
    expect(relativeTime(NOW - 2 * 3600 * 1000, NOW)).toEqual({past: true, count: 2, unit: 'hour'});
    expect(relativeTime(NOW + 30 * 1000, NOW)).toEqual({past: false, count: 30, unit: 'sec'});
    expect(relativeTime(NOW + 3 * 86400 * 1000, NOW)).toEqual({past: false, count: 3, unit: 'day'});
  });

  it('turns any value into one line', function () {
    expect(valueText(['a', 'b'])).toBe('["a","b"]');
    expect(valueText(null)).toBe('');
    expect(valueText(1.5)).toBe('1.5');
  });
});
