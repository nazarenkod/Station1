import {describe, expect, it, vi} from 'vitest';

const backend = {};
vi.mock('../../app/common/renderer/polyfills.js', () => ({backend, getSetting: vi.fn(), setSetting: vi.fn()}));

const {appForProject, refreshApps, setProjectApps} = await import('../../app/common/renderer/actions/Workstation.js');
const {default: workstation} = await import('../../app/common/renderer/reducers/Workstation.js');

// just enough of a Redux store to run the workstation's thunks
function storeWith(patch) {
  let state = {workstation: {...workstation(undefined, {type: 'init'}), ...patch}};
  const getState = () => state;
  const dispatch = (action) =>
    typeof action === 'function'
      ? action(dispatch, getState)
      : (state = {workstation: workstation(state.workstation, action)});
  return {dispatch, getState};
}

const emulator = {
  id: 'emulator-5554',
  kind: 'android-emulator',
  state: 'running',
  name: 'Pixel 7 API 34',
  platformName: 'Android',
};
const iphone = {id: 'A1B2', kind: 'ios-device', state: 'running', name: 'iPhone 15', platformName: 'iOS'};

const privatIos = {id: 'ua.pb.privat24', name: 'Privat24'};
const privatAndroid = {id: 'ua.privatbank.ap24', name: 'Privat24'};
const androidApps = [{id: 'ua.privatbank.ap24'}, {id: 'com.android.settings'}];

const project = [
  {id: privatIos.id, platform: 'ios'},
  {id: privatAndroid.id, platform: 'android'},
];

describe('the app from the project', function () {
  it('takes the app for the platform of the device', function () {
    expect(appForProject({projectApps: project, platform: 'android', installed: androidApps, current: privatIos})).toBe(
      privatAndroid.id,
    );
  });

  it('never takes the app of the other platform, even when nothing is installed', function () {
    expect(appForProject({projectApps: project, platform: 'android', installed: [], current: privatIos})).toBe(
      privatAndroid.id,
    );
    expect(appForProject({projectApps: project, platform: 'ios', installed: null, current: privatAndroid})).toBe(
      privatIos.id,
    );
  });

  it('drops an app that is not in the project', function () {
    const settings = {id: 'com.android.settings'};
    expect(appForProject({projectApps: project, platform: 'android', installed: androidApps, current: settings})).toBe(
      privatAndroid.id,
    );
  });

  it('keeps the project app the device does not have yet, to install it', function () {
    const fresh = [{id: 'com.example.new', platform: 'android'}];
    expect(appForProject({projectApps: fresh, platform: 'android', installed: androidApps, current: null})).toBe(
      'com.example.new',
    );
  });

  it('keeps the current project app while the apps of the device are unknown', function () {
    expect(appForProject({projectApps: project, platform: 'android', installed: null, current: privatAndroid})).toBe(
      privatAndroid.id,
    );
  });

  it('lets an old app without a platform fit either', function () {
    const old = [{id: 'ua.acme.bank', platform: null}];
    expect(appForProject({projectApps: old, platform: 'ios', installed: null, current: null})).toBe('ua.acme.bank');
    expect(appForProject({projectApps: old, platform: 'android', installed: null, current: null})).toBe('ua.acme.bank');
  });

  it('is none when the project has no app for the platform', function () {
    const iosOnly = [{id: privatIos.id, platform: 'ios'}];
    expect(
      appForProject({projectApps: iosOnly, platform: 'android', installed: androidApps, current: null}),
    ).toBeNull();
    expect(
      appForProject({projectApps: [], platform: 'android', installed: androidApps, current: privatAndroid}),
    ).toBeNull();
  });
});

describe('the app after the apps of the device are read', function () {
  const setUp = (patch) => {
    backend.device = {
      apps: vi.fn(async () => ({apps: androidApps, error: null})),
      appVersion: vi.fn(async (_device, id) => (androidApps.some((a) => a.id === id) ? {version: '7.15.01'} : null)),
    };
    return storeWith({devices: [emulator, iphone], deviceId: emulator.id, projectApps: project, ...patch});
  };

  it('replaces an app the device does not have with the project app for it', async function () {
    const store = setUp({app: privatIos});
    await store.dispatch(refreshApps());
    expect(store.getState().workstation.app).toMatchObject({id: 'ua.privatbank.ap24', installed: true});
  });

  it('keeps the app of a build just installed, though it is not in the project', async function () {
    const build = {id: 'com.android.settings', name: 'Settings'};
    const store = setUp({app: build});
    await store.dispatch(refreshApps());
    expect(store.getState().workstation.app.id).toBe('com.android.settings');
  });

  it('keeps an app outside the project when the list of apps cannot be read', async function () {
    const build = {id: 'com.example.build'};
    const store = setUp({app: build});
    backend.device.apps = vi.fn(async () => ({apps: [], error: {reason: 'failed'}}));
    await store.dispatch(refreshApps());
    expect(store.getState().workstation.app.id).toBe('com.example.build');
  });

  it('drops the Android app on an iPhone whose apps cannot be read', async function () {
    const store = setUp({app: privatAndroid, deviceId: iphone.id});
    backend.device.apps = vi.fn(async () => ({apps: [], error: {reason: 'xcodeTooOld'}}));
    backend.device.appVersion = vi.fn(async () => null);
    await store.dispatch(refreshApps());
    expect(store.getState().workstation.app.id).toBe('ua.pb.privat24');
  });

  it('picks the app again when the project changes', async function () {
    const store = setUp({app: privatAndroid});
    await store.dispatch(refreshApps());
    await store.dispatch(setProjectApps([{id: 'com.android.settings', platform: 'android'}]));
    expect(store.getState().workstation.app).toMatchObject({id: 'com.android.settings', installed: true});
    await store.dispatch(setProjectApps([]));
    expect(store.getState().workstation.app).toBeNull();
  });
});

describe('a device of a platform the project has not', function () {
  it('gets no app, even one installed from the last run (project.platforms)', function () {
    expect(
      appForProject({
        projectApps: [{id: privatAndroid.id, platform: 'android'}],
        platform: 'ios',
        installed: [{id: privatIos.id}],
        current: privatIos,
        platforms: ['android'],
      }),
    ).toBe(null);
    expect(
      appForProject({projectApps: project, platform: 'ios', installed: null, current: null, platforms: ['multi']}),
    ).toBe(privatIos.id);
  });
});
