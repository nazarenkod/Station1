import {EventEmitter} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {createAgentService} from '../../app/common/node/agent/service.js';
import {
  addConversation,
  currentSession,
  findConversation,
  forgetTask,
  GENERAL,
  pastConversations,
  resumeConversation,
} from '../../app/common/shared/agent/conversations.js';
import {AGENT_CONFIG, AGENT_CONSENT, AGENT_PROJECT, AGENT_SESSIONS} from '../../app/common/shared/setting-defs.js';

describe('which session holds which conversation', () => {
  const at = (minute) => new Date(`2026-10-27T10:${String(minute).padStart(2, '0')}:00Z`);

  it('keeps one current conversation for each task and one general for the profile', () => {
    let map = addConversation({}, 'p1', {sessionId: 's-gen', now: at(1)});
    map = addConversation(map, 'p1', {sessionId: 's-pay', taskKey: 'PAY-1', now: at(2)});
    expect(currentSession(map, 'p1', null)).toBe('s-gen');
    expect(currentSession(map, 'p1', 'PAY-1')).toBe('s-pay');
    expect(currentSession(map, 'p2', null)).toBeNull();
    expect(findConversation(map, 's-pay')).toMatchObject({profileId: 'p1', key: 'PAY-1', conversation: 's-pay'});
  });

  it('lets a new conversation take over and an earlier one come back', () => {
    let map = addConversation({}, 'p1', {sessionId: 's1', now: at(1)});
    map = addConversation(map, 'p1', {sessionId: 's2', now: at(2)});
    expect(currentSession(map, 'p1')).toBe('s2');
    expect(pastConversations(map, 'p1').map((one) => one.sessionId)).toEqual(['s2', 's1']);
    map = resumeConversation(map, 'p1', 's1');
    expect(currentSession(map, 'p1')).toBe('s1');
  });

  it('forgets the conversations of a forgotten task only', () => {
    let map = addConversation({}, 'p1', {sessionId: 's-gen'});
    map = addConversation(map, 'p1', {sessionId: 's-pay', taskKey: 'PAY-1'});
    map = forgetTask(map, 'p1', 'PAY-1');
    expect(currentSession(map, 'p1', 'PAY-1')).toBeNull();
    expect(map.p1.list.map((one) => one.key)).toEqual([GENERAL]);
  });
});

class FakeKiro extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.running = true;
    this.next = 0;
  }
  async newSession(params) {
    this.calls.push(['new', params]);
    return {sessionId: `sess-${++this.next}`};
  }
  async loadSession(params) {
    this.calls.push(['load', params]);
    if (params.sessionId === 'lost') {
      throw new Error('Session not found');
    }
    return {sessionId: params.sessionId};
  }
  async prompt(sessionId, prompt) {
    this.calls.push(['prompt', {sessionId, prompt}]);
    return {stopReason: 'end_turn'};
  }
  cancel() {}
}

describe('the agent service', () => {
  let home;
  let store;
  let kiro;
  let sent;
  let turns;
  let service;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'station-agent-'));
    store = new Map([
      [
        AGENT_CONFIG,
        {
          personalInstructions: 'Відповідай коротко.',
          mcpServers: [
            {
              id: 'm1',
              name: 'jira',
              kind: 'http',
              url: 'https://mcp.atlassian.com/v1/mcp',
              headers: [{name: 'Authorization', hidden: true}],
            },
          ],
        },
      ],
      [AGENT_PROJECT, {instructions: 'Банківський застосунок.', mcpServers: []}],
    ]);
    kiro = new FakeKiro();
    sent = [];
    turns = [];
    const mcp = {
      readTools: new Set(['station_state']),
      start: async () => ({port: 4321, token: 'tok'}),
      startTurn: (conversation, options) => turns.push([conversation, options]),
    };
    service = createAgentService({
      kiro,
      mcp,
      credits: {
        entries: [],
        async add(entry) {
          this.entries.push(entry);
        },
        async summary() {
          return {today: this.entries.reduce((sum, one) => sum + (one.credits ?? 0), 0)};
        },
      },
      get: async (key) => store.get(key),
      set: async (key, value) => store.set(key, value),
      workspace: async () => ({cwd: '/code/bank-android', additionalDirectories: ['/code/bank-android/libs/design']}),
      secrets: async () => ({Authorization: 'Bearer atl-secret'}),
      home,
      send: (channel, payload) => sent.push([channel, payload]),
      ask: async () => null,
      notesFor: async (chips) => (chips.some((one) => one.kind === 'request') ? [{id: 'n-1'}, {id: 'n-2'}] : []),
    });
  });

  afterEach(() => rm(home, {recursive: true, force: true}));

  it('opens a new conversation in the repository, with the station’s folder and servers', async () => {
    const opened = await service.open({profileId: 'p1', taskKey: 'PAY-1'});
    expect(opened).toMatchObject({ok: true, sessionId: 'sess-1', fresh: true});
    const [, params] = kiro.calls[0];
    expect(params.cwd).toBe('/code/bank-android');
    expect(params.additionalDirectories).toEqual(['/code/bank-android/libs/design', home]);
    expect(params.mcpServers[0]).toEqual({
      type: 'http',
      name: 'station',
      url: `http://127.0.0.1:4321/mcp/${opened.conversation}`,
      headers: [{name: 'Authorization', value: 'Bearer tok'}],
    });
    // the secret goes in at the last moment, from the keychain
    expect(params.mcpServers[1]).toMatchObject({
      name: 'jira',
      headers: [{name: 'Authorization', value: 'Bearer atl-secret'}],
    });
    expect(currentSession(store.get(AGENT_SESSIONS), 'p1', 'PAY-1')).toBe('sess-1');
  });

  it('writes the instructions into the station’s folder, the station’s first, then the project’s, then the person’s', async () => {
    await service.open({profileId: 'p1'});
    const steering = await readFile(path.join(home, '.kiro', 'steering', 'station.md'), 'utf8');
    expect(steering.startsWith('---\ninclusion: always\n---\n# You are the brain')).toBe(true);
    expect(steering.indexOf('Банківський застосунок.')).toBeGreaterThan(steering.indexOf('Impact analysis'));
    expect(steering.indexOf('Відповідай коротко.')).toBeGreaterThan(steering.indexOf('Банківський застосунок.'));
  });

  it('gives the same conversation back, and loads it again in a new run of Kiro', async () => {
    const first = await service.open({profileId: 'p1'});
    expect((await service.open({profileId: 'p1'})).sessionId).toBe(first.sessionId);
    expect(kiro.calls.filter(([kind]) => kind === 'new')).toHaveLength(1);

    // a window opened anew asks for the conversation again to show it
    await service.open({profileId: 'p1', replay: true});
    expect(kiro.calls.at(-1)).toEqual(['load', expect.objectContaining({sessionId: first.sessionId})]);

    kiro.emit('exit');
    const again = await service.open({profileId: 'p1'});
    expect(again).toMatchObject({sessionId: first.sessionId, fresh: false});
    const [, load] = kiro.calls.at(-1);
    expect(load).toMatchObject({sessionId: first.sessionId, cwd: '/code/bank-android'});
    expect(load.mcpServers[0].url).toContain(first.conversation);
    expect(sent).toContainEqual(['agent:reset', {sessionId: first.sessionId}]);
  });

  it('starts a new conversation when Kiro lost the old one', async () => {
    store.set(AGENT_SESSIONS, addConversation({}, 'p1', {sessionId: 'lost'}));
    const opened = await service.open({profileId: 'p1'});
    expect(opened).toMatchObject({ok: true, sessionId: 'sess-1', fresh: true});
  });

  it('sends nothing without the consent of the profile', async () => {
    const {sessionId} = await service.open({profileId: 'p1'});
    expect(await service.prompt({sessionId, message: 'привіт'})).toEqual({ok: false, error: 'consent'});
    expect(kiro.calls.some(([kind]) => kind === 'prompt')).toBe(false);
    expect(await service.consented('p1')).toBe(false);
    await service.consent('p1');
    expect(await service.consented('p1')).toBe(true);
    expect(await service.prompt({sessionId, message: 'привіт'})).toMatchObject({ok: true, turn: 1});
  });

  it('sends the reference with the message and starts the read budget of the turn', async () => {
    const {sessionId, conversation} = await service.open({profileId: 'p1'});
    await service.consent('p1');
    await service.prompt({
      sessionId,
      message: 'чому 422?',
      chips: [{kind: 'request', id: 'r1', label: 'POST /v2/transfers 422'}],
      deep: true,
    });
    const [, {prompt}] = kiro.calls.at(-1);
    expect(prompt[0].text).toContain('- request: POST /v2/transfers 422 (id: r1)');
    // the notes about the request go by their ids only
    expect(prompt[0].text).toContain('- notes: 2 notes (id: n-1,n-2)');
    expect(prompt[1]).toEqual({type: 'text', text: 'чому 422?'});
    expect(turns.at(-1)).toEqual([conversation, {deep: true, limits: {read: 40000, deep: 200000}}]);
  });

  it('asks a yes past the daily threshold, once a day', async () => {
    store.set(AGENT_CONFIG, {...store.get(AGENT_CONFIG), dailyCreditLimit: 1});
    const {sessionId} = await service.open({profileId: 'p1'});
    await service.consent('p1');
    kiro.emit('update', sessionId, {
      sessionUpdate: 'session_info_update',
      _meta: {kiro: {kind: 'turn_completion', promptTurnSummaries: [{unit: 'credit', usage: 1.2}]}},
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await service.prompt({sessionId, message: 'ще'})).toMatchObject({ok: false, error: 'creditLimit'});
    expect(await service.prompt({sessionId, message: 'ще', confirmCredits: true})).toMatchObject({ok: true});
    expect(store.get(AGENT_CONSENT).confirmedDay).toBe(new Date().toISOString().slice(0, 10));
    expect(await service.prompt({sessionId, message: 'і ще'})).toMatchObject({ok: true});
  });

  it('writes the credits of a turn to the ledger with its profile and task, not of a replayed one', async () => {
    const {sessionId} = await service.open({profileId: 'p1', taskKey: 'PAY-1'});
    kiro.emit('update', sessionId, {
      sessionUpdate: 'session_info_update',
      _meta: {kiro: {kind: 'turn_completion', elapsedTime: 900, promptTurnSummaries: [{unit: 'credit', usage: 0.06}]}},
    });
    kiro.emit('update', sessionId, {
      sessionUpdate: 'session_info_update',
      _meta: {kiro: {kind: 'turn_completion', replay: true, promptTurnSummaries: [{unit: 'credit', usage: 5}]}},
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const summary = sent.filter(([channel]) => channel === 'agent:credits');
    expect(summary).toHaveLength(1);
    expect(summary[0][1].today).toBeCloseTo(0.06);
  });

  it('writes screen objects in a one-off conversation in the autotests repository, its answer kept apart from the chat', async () => {
    expect(await service.generate({profileId: 'p1', cwd: '/code/autotests', prompt: 'код'})).toEqual({
      ok: false,
      error: 'consent',
    });
    await service.consent('p1');
    kiro.prompt = async (sessionId, prompt) => {
      kiro.calls.push(['prompt', {sessionId, prompt}]);
      kiro.emit('update', sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: {type: 'text', text: '=== A ==='},
      });
      kiro.emit('update', sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: {type: 'text', text: '\nclass A'},
      });
      return {stopReason: 'end_turn'};
    };
    const result = await service.generate({profileId: 'p1', cwd: '/code/autotests', prompt: 'код'});
    expect(result).toMatchObject({ok: true, text: '=== A ===\nclass A'});
    const [, params] = kiro.calls.find(([kind]) => kind === 'new');
    expect(params).toMatchObject({cwd: '/code/autotests', additionalDirectories: [], mcpServers: []});
    expect(sent.filter(([channel]) => channel === 'agent:update')).toEqual([]);
  });

  it('lets a one-off conversation read, and refuses for it what would need the person', async () => {
    await service.consent('p1');
    await service.generate({profileId: 'p1', cwd: '/code/autotests', prompt: 'код'});
    const sessionId = kiro.calls.find(([kind]) => kind === 'prompt')[1].sessionId;
    const options = [
      {optionId: 'yes', kind: 'allow_once'},
      {optionId: 'no', kind: 'reject_once'},
    ];
    const read = {sessionId, options, toolCall: {kind: 'read'}};
    const write = {sessionId, options, toolCall: {kind: 'edit'}};
    const other = {sessionId, options, toolCall: {kind: 'other'}};
    expect(await service.permission(read)).toEqual({optionId: 'yes'});
    expect(await service.permission(write)).toEqual({optionId: 'no'});
    expect(await service.permission(other)).toEqual({optionId: 'no'});
  });
});
