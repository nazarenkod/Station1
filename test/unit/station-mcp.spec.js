import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {afterEach, describe, expect, it} from 'vitest';
import {z} from 'zod';

import {createChangeJournal} from '../../app/common/node/agent/changes.js';
import {createStationMcp} from '../../app/common/node/agent/station-mcp.js';
import {stationTools} from '../../app/common/node/agent/tools.js';
import {capText, createReadBudget} from '../../app/common/shared/agent/budget.js';
import {maskHeaders, maskText} from '../../app/common/shared/agent/privacy.js';
import {compactFlow, compactTree} from '../../app/common/shared/agent/screen.js';
import {
  changeLogRules,
  changeMock,
  changeTrafficRules,
  changeView,
  findingsList,
  logsSearch,
  logsStats,
  trafficGet,
  trafficSearch,
  trafficStats,
} from '../../app/common/shared/agent/station-tools.js';
import {DEFAULT_SETTINGS, LOGS_VIEW, PROXY_CONFIG} from '../../app/common/shared/setting-defs.js';

const NOW = Date.parse('2026-10-27T12:00:00Z');

const exchange = (id, patch = {}) => ({
  id,
  method: 'POST',
  url: 'https://api.bank.ua/v2/transfers',
  startedAt: NOW - 60000,
  status: 201,
  durationMs: 300,
  flags: [],
  requestHeaders: {authorization: 'Bearer secret-token', 'content-type': 'application/json'},
  requestBody: JSON.stringify({amount: 100, purpose: 'rent', card: '4149 4993 1234 5678'}),
  responseHeaders: {'set-cookie': 'sid=abc'},
  responseBody: JSON.stringify({id: 'tx-1', access_token: 'zzz'}),
  ...patch,
});

const traffic = [
  exchange('a'),
  exchange('b', {status: 422, flags: ['error'], startedAt: NOW - 30000}),
  exchange('c', {
    method: 'GET',
    url: 'https://api.bank.ua/v2/cards/1287/limits',
    status: 200,
    durationMs: 2100,
    flags: ['slow'],
  }),
  exchange('d', {method: 'GET', url: 'https://api.bank.ua/v2/cards/1288/limits', startedAt: NOW - 3600000}),
  exchange('e', {method: 'GET', url: 'https://analytics.example.com/collect', status: null, durationMs: null}),
];

describe('reading the traffic', () => {
  it('sums endpoints up without rows, ids folded into one endpoint', () => {
    const stats = trafficStats(traffic, {now: NOW});
    expect(stats.requests).toBe(5);
    const limits = stats.top.find((one) => one.endpoint === 'GET api.bank.ua/v2/cards/{id}/limits');
    expect(limits).toMatchObject({count: 2, maxMs: 2100, flags: {slow: 1}});
    expect(trafficStats(traffic, {sinceMinutes: 10, now: NOW}).requests).toBe(4);
  });

  it('finds requests by status class, method and part of the path, newest first, in pages', () => {
    expect(trafficSearch(traffic, {status: '4xx'}, {now: NOW}).rows[0]).toMatch(
      /^b · POST · .*422 · 300ms · flags: error/,
    );
    expect(trafficSearch(traffic, {status: 'error'}, {now: NOW}).total).toBe(1);
    const page = trafficSearch(traffic, {method: 'get', path: '/limits', limit: 1}, {now: NOW});
    expect(page).toMatchObject({total: 2, more: 1});
    expect(page.rows[0].startsWith('c ·')).toBe(true);
  });

  it('gives one request with secrets and personal data masked, or only the fields asked for', () => {
    const whole = trafficGet(traffic[0]);
    expect(whole.requestHeaders.authorization).toBe('•••');
    expect(whole.responseHeaders['set-cookie']).toBe('•••');
    expect(whole.requestBody).not.toContain('1234 5678');
    expect(whole.responseBody).toContain('"access_token":"•••"');
    const fields = trafficGet(traffic[0], {
      fields: ['request.body.purpose', 'response.body.id', 'request.body.missing'],
    });
    expect(fields.fields).toEqual({
      'request.body.purpose': '"rent"',
      'response.body.id': '"tx-1"',
      'request.body.missing': '(absent)',
    });
    expect(fields.requestBody).toBeUndefined();
    expect(trafficGet(undefined).error).toMatch(/No request/);
  });
});

describe('reading the log and the findings', () => {
  const entries = [
    {seq: 1, date: '10-27', time: '11:59:00.000', level: 'I', tag: 'Pay', message: 'start'},
    {seq: 2, date: '10-27', time: '11:59:10.000', level: 'E', tag: 'Pay', message: 'HTTP 422 for +380 67 123 45 67'},
    {seq: 3, date: '10-27', time: '11:59:20.000', level: 'W', tag: 'Net', message: 'slow'},
    {seq: 4, date: '10-27', time: '10:00:00.000', level: 'E', tag: 'Old', message: 'long ago'},
  ];

  it('counts levels and the tags with errors first', () => {
    const stats = logsStats(entries, {
      sinceMinutes: 5,
      now: Date.parse(`${new Date(NOW).getFullYear()}-10-27T12:00:00`),
    });
    expect(stats.lines).toBe(3);
    expect(stats.top[0]).toEqual({tag: 'Pay', count: 2, errors: 1});
  });

  it('finds lines from a level up, masked, with lines around them when asked', () => {
    const found = logsSearch(entries, {level: 'W'});
    expect(found.total).toBe(3);
    expect(found.rows[0]).toMatch(/^#4 /);
    expect(found.rows.join('\n')).not.toContain('123 45 67');
    const around = logsSearch(entries, {text: '422', context: 1});
    expect(around.rows[0].split('\n')).toHaveLength(3);
    expect(around.rows[0]).toContain('> #2');
    expect(logsSearch(entries, {regex: '('}).error).toMatch(/regular expression/);
  });

  it('lists findings by source and severity', () => {
    const findings = [
      {id: 'f1', tool: 'proxy', rule: 'errors', severity: 'high', subject: 'POST /v2/transfers 422'},
      {id: 'f2', tool: 'logs', rule: 'log-crash', severity: 'high', subject: 'NPE'},
      {id: 'f3', tool: 'proxy', rule: 'slow', severity: 'medium', subject: 'GET /limits'},
    ];
    const proxy = findingsList(findings, {source: 'proxy'});
    expect(proxy).toMatchObject({total: 2, counts: {'proxy/high': 1, 'proxy/medium': 1}});
  });
});

describe('the screen for the agent', () => {
  it('keeps the meaningful elements only and hides what was typed in', () => {
    const tree = {
      nodes: [
        {depth: 0, className: 'android.widget.FrameLayout', text: '', label: '', resourceId: '', clickable: false},
        {depth: 1, className: 'android.widget.TextView', text: 'Переказ', label: '', resourceId: 'ua.bank:id/title'},
        {depth: 1, className: 'android.widget.EditText', text: '4149 4993 1234 5678', resourceId: 'ua.bank:id/card'},
        {depth: 1, className: 'android.widget.Button', text: 'Далі', clickable: true, enabled: false},
      ],
    };
    const {lines, total} = compactTree(tree);
    expect(total).toBe(3);
    expect(lines).toEqual([
      '  TextView "Переказ" id=title',
      '  EditText "•••" id=card',
      '  Button "Далі" [tap] [disabled]',
    ]);
  });

  it('gives the flow as screens with states and the path', () => {
    const flow = compactFlow({
      screens: [
        {key: 'login', title: 'Логін', visits: 1, states: [{id: 'a', number: 1}]},
        {
          key: 'pay',
          title: 'Переказ',
          visits: 2,
          states: [
            {id: 'b', number: 1},
            {id: 'c', number: 2, title: 'діалог: Підтвердіть'},
          ],
        },
      ],
      path: [{key: 'login'}, {key: 'pay', repeat: 2, action: {kind: 'tap'}}],
    });
    expect(flow.screens[1].states).toEqual(['state 1', 'діалог: Підтвердіть']);
    expect(flow.path).toEqual(['Логін', 'Переказ ×2 (after tap)']);
  });
});

describe('the read budget', () => {
  it('cuts an answer at its limit with a hint how to narrow it', () => {
    const {text, truncated} = capText('x'.repeat(100), 10);
    expect(truncated).toBe(true);
    expect(text).toMatch(/cut at 10 of 100 characters: narrow the call/);
  });

  it('says "unchanged" instead of giving the same again', () => {
    const budget = createReadBudget({read: 1000});
    budget.startTurn();
    expect(budget.give('traffic_get', {id: 'a'}, 'body').kind).toBe('data');
    budget.startTurn();
    const again = budget.give('traffic_get', {id: 'a'}, 'body');
    expect(again).toMatchObject({kind: 'same'});
    expect(again.text).toContain('turn 1');
    expect(budget.give('traffic_get', {id: 'a'}, 'body changed').kind).toBe('data');
  });

  it('stops reading past the budget of the turn, starts again next turn, and grows when allowed', () => {
    const budget = createReadBudget({read: 100, deep: 1000});
    budget.startTurn();
    expect(budget.give('logs_search', {page: 1}, 'x'.repeat(80)).kind).toBe('data');
    expect(budget.give('logs_search', {page: 2}, 'y'.repeat(80)).kind).toBe('budget');
    expect(budget.state()).toMatchObject({used: 80, limit: 100, exhausted: true});
    budget.extend();
    expect(budget.give('logs_search', {page: 2}, 'y'.repeat(80)).kind).toBe('data');
    budget.startTurn({deep: true});
    expect(budget.state()).toMatchObject({used: 0, limit: 1000, deep: true});
    budget.startTurn({limits: {read: 50}});
    expect(budget.state().limit).toBe(50);
  });
});

describe('masking', () => {
  it('hides authorization headers by name and personal values by pattern', () => {
    expect(maskHeaders({Authorization: 'Bearer x', 'X-Request-Id': 'abc'})).toEqual({
      Authorization: '•••',
      'X-Request-Id': 'abc',
    });
    expect(maskText('{"password":"p@ss","email":"a@b.ua"}')).toBe('{"password":"•••","email":"•••"}');
  });
});

describe('changes the agent makes', () => {
  const config = {
    ...DEFAULT_SETTINGS[PROXY_CONFIG],
    mockRules: [{id: 'm1', url: '*/limits', action: 'respond', enabled: true}],
  };

  it('adds, changes, switches and removes a mock rule in the shape of the rule editor', () => {
    const added = changeMock(config, {
      op: 'add',
      rule: {url: '*/v2/transfers', method: 'POST', status: 500, body: '{}'},
    });
    expect(added.value.mockRules[1]).toMatchObject({
      url: '*/v2/transfers',
      status: '500',
      action: 'respond',
      enabled: true,
      stage: 'response',
    });
    expect(changeMock(config, {op: 'disable', id: 'm1'}).value.mockRules[0].enabled).toBe(false);
    expect(changeMock(config, {op: 'remove', id: 'm1'}).value.mockRules).toEqual([]);
    expect(changeMock(config, {op: 'add', rule: {}}).error).toMatch(/url pattern/);
    expect(changeMock(config, {op: 'remove', id: 'nope'}).error).toMatch(/No mock rule/);
  });

  it('changes known traffic rules and fields only', () => {
    const next = changeTrafficRules(config, {slow: {defaultMs: 2500, bogus: 1}});
    expect(next.value.trafficRules.slow).toEqual({defaultMs: 2500});
    expect(changeTrafficRules(config, {nonsense: {}}).error).toMatch(/Unknown traffic rule/);
  });

  it('adds a custom log rule only with a valid pattern, and overrides a built-in one', () => {
    const rules = {overrides: {}, custom: []};
    expect(changeLogRules(rules, {op: 'add', rule: {name: 'Pay', pattern: '('}}).error).toMatch(/regular expression/);
    const added = changeLogRules(rules, {op: 'add', rule: {name: 'Pay', pattern: 'payment failed'}});
    expect(added.value.custom[0]).toMatchObject({name: 'Pay', severity: 'medium', scope: 'app'});
    expect(
      changeLogRules(rules, {op: 'override', id: 'log-strict-mode', rule: {enabled: false}}).value.overrides,
    ).toEqual({
      'log-strict-mode': {enabled: false},
    });
  });

  it('changes a filter by its known fields only', () => {
    const view = DEFAULT_SETTINGS[LOGS_VIEW];
    expect(changeView(view, 'logs', {minLevel: 'W', bogus: 1}).value).toEqual({...view, minLevel: 'W'});
    expect(changeView(view, 'logs', {bogus: 1}).error).toMatch(/Nothing to change/);
  });
});

describe('the station’s MCP server', () => {
  let mcp;
  afterEach(() => mcp?.stop());

  const connect = async (token, conversation = 'conv-1') => {
    const client = new Client({name: 'test', version: '1'});
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcp.port}/mcp/${conversation}`), {
        requestInit: {headers: {Authorization: `Bearer ${token}`}},
      }),
    );
    return client;
  };

  it('listens on 127.0.0.1 only and refuses a request without its token', async () => {
    mcp = createStationMcp({tools: []});
    const {port, token} = await mcp.start();
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    const none = await fetch(`http://127.0.0.1:${port}/mcp/conv-1`, {method: 'POST', body: '{}'});
    expect(none.status).toBe(401);
    const wrong = await fetch(`http://127.0.0.1:${port}/mcp/conv-1`, {
      method: 'POST',
      headers: {Authorization: 'Bearer nope'},
      body: '{}',
    });
    expect(wrong.status).toBe(401);
  });

  it('runs the station tools: reads through the budget, changes through the journal', async () => {
    const store = new Map([[PROXY_CONFIG, {...DEFAULT_SETTINGS[PROXY_CONFIG]}]]);
    const changed = [];
    const journal = createChangeJournal({
      get: async (key) => store.get(key),
      set: async (key, value) => store.set(key, value),
      onChanged: (keys) => changed.push(...keys),
    });
    const tools = stationTools({
      proxy: () => ({status: {running: true}, exchanges: traffic, findings: []}),
      logs: () => null,
      ask: async (kind) => (kind === 'state' ? {tab: 'proxy'} : null),
      get: async (key) => store.get(key),
      journal,
      turnOf: () => 3,
      project: async () => ({profileId: 'p1', source: {repos: []}, paths: {}}),
      rememberBranch: async () => {},
      maskPatterns: async () => undefined,
    });
    mcp = createStationMcp({tools});
    const {token} = await mcp.start();
    expect(mcp.readTools.has('traffic_get')).toBe(true);
    expect(mcp.readTools.has('proxy_mock_set')).toBe(false);

    const client = await connect(token);
    const listed = await client.listTools();
    const mock = listed.tools.find((tool) => tool.name === 'proxy_mock_set');
    expect(mock.annotations).toMatchObject({readOnlyHint: false, destructiveHint: true});

    mcp.startTurn('conv-1');
    const state = await client.callTool({name: 'station_state', arguments: {}});
    expect(JSON.parse(state.content[0].text)).toMatchObject({tab: 'proxy', proxy: {running: true, requests: 5}});

    const done = await client.callTool({
      name: 'proxy_mock_set',
      arguments: {op: 'add', rule: {url: '*/limits', status: 500}},
    });
    expect(done.content[0].text).toMatch(/^Done: mock respond \* \*\/limits/);
    expect(store.get(PROXY_CONFIG).mockRules).toHaveLength(1);
    expect(changed).toEqual([PROXY_CONFIG]);
    expect(journal.list('conv-1')).toMatchObject([{tool: 'proxy_mock_set', turn: 3, undone: false}]);
    await client.close();
  });

  it('says why a tool failed instead of breaking the conversation', async () => {
    mcp = createStationMcp({
      tools: [
        {
          name: 'broken',
          readOnly: true,
          description: 'x',
          input: {id: z.string()},
          run: async () => Promise.reject(new Error('window closed')),
        },
      ],
    });
    const {token} = await mcp.start();
    const client = await connect(token);
    const result = await client.callTool({name: 'broken', arguments: {id: 'a'}});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('window closed');
    await client.close();
  });
});
