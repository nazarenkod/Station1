import {describe, expect, it} from 'vitest';

import {createChangeJournal} from '../../app/common/node/agent/changes.js';

const setup = () => {
  const store = new Map([
    ['PROXY_CONFIG', {mockRules: []}],
    ['LOGS_VIEW', {minLevel: 'V'}],
  ]);
  const changed = [];
  const journal = createChangeJournal({
    get: async (key) => store.get(key),
    set: async (key, value) => store.set(key, value),
    onChanged: (keys) => changed.push(...keys),
  });
  const addRule = (turn, url) =>
    journal.apply({
      conversation: 'c1',
      turn,
      tool: 'proxy_mock_set',
      key: 'PROXY_CONFIG',
      compute: (config) => ({value: {...config, mockRules: [...config.mockRules, {url}]}, summary: `mock ${url}`}),
    });
  return {store, changed, journal, addRule};
};

describe('the journal of the agent’s changes', () => {
  it('keeps what a change was before and after, and rolls it back', async () => {
    const {store, changed, journal, addRule} = setup();
    const entry = await addRule(1, '*/limits');
    expect(entry).toMatchObject({
      before: {mockRules: []},
      after: {mockRules: [{url: '*/limits'}]},
      summary: 'mock */limits',
    });
    expect(await journal.undo(entry.id)).toEqual({ok: true});
    expect(store.get('PROXY_CONFIG')).toEqual({mockRules: []});
    expect(changed).toEqual(['PROXY_CONFIG', 'PROXY_CONFIG']);
    expect(journal.list('c1')[0].undone).toBe(true);
    expect(await journal.undo(entry.id)).toEqual({error: 'gone'});
  });

  it('does not write a change that failed', async () => {
    const {store, journal} = setup();
    const result = await journal.apply({
      conversation: 'c1',
      turn: 1,
      tool: 'view_set',
      key: 'LOGS_VIEW',
      compute: () => ({error: 'Nothing to change'}),
    });
    expect(result).toEqual({error: 'Nothing to change'});
    expect(store.get('LOGS_VIEW')).toEqual({minLevel: 'V'});
  });

  it('asks before wiping what the person changed by hand after the agent', async () => {
    const {store, journal, addRule} = setup();
    const entry = await addRule(1, '*/limits');
    store.set('PROXY_CONFIG', {mockRules: [{url: '*/limits', enabled: false}]});
    expect(await journal.undo(entry.id)).toEqual({conflict: true});
    expect(await journal.undo(entry.id, {force: true})).toEqual({ok: true});
    expect(store.get('PROXY_CONFIG')).toEqual({mockRules: []});
  });

  it('rolls back a whole turn, the last change first', async () => {
    const {store, journal, addRule} = setup();
    await addRule(1, '*/a');
    await addRule(2, '*/b');
    await addRule(2, '*/c');
    expect(await journal.undoTurn('c1', 2)).toEqual({ok: true, count: 2});
    expect(store.get('PROXY_CONFIG')).toEqual({mockRules: [{url: '*/a'}]});
  });

  it('rolls back a change made elsewhere, a branch switch, with its own way back', async () => {
    const {journal} = setup();
    let branch = 'feature/PAY-1';
    const entry = journal.note({
      conversation: 'c1',
      turn: 1,
      tool: 'repo_checkout',
      summary: 'bank-android: develop → feature/PAY-1',
      revert: async () => {
        branch = 'develop';
      },
    });
    expect(await journal.undo(entry.id, {force: true})).toEqual({ok: true});
    expect(branch).toBe('develop');
  });
});
