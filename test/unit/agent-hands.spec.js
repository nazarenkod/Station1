import {describe, expect, it} from 'vitest';

import {createStationPlugin} from '../../app/common/node/agent/hands-plugin.mjs';
import {createHands} from '../../app/common/node/agent/hands.js';
import {createAgentService} from '../../app/common/node/agent/service.js';
import {createStationMcp} from '../../app/common/node/agent/station-mcp.js';
import {
  actionLine,
  allowedTools,
  failureHint,
  goalsStatus,
  groupOf,
  handsPermission,
  handsVerdict,
  shortAnswer,
} from '../../app/common/shared/agent/hands.js';
import {decidePermission} from '../../app/common/shared/agent/permissions.js';
import {cleanPlaybook, DEFAULT_PERMISSIONS} from '../../app/common/shared/agent/playbook.js';

const expected = {serverUrl: 'http://127.0.0.1:4723', sessionId: 's1'};
const playbook = cleanPlaybook({
  forbidden: [
    {kind: 'text', value: 'Оплатити', why: 'real money'},
    {kind: 'screen', value: 'Danger zone'},
  ],
});
const verdict = (tool, args = {}, extra = {}) =>
  handsVerdict({tool, args, expected, active: 's1', playbook, appId: 'com.bank', ...extra});

describe('the tools the agent gets', function () {
  it('puts each tool and action in a group of the permissions', function () {
    expect(groupOf('appium_gesture', {action: 'tap'})).toBe('act');
    expect(groupOf('appium_app_lifecycle', {action: 'install'})).toBe('install');
    expect(groupOf('appium_app_lifecycle', {action: 'clear'})).toBe('appData');
    expect(groupOf('appium_app_lifecycle', {action: 'deep_link'})).toBe('app');
    expect(groupOf('appium_geolocation', {action: 'get'})).toBe('look');
    expect(groupOf('appium_geolocation', {action: 'set'})).toBe('device');
    expect(groupOf('appium_screenshot')).toBe('capture');
    expect(groupOf('select_device')).toBe('never');
    expect(groupOf('appium_something_new')).toBe('never');
  });

  it('shows the core tools of a flow, all of them on request, never the session and device setup', function () {
    const core = allowedTools(DEFAULT_PERMISSIONS);
    expect(core).toEqual([
      'appium_find_element',
      'appium_get_text',
      'appium_gesture',
      'appium_set_value',
      'appium_mobile_press_key',
      'appium_mobile_keyboard',
      'appium_alert',
      'appium_app_lifecycle',
    ]);
    const all = allowedTools(DEFAULT_PERMISSIONS, {extended: true});
    expect(all).toContain('generate_locators');
    expect(all).toContain('appium_screenshot');
    for (const tool of ['appium_session_management', 'select_device', 'appium_driver_settings']) {
      expect(all).not.toContain(tool);
    }
    const strict = allowedTools({...DEFAULT_PERMISSIONS, capture: 'deny', device: 'deny'}, {extended: true});
    expect(strict).not.toContain('appium_screenshot');
    expect(strict).not.toContain('appium_mobile_clipboard');
    // its get still reads
    expect(strict).toContain('appium_geolocation');
  });

  it('answers the permission cards by the group: allowed goes, asked is the person, denied is refused', function () {
    expect(handsPermission('appium_gesture', {action: 'tap'}, DEFAULT_PERMISSIONS)).toBe('allow');
    expect(handsPermission('appium_app_lifecycle', {action: 'install'}, DEFAULT_PERMISSIONS)).toBe('ask');
    expect(
      handsPermission('appium_app_lifecycle', {action: 'install'}, {...DEFAULT_PERMISSIONS, install: 'deny'}),
    ).toBe('reject');
    expect(handsPermission('appium_session_management', {action: 'attach'}, DEFAULT_PERMISSIONS)).toBe('reject');
    expect(handsPermission('select_device', {}, DEFAULT_PERMISSIONS)).toBe('reject');
  });
});

describe('whether an action may go', function () {
  it('works on the station session only, and has the plugin join it', function () {
    expect(verdict('appium_gesture', {action: 'back'}, {expected: null}).text).toMatch(/no session/i);
    const notYet = verdict('appium_gesture', {action: 'back'}, {active: null});
    expect(notYet.ok).toBe(false);
    expect(notYet.attach).toEqual(expected);
    expect(
      verdict('appium_session_management', {action: 'attach', remoteServerUrl: expected.serverUrl, sessionId: 's1'}).ok,
    ).toBe(false);
    expect(verdict('appium_gesture', {action: 'back', sessionId: 'other'}).ok).toBe(false);
  });

  it('stops after Stop, and refuses what the project denies', function () {
    expect(verdict('appium_gesture', {action: 'back'}, {stopped: true}).text).toMatch(/Stop/);
    const denied = cleanPlaybook({permissions: {act: 'deny'}});
    expect(verdict('appium_gesture', {action: 'back'}, {playbook: denied}).ok).toBe(false);
    expect(verdict('select_device').ok).toBe(false);
  });

  it('never types into a password field and never taps what is forbidden', function () {
    expect(verdict('appium_set_value', {elementUUID: 'e1', text: 'x'}, {element: {password: true}}).text).toMatch(
      /app_login/,
    );
    expect(
      verdict(
        'appium_set_value',
        {elementUUID: 'e1', text: 'x'},
        {element: {className: 'XCUIElementTypeSecureTextField'}},
      ).ok,
    ).toBe(false);
    expect(verdict('appium_gesture', {action: 'tap', elementUUID: 'e2'}, {element: {text: 'Оплатити'}}).text).toMatch(
      /real money/,
    );
    expect(verdict('appium_gesture', {action: 'swipe', direction: 'up'}, {screen: 'Danger zone'}).ok).toBe(false);
    expect(verdict('appium_gesture', {action: 'tap', elementUUID: 'e3'}, {element: {text: 'Переказ'}}).ok).toBe(true);
  });

  it('keeps the app actions to the project app, installs only known builds, never reads the whole XML', function () {
    expect(verdict('appium_app_lifecycle', {action: 'terminate', id: 'com.other'}).ok).toBe(false);
    expect(verdict('appium_app_lifecycle', {action: 'terminate', id: 'com.bank'}).ok).toBe(true);
    expect(verdict('appium_app_lifecycle', {action: 'activate', id: 'com.bank'}, {appId: null}).ok).toBe(false);
    expect(verdict('appium_app_lifecycle', {action: 'install', path: '/tmp/any.apk'}, {builds: ['/b/1.apk']}).ok).toBe(
      false,
    );
    expect(verdict('appium_app_lifecycle', {action: 'install', path: '/b/1.apk'}, {builds: ['/b/1.apk']}).ok).toBe(
      true,
    );
    expect(verdict('appium_get_page_source', {}).ok).toBe(false);
    expect(verdict('appium_get_page_source', {saveToFile: true, pattern: 'Login'}).ok).toBe(true);
  });
});

describe('what the agent and the chat see of an action', function () {
  it('names the action and its element, never the typed text', function () {
    expect(actionLine('appium_gesture', {action: 'tap'}, {text: 'Переказ'})).toBe('tap «Переказ»');
    expect(actionLine('appium_set_value', {text: 'secret'}, {resourceId: 'com.bank:id/amount'})).toBe('type «amount»');
    expect(actionLine('appium_gesture', {action: 'tap', x: 10, y: 20})).toBe('tap «10,20»');
    expect(actionLine('appium_app_lifecycle', {action: 'deep_link', url: 'bank://x'})).toBe('app deep_link «bank://x»');
  });

  it('answers in at most 1 000 characters with the screen after the action', function () {
    const text = shortAnswer('x'.repeat(5000), {before: {title: 'Home'}, after: {title: 'Transfer', state: 'empty'}});
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text).toMatch(/Screen now: Transfer \(empty\)\.$/);
    expect(shortAnswer('Tapped', {before: {title: 'Home'}, after: {title: 'Home'}})).toBe(
      'Tapped\nScreen now: Home (unchanged).',
    );
  });
});

describe('the station side of the hands', function () {
  const book = {forbidden: [{kind: 'text', value: 'Оплатити'}]};
  const session = {
    serverUrl: 'http://127.0.0.1:4723',
    sessionId: 's1',
    platform: 'android',
    appId: 'com.bank',
    screen: {title: 'Home'},
  };
  const make = (extra = {}) => {
    const asked = [];
    const steps = [];
    const hands = createHands({
      dir: '/nowhere/hands',
      node: '/Applications/Station.app/Contents/MacOS/Station',
      npm: async () => true,
      ask: async (kind, args) => {
        asked.push(kind);
        if (kind === 'session') {
          return session;
        }
        if (kind === 'handsStep') {
          return {screen: {title: 'Transfer'}};
        }
        if (kind === 'elementAt') {
          return args.x === 1 ? {text: 'Оплатити'} : {text: 'Далі'};
        }
        return null;
      },
      playbook: async () => book,
      builds: async () => [],
      limit: async () => 2,
      onStep: (conversation, step) => steps.push(step),
      ...extra,
    });
    return {hands, asked, steps};
  };

  it('lets an action go on the session of the Inspector and answers short with the new screen', async function () {
    const {hands, steps} = make();
    const ok = await hands.check('c1', {
      tool: 'appium_gesture',
      args: {action: 'tap', elementUUID: 'e1'},
      active: 's1',
      element: {text: 'Далі'},
    });
    expect(ok.ok).toBe(true);
    const answer = await hands.done('c1', {
      tool: 'appium_gesture',
      args: {action: 'tap'},
      ok: true,
      text: 'Tapped',
      element: {text: 'Далі'},
    });
    expect(answer.text).toBe('Tapped\nScreen now: Transfer.');
    expect(steps).toEqual([
      expect.objectContaining({line: 'tap «Далі»', screenBefore: 'Home', screenAfter: 'Transfer', ok: true}),
    ]);
  });

  it('finds what a tap by coordinates hits, and refuses it when it is forbidden', async function () {
    const {hands} = make();
    const verdict = await hands.check('c1', {tool: 'appium_gesture', args: {action: 'tap', x: 1, y: 1}, active: 's1'});
    expect(verdict.ok).toBe(false);
    expect(verdict.text).toMatch(/Оплатити/);
  });

  it('asks the person past the limit of a turn, and starts the count again with the next turn', async function () {
    let answer = true;
    const {hands} = make({askMore: async () => answer});
    const tap = () => hands.check('c1', {tool: 'appium_gesture', args: {action: 'back'}, active: 's1'});
    expect((await tap()).ok).toBe(true);
    expect((await tap()).ok).toBe(true);
    // the person lets it go on
    expect((await tap()).ok).toBe(true);
    answer = false;
    hands.startTurn('c1');
    await tap();
    await tap();
    expect((await tap()).ok).toBe(false);
    // reading is not an action
    expect((await hands.check('c1', {tool: 'appium_find_element', args: {}, active: 's1'})).ok).toBe(true);
  });

  it('does nothing more after Stop until the next turn', async function () {
    const {hands} = make();
    hands.stop('c1');
    expect((await hands.check('c1', {tool: 'appium_gesture', args: {action: 'back'}, active: 's1'})).text).toMatch(
      /Stop/,
    );
    hands.startTurn('c1');
    expect((await hands.check('c1', {tool: 'appium_gesture', args: {action: 'back'}, active: 's1'})).ok).toBe(true);
  });

  it('gives no server before appium-mcp is installed', async function () {
    const {hands} = make();
    expect(await hands.server('c1', {port: 1, token: 't'})).toBeNull();
    expect((await hands.status()).installed).toBe(false);
  });
});

describe('the plugin in the hands process', function () {
  const ctx = (toolName, args, driver = null, active = 's1') => ({
    toolName,
    args,
    session: {getDriver: () => driver, getSessionId: () => active},
  });

  it('reads the element, asks the station, and never sends the typed text', async function () {
    const posted = [];
    const plugin = createStationPlugin({
      post: async (op, body) => {
        posted.push([op, body]);
        return op === 'check' ? {ok: true} : {text: 'Typed.\nScreen now: Login.'};
      },
    });
    const driver = {
      getElementAttribute: async (id, name) =>
        ({'resource-id': 'com.bank:id/amount', class: 'android.widget.EditText'})[name] ?? null,
    };
    const call = ctx('appium_set_value', {elementUUID: 'e1', text: '100'}, driver);
    expect(await plugin.beforeCall(call)).toBeUndefined();
    const [, check] = posted[0];
    expect(check.args).toEqual({elementUUID: 'e1'});
    expect(check.element).toEqual(expect.objectContaining({resourceId: 'com.bank:id/amount', password: false}));
    const after = await plugin.afterCall(call, {
      isError: false,
      content: [{type: 'text', text: 'Set value 100 into e1'}],
    });
    expect(after.content).toEqual([{type: 'text', text: 'Typed.\nScreen now: Login.'}]);
    expect(JSON.stringify(posted)).not.toContain('100"');
  });

  it('refuses what the station refuses, and refuses when the station does not answer', async function () {
    const refused = createStationPlugin({post: async () => ({ok: false, text: 'Attach first'})});
    expect(await refused.beforeCall(ctx('appium_gesture', {action: 'back'}))).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Attach first'}],
    });
    const gone = createStationPlugin({
      post: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect((await gone.beforeCall(ctx('appium_gesture', {action: 'back'}))).content[0].text).toMatch(/did not answer/);
  });
});

describe('the station server for the plugin', function () {
  it('takes the plugin only with the token, by conversation', async function () {
    const seen = [];
    const mcp = createStationMcp({
      tools: [],
      hands: {check: async (conversation, body) => (seen.push([conversation, body.tool]), {ok: true})},
    });
    const {port, token} = await mcp.start();
    const url = `http://127.0.0.1:${port}/hands/c%201/check`;
    const body = JSON.stringify({tool: 'appium_gesture'});
    expect((await fetch(url, {method: 'POST', body})).status).toBe(401);
    const response = await fetch(url, {method: 'POST', body, headers: {authorization: `Bearer ${token}`}});
    expect(await response.json()).toEqual({ok: true});
    expect(seen).toEqual([['c 1', 'appium_gesture']]);
    expect(
      (
        await fetch(`http://127.0.0.1:${port}/hands/c1/constructor`, {
          method: 'POST',
          body,
          headers: {authorization: `Bearer ${token}`},
        })
      ).status,
    ).toBe(404);
    await mcp.stop();
  });
});

describe('the permission cards of the hands', function () {
  const request = (serverName, toolName, args) => ({
    options: [
      {optionId: 'yes', kind: 'allow_once'},
      {optionId: 'no', kind: 'reject_once'},
    ],
    toolCall: {rawInput: {arguments: args}},
    _meta: {kiro: {consent: {capability: 'mcp'}, mcpTool: {identity: {serverName, toolName}}}},
  });
  const station = {
    readTools: new Set(),
    handsGroups: new Map([['app_login', 'app']]),
    permissions: DEFAULT_PERMISSIONS,
  };

  it('follows the project: allowed goes, asked is the person, denied is refused', function () {
    expect(decidePermission(request('hands', 'appium_gesture', {action: 'tap'}), station)).toMatchObject({
      action: 'allow',
    });
    expect(decidePermission(request('hands', 'appium_app_lifecycle', {action: 'install'}), station)).toEqual({
      action: 'ask',
    });
    expect(
      decidePermission(request('hands', 'appium_gesture', {action: 'tap'}), {
        ...station,
        permissions: {...DEFAULT_PERMISSIONS, act: 'deny'},
      }),
    ).toMatchObject({action: 'reject'});
    expect(decidePermission(request('station', 'app_login', {account: 'basic'}), station)).toMatchObject({
      action: 'allow',
    });
  });
});

describe('what the agent reads through the hands', function () {
  it('hides personal data, and puts what it reads through the read budget of the turn', async function () {
    const hands = createHands({
      dir: '/nowhere/hands',
      node: 'node',
      npm: async () => true,
      ask: async () => null,
      playbook: async () => ({}),
      builds: async () => [],
    });
    const read = await hands.done('c1', {tool: 'appium_get_text', args: {}, text: 'Mail: anna@bank.ua'});
    expect(read.read).toBe(true);
    expect(read.text).not.toContain('anna@bank.ua');

    const mcp = createStationMcp({tools: [], hands: {done: async () => ({text: 'x'.repeat(30000), read: true})}});
    const {port, token} = await mcp.start();
    mcp.startTurn('c1', {limits: {read: 40000}});
    const post = async (selector) =>
      (
        await fetch(`http://127.0.0.1:${port}/hands/c1/done`, {
          method: 'POST',
          headers: {authorization: `Bearer ${token}`},
          body: JSON.stringify({tool: 'generate_locators', args: {query: selector}}),
        })
      ).json();
    expect((await post('a')).text).toMatch(/cut at 8000/);
    await post('b');
    await post('c');
    await post('d');
    expect((await post('e')).text).toMatch(/budget of this turn is used up/);
    await mcp.stop();
  });
});

describe('where the agent stands', function () {
  it('lists the goals with what is open first, in at most 1 500 characters', function () {
    const goals = [
      {id: 'g1', title: 'POST /transfers has purpose', expectOn: 'Transfer'},
      {id: 'g2', title: 'No 5xx on /limits'},
      {id: 'g3', title: 'Receipt screen'},
    ];
    const text = goalsStatus(goals, {g1: {state: 'passed', evidence: {label: 'request #41'}}, g2: {state: 'failed'}});
    expect(text.split('\n')).toEqual([
      'Goals: 1 failed, 1 pending, 1 passed.',
      '- [failed] No 5xx on /limits',
      '- [pending] Receipt screen',
      '- [passed] POST /transfers has purpose — on Transfer — request #41',
    ]);
    expect(goalsStatus([], {})).toMatch(/No goals/);
    expect(
      goalsStatus(
        Array.from({length: 100}, (_x, i) => ({id: `g${i}`, title: 'x'.repeat(40)})),
        {},
      ).length,
    ).toBe(1500);
  });

  it('says in plain words why an action failed and what to try', async function () {
    expect(failureHint('An element could not be located on the page')).toMatch(/not on the screen now/);
    expect(failureHint('invalid session id')).toMatch(/session is gone/);
    const hands = createHands({
      dir: '/nowhere/hands',
      node: 'node',
      npm: async () => true,
      ask: async () => null,
      playbook: async () => ({}),
      builds: async () => [],
    });
    const answer = await hands.done('c1', {
      tool: 'appium_gesture',
      args: {action: 'tap'},
      ok: false,
      text: 'stale element reference',
    });
    expect(answer.text).toMatch(/^Not done\. The screen changed since the element was found/);
  });
});

describe('joining the session', function () {
  it('joins the station session itself when the station says so, then asks again', async function () {
    let active = null;
    const checks = [];
    const plugin = createStationPlugin(
      {
        post: async (op, body) => {
          checks.push(body.active);
          return body.active === 's1'
            ? {ok: true}
            : {ok: false, attach: {serverUrl: 'http://127.0.0.1:4723', sessionId: 's1'}, text: 'no'};
        },
      },
      async ({sessionId}) => {
        active = sessionId;
        return true;
      },
    );
    const ctx = {
      toolName: 'appium_gesture',
      args: {action: 'back'},
      session: {getDriver: () => null, getSessionId: () => active},
    };
    expect(await plugin.beforeCall(ctx)).toBeUndefined();
    expect(checks).toEqual([null, 's1']);
  });
});

describe('the hands only on command', function () {
  const make = (installed = true) => {
    const loads = [];
    const sent = [];
    let sessions = {
      p1: {
        current: {_general: 'k1'},
        list: [{sessionId: 'k1', conversation: 'c1', key: '_general', updatedAt: '2026-10-28T00:00:00Z'}],
      },
    };
    const service = createAgentService({
      kiro: {
        on: () => {},
        loadSession: async (inputs) => (loads.push(inputs.mcpServers.map((server) => server.name)), {model: 'm'}),
        newSession: async () => ({sessionId: 'k1', model: 'm'}),
      },
      mcp: {start: async () => ({port: 1, token: 't'}), readTools: new Set()},
      credits: {},
      get: async (key) => (key === 'AGENT_SESSIONS' ? sessions : null),
      set: async (key, value) => {
        if (key === 'AGENT_SESSIONS') {
          sessions = value;
        }
      },
      workspace: async () => ({cwd: null, additionalDirectories: []}),
      secrets: async () => ({}),
      home: '/tmp/station-agent-test',
      send: (channel) => sent.push(channel),
      ask: async () => null,
      hands: {
        status: async () => ({installed}),
        server: async () => ({name: 'hands', command: 'node', args: [], env: []}),
      },
    });
    return {service, loads, sent, sessions: () => sessions};
  };

  it('opens a conversation without the hands, and loads the same one with them on command', async function () {
    const {service, loads, sessions} = make();
    const opened = await service.open({profileId: 'p1', replay: true});
    expect(opened.hands).toBe(false);
    expect(loads.at(-1)).toEqual(['station']);
    expect(await service.setHands({sessionId: 'k1', on: true})).toEqual({ok: true, hands: true});
    expect(loads.at(-1)).toEqual(['station', 'hands']);
    expect(sessions().p1.list[0].hands).toBe(true);
    expect(await service.setHands({sessionId: 'k1', on: false})).toEqual({ok: true, hands: false});
    expect(loads.at(-1)).toEqual(['station']);
  });

  it('asks to install the hands first', async function () {
    const {service} = make(false);
    await service.open({profileId: 'p1', replay: true});
    expect(await service.setHands({sessionId: 'k1', on: true})).toEqual({ok: false, error: 'handsMissing'});
  });
});
