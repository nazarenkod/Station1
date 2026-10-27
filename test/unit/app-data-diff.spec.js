import {describe, expect, it} from 'vitest';

import {appendChanges, diffReads, highlights} from '../../app/common/shared/app-data/diff.js';

const prefs = (entries) => [{file: 'shared_prefs/app.xml', entries}];

describe('what changed between two reads', function () {
  it('gives nothing on the first read', function () {
    expect(diffReads(null, {prefs: prefs([{key: 'a', type: 'string', value: '1'}])})).toEqual([]);
  });

  it('finds added, changed and removed keys with the old value', function () {
    const before = {
      prefs: prefs([
        {key: 'token', type: 'string', value: 'old'},
        {key: 'gone', type: 'boolean', value: true},
      ]),
    };
    const after = {
      prefs: prefs([
        {key: 'token', type: 'string', value: 'new'},
        {key: 'last_card_id', type: 'int', value: 7},
      ]),
    };
    expect(diffReads(before, after)).toEqual([
      {section: 'prefs', file: 'shared_prefs/app.xml', kind: 'changed', key: 'token', before: 'old', after: 'new'},
      {section: 'prefs', file: 'shared_prefs/app.xml', kind: 'added', key: 'last_card_id', after: 7},
      {section: 'prefs', file: 'shared_prefs/app.xml', kind: 'removed', key: 'gone', before: true},
    ]);
  });

  it('counts the keys of a deleted file as removed', function () {
    const before = {prefs: prefs([{key: 'a', type: 'string', value: '1'}])};
    expect(diffReads(before, {prefs: []})).toEqual([
      {section: 'prefs', file: 'shared_prefs/app.xml', kind: 'removed', key: 'a', before: '1'},
    ]);
  });

  it('compares the rows of a table by their key and names the changed columns', function () {
    const table = (rows) => ({file: 'databases/app.db', table: 'orders', keys: ['id'], rows, count: rows.length});
    const before = {
      tables: [
        table([
          {id: 1, status: 'new'},
          {id: 2, status: 'paid'},
        ]),
      ],
    };
    const after = {
      tables: [
        table([
          {id: 1, status: 'paid'},
          {id: 3, status: 'new'},
        ]),
      ],
    };
    const changes = diffReads(before, after);
    expect(changes.map(({kind, key, columns}) => ({kind, key, columns}))).toEqual([
      {kind: 'changed', key: '[1]', columns: ['status']},
      {kind: 'added', key: '[3]', columns: undefined},
      {kind: 'removed', key: '[2]', columns: undefined},
    ]);
  });

  it('compares a big table only by its count', function () {
    const before = {tables: [{file: 'd.db', table: 'log', keys: ['rowid'], rows: null, count: 9000}]};
    const after = {tables: [{file: 'd.db', table: 'log', keys: ['rowid'], rows: null, count: 9004}]};
    expect(diffReads(before, after)).toEqual([
      {
        section: 'db',
        file: 'd.db',
        table: 'log',
        kind: 'changed',
        key: null,
        before: {rows: 9000},
        after: {rows: 9004},
      },
    ]);
  });

  it('finds files by size and time, leaving preferences and databases to their sections', function () {
    const before = {
      files: [
        {path: 'files/a.json', size: 10, mtime: 1, kind: 'json'},
        {path: 'files/old.txt', size: 1, mtime: 1, kind: 'text'},
        {path: 'databases/app.db-wal', size: 1, mtime: 1, kind: 'sqlite-aux'},
      ],
    };
    const after = {
      files: [
        {path: 'files/a.json', size: 12, mtime: 2, kind: 'json'},
        {path: 'files/new.png', size: 5, mtime: 2, kind: 'image'},
        {path: 'databases/app.db-wal', size: 900, mtime: 2, kind: 'sqlite-aux'},
      ],
    };
    expect(diffReads(before, after).map(({kind, file}) => `${kind} ${file}`)).toEqual([
      'changed files/a.json',
      'added files/new.png',
      'removed files/old.txt',
    ]);
  });
});

describe('the change feed', function () {
  it('colours each place by its last change', function () {
    const marks = highlights([
      {section: 'prefs', file: 'p.xml', key: 'a', kind: 'added'},
      {section: 'db', file: 'd.db', table: 't', key: '[1]', kind: 'changed'},
      {section: 'files', file: 'files/x', kind: 'removed'},
    ]);
    expect(marks).toEqual({'prefs|p.xml|a': 'added', 'db|d.db|t|[1]': 'changed', 'files|files/x': 'removed'});
  });

  it('puts the newest first and keeps a limit', function () {
    expect(appendChanges([{id: 1}], [{id: 2}, {id: 3}], 2)).toEqual([{id: 3}, {id: 2}]);
  });
});
