import path from 'node:path';

import {startServer} from '@appium/fake-driver';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {createHands} from '../../app/common/node/agent/hands.js';
import {createStationMcp} from '../../app/common/node/agent/station-mcp.js';

const HANDS = process.env.HANDS_DIR ?? '';
const PORT = 12131;
const SERVER = `http://127.0.0.1:${PORT}`;

// The hands for real: appium-mcp from HANDS_DIR (installed with `npm install --prefix <dir> appium-mcp@<version>`),
// the station's plugin and server, on a session of the Appium fake driver. Skipped without HANDS_DIR.
describe.skipIf(!process.env.HANDS_DIR)('the hands on a live Appium session', function () {
  let server, sessionId, mcp, client;
  const steps = [];
  const asked = [];
  let screenNow = 'Home';
  beforeAll(async function () {
    server = await startServer(PORT, '127.0.0.1');
    const created = await (
      await fetch(`${SERVER}/session`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          capabilities: {
            alwaysMatch: {
              platformName: 'Fake',
              'appium:automationName': 'Fake',
              'appium:deviceName': 'Fake',
              'appium:app': path.resolve(__dirname, '..', 'fixtures', 'fake-app.xml'),
            },
          },
        }),
      })
    ).json();
    sessionId = created.value?.sessionId ?? created.sessionId;
    const hands = createHands({
      dir: HANDS,
      // HANDS_NODE: the Electron binary, to run the hands as the station does
      node: process.env.HANDS_NODE ?? process.execPath,
      npm: async () => true,
      ask: async (kind) => {
        asked.push(kind);
        if (kind === 'session') {
          return {serverUrl: SERVER, sessionId, platform: 'android', appId: 'com.bank', screen: {title: screenNow}};
        }
        if (kind === 'handsStep') {
          return {screen: {title: 'Next'}};
        }
        return null;
      },
      playbook: async () => ({forbidden: [{kind: 'screen', value: 'Danger', why: 'test'}]}),
      builds: async () => [],
      onStep: (c, step) => steps.push(step.line),
    });
    mcp = createStationMcp({tools: [], hands: {check: hands.check, done: hands.done}});
    const {port, token} = await mcp.start();
    const def = await hands.server('conv1', {port, token});
    if (!def) {
      throw new Error(`appium-mcp is not installed in ${HANDS}`);
    }
    const env = Object.fromEntries(def.env.map(({name, value}) => [name, value]));
    client = new Client({name: 'kiro-like', version: '1'});
    await client.connect(
      new StdioClientTransport({command: def.command, args: def.args, env: {...process.env, ...env}, stderr: 'pipe'}),
    );
  }, 120000);

  afterAll(async function () {
    await client?.close();
    await mcp?.stop();
    await fetch(`${SERVER}/session/${sessionId}`, {method: 'DELETE'}).catch(() => null);
    await server?.close();
  });

  const call = async (name, args) => {
    const result = await client.callTool({name, arguments: args});
    return {error: !!result.isError, text: result.content.map((part) => part.text).join('\n')};
  };

  it('shows only the allowed tools', async function () {
    const {tools} = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).not.toContain('select_device');
    expect(names).toContain('appium_gesture');
  });

  it('asks to attach, attaches, taps, refuses what is forbidden and leaves the session alive', async function () {
    const before = await call('appium_gesture', {action: 'back'});
    expect(before.text).toContain(`sessionId=${sessionId}`);
    const bad = await call('appium_session_management', {action: 'create', platform: 'android'});
    expect(bad.error).toBe(true);
    const attach = await call('appium_session_management', {action: 'attach', remoteServerUrl: SERVER, sessionId});
    expect(attach.error).toBe(false);
    const found = await call('appium_find_element', {strategy: 'id', selector: 'input'});
    const id = /elementId '?([\w-]+)'?/.exec(found.text)?.[1] ?? /([0-9a-f-]{6,})/.exec(found.text)?.[1];
    screenNow = 'Danger';
    const forbidden = await call('appium_gesture', {action: 'tap', elementUUID: id});
    screenNow = 'Home';
    expect(forbidden.text).toMatch(/forbids/);
    const ok2 = await call('appium_find_element', {strategy: 'id', selector: 'Button2'});
    const id2 = /elementId '?([\w-]+)'?/.exec(ok2.text)?.[1];
    const tap = await call('appium_gesture', {action: 'tap', elementUUID: id2});
    expect(tap.text).toMatch(/Screen now: Next/);
    const whole = await call('appium_get_page_source', {});
    expect(whole.error).toBe(true);
    await client.close();
    client = null;
    const alive = await (await fetch(`${SERVER}/session/${sessionId}/source`)).json();
    expect(typeof alive.value).toBe('string');
  });
});
