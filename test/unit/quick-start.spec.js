import {describe, expect, it, vi} from 'vitest';

vi.mock('../../app/common/renderer/actions/SessionBuilder.js', () => ({
  applyLocalServer: () => async () => {},
  newSession: () => async () => true,
  showError: () => {},
}));

vi.mock('../../app/common/renderer/polyfills.js', () => ({
  backend: {},
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  localesPath: '',
}));

const {endSessionsOnDevice, quickCapabilities} =
  await import('../../app/common/renderer/components/SessionBuilder/QuickStart.jsx');

const {liveSessionChoice, sessionsOnDevice, startQuickSession} =
  await import('../../app/common/renderer/lib/session/quick-session.js');

const emulator = {platformName: 'Android', capabilities: {platformName: 'Android', 'appium:udid': 'emulator-5554'}};
const simulator = {platformName: 'iOS', capabilities: {platformName: 'iOS', 'appium:udid': 'ABC'}};

describe('quick start capabilities', function () {
  it('waits for any activity of an Android app, which may start through an alias', function () {
    const caps = quickCapabilities(emulator, {id: 'ua.privatbank.ap24'}, {keepData: true});
    expect(caps).toMatchObject({
      'appium:appPackage': 'ua.privatbank.ap24',
      'appium:appWaitActivity': '*',
      'appium:noReset': true,
    });
  });

  it('keeps an activity the device capabilities already name, and leaves iOS alone', function () {
    const named = {...emulator, capabilities: {...emulator.capabilities, 'appium:appWaitActivity': '.Main'}};
    expect(quickCapabilities(named, {id: 'a.b'}, {keepData: false})['appium:appWaitActivity']).toBe('.Main');
    const ios = quickCapabilities(simulator, {id: 'ua.pb.privat24'}, {keepData: true});
    expect(ios['appium:bundleId']).toBe('ua.pb.privat24');
    expect(ios).not.toHaveProperty('appium:appWaitActivity');
  });

  it('starts without an app on the screen as it is', function () {
    expect(quickCapabilities(emulator, null, {keepData: true})).not.toHaveProperty('appium:appWaitActivity');
  });
});

describe('quick start on a real iPhone', function () {
  const phone = {platformName: 'iOS', kind: 'ios-device', capabilities: {platformName: 'iOS', 'appium:udid': 'X'}};

  it('signs WebDriverAgent with what was found, unless the device says otherwise', function () {
    const signing = {'appium:xcodeOrgId': 'TEAM123456', 'appium:showXcodeLog': true};
    expect(quickCapabilities(phone, null, {keepData: true, signing})).toMatchObject(signing);
    const own = {...phone, capabilities: {...phone.capabilities, 'appium:xcodeOrgId': 'OWN'}};
    expect(quickCapabilities(own, null, {keepData: true, signing})['appium:xcodeOrgId']).toBe('OWN');
  });
});

describe('sessions left on the device', function () {
  it('ends ours on this device only, and lets a server that does not answer be', async function () {
    const calls = [];
    vi.stubGlobal('fetch', async (url, options = {}) => {
      calls.push(`${options.method ?? 'GET'} ${url}`);
      return {
        json: async () => ({
          value: [
            {id: 'old', capabilities: {udid: 'SIM-1'}},
            {id: 'other', capabilities: {udid: 'SIM-2'}},
          ],
        }),
      };
    });
    expect(await endSessionsOnDevice(4723, 'SIM-1')).toBe(1);
    expect(calls).toEqual(['GET http://127.0.0.1:4723/appium/sessions', 'DELETE http://127.0.0.1:4723/session/old']);

    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await endSessionsOnDevice(4723, 'SIM-1')).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe('a session already live on the device', function () {
  it('lists the sessions of this device with the app each was started for', async function () {
    vi.stubGlobal('fetch', async () => ({
      json: async () => ({
        value: [
          {id: 'a', capabilities: {udid: 'SIM-1', bundleId: 'com.bank'}},
          {id: 'b', capabilities: {'appium:udid': 'SIM-1', 'appium:appPackage': 'com.bank.android'}},
          {id: 'c', capabilities: {udid: 'SIM-2', bundleId: 'com.bank'}},
        ],
      }),
    }));
    expect(await sessionsOnDevice(4723, 'SIM-1')).toEqual([
      {id: 'a', app: 'com.bank'},
      {id: 'b', app: 'com.bank.android'},
    ]);
    vi.unstubAllGlobals();
  });

  it('joins the one of the same app and asks about one of another', function () {
    const sessions = [
      {id: 'x', app: 'com.other'},
      {id: 'y', app: 'com.bank'},
    ];
    expect(liveSessionChoice([], 'com.bank')).toBeNull();
    expect(liveSessionChoice(sessions, 'com.bank')).toEqual({kind: 'same', session: sessions[1]});
    expect(liveSessionChoice(sessions, 'com.third')).toEqual({kind: 'other', session: sessions[0]});
    expect(liveSessionChoice([{id: 'z', app: null}], null)).toEqual({kind: 'same', session: {id: 'z', app: null}});
  });

  const device = {
    name: 'iPhone',
    kind: 'ios-simulator',
    platformName: 'iOS',
    capabilities: {platformName: 'iOS', 'appium:udid': 'SIM-1'},
  };
  const appium = {status: 'running', port: 4723};
  const listing = (value) => {
    const calls = [];
    vi.stubGlobal('fetch', async (url, options = {}) => {
      calls.push(`${options.method ?? 'GET'} ${url}`);
      return {json: async () => ({value})};
    });
    return calls;
  };
  const run = async (decision) => {
    const opened = [];
    const result = await startQuickSession({
      dispatch: async () => {},
      device,
      app: {id: 'com.bank'},
      appium,
      open: async (caps, attachTo = null) => opened.push(attachTo ?? 'new'),
      decide: async () => decision,
    });
    return {result, opened};
  };

  it('joins a session of the same app instead of starting one, and ends nothing', async function () {
    const calls = listing([{id: 'live', capabilities: {udid: 'SIM-1', bundleId: 'com.bank'}}]);
    const {result, opened} = await run('new');
    expect(result).toEqual({attached: true});
    expect(opened).toEqual(['live']);
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('joins one of another app when told so, else ends it on our server and starts anew', async function () {
    listing([{id: 'other', capabilities: {udid: 'SIM-1', bundleId: 'com.other'}}]);
    expect((await run('attach')).opened).toEqual(['other']);
    const calls = listing([{id: 'other', capabilities: {udid: 'SIM-1', bundleId: 'com.other'}}]);
    const {result, opened} = await run('new');
    expect(result).toEqual({});
    expect(opened).toEqual(['new']);
    expect(calls).toContain('DELETE http://127.0.0.1:4723/session/other');
    vi.unstubAllGlobals();
  });
});

describe('closing the Inspector on a joined session', function () {
  it('leaves the session running and remembers that it was joined until then', async function () {
    const {quitSession, setSessionDetails} = await import('../../app/common/renderer/actions/SessionInspector.js');
    const {default: inspector} = await import('../../app/common/renderer/reducers/SessionInspector.js');
    let state = inspector(undefined, {type: '@@init'});
    const details = setSessionDetails({driver: {capabilities: {}}, attached: true});
    details((action) => (state = inspector(state, action)));
    expect(state.attached).toBe(true);

    const types = [];
    const dispatch = (action) => (typeof action === 'function' ? action(dispatch, getState) : types.push(action.type));
    const getState = () => ({inspector: state});
    await quitSession()(dispatch, getState);
    expect(types).not.toContain('METHOD_CALL_REQUESTED');
    expect(types).toContain('QUIT_SESSION_DONE');
  });
});
