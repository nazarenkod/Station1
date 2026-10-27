import {describe, expect, it} from 'vitest';

import {searchAppData} from '../../app/common/shared/app-data/search.js';

const data = {
  prefs: [
    {
      file: 'shared_prefs/FlutterSharedPreferences.xml',
      entries: [
        {key: 'flutter.user_id', type: 'string', value: '100500'},
        {key: 'flutter.email', type: 'string', value: 'qa@example.com'},
        {key: 'launches', type: 'int', value: 3},
      ],
    },
  ],
  files: [{path: 'files/user_100500.json'}, {path: 'cache/img.png'}],
  texts: [{path: 'files/session.log', text: 'start\nlogged in as 100500\nend'}],
  rows: [{file: 'databases/app.db', table: 'users', column: 'id', key: '[1]', value: 100500}],
};

describe('searching all the data', function () {
  it('finds a value in preferences, rows, file names and text, grouped by section', function () {
    const found = searchAppData(data, '100500');
    expect(found.prefs.map((one) => one.key)).toEqual(['flutter.user_id']);
    expect(found.rows.map((one) => one.table)).toEqual(['users']);
    expect(found.files.map((one) => one.path)).toEqual(['files/user_100500.json']);
    expect(found.texts).toEqual([{path: 'files/session.log', line: 2, text: 'logged in as 100500', range: [13, 19]}]);
    expect(found.total).toBe(4);
  });

  it('finds a Flutter key with and without its prefix, whatever the case', function () {
    expect(searchAppData(data, 'USER_ID').prefs[0].key).toBe('flutter.user_id');
    expect(searchAppData(data, 'flutter.user_id').prefs[0].keyRange).toEqual([0, 15]);
  });

  it('cuts a long line around the match', function () {
    const long = `${'x'.repeat(200)}needle${'y'.repeat(200)}`;
    const found = searchAppData({texts: [{path: 'f', text: long}]}, 'needle');
    expect(found.texts[0].text.startsWith('…')).toBe(true);
    const [start, end] = found.texts[0].range;
    expect(found.texts[0].text.slice(start, end)).toBe('needle');
  });

  it('gives nothing for an empty search and keeps a limit', function () {
    expect(searchAppData(data, '  ').total).toBe(0);
    const many = {prefs: [{file: 'p', entries: Array.from({length: 80}, (_, i) => ({key: `k${i}`, value: 'v'}))}]};
    expect(searchAppData(many, 'k').prefs).toHaveLength(50);
  });
});
