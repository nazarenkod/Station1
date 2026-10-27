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

const emulator = {id: 'emulator-5554', kind: 'android-emulator', state: 'running', name: 'sdk gphone64 arm64'};

const privatIos = {id: 'ua.pb.privat24', name: 'Privat24'};
const privatAndroid = {id: 'ua.privatbank.ap24', name: 'Privat24'};
const androidApps = [{id: 'ua.privatbank.ap24'}, {id: 'com.android.settings'}];

const project = [privatIos.id, privatAndroid.id];

describe('the app from the project', function () {
  it('takes the project app the device has, not one of another platform', function () {
    expect(appForProject({projectApps: project, installed: androidApps, current: privatIos})).toBe(privatAndroid.id);
  });

  it('keeps the current project app when the device has it', function () {
    const both = [{id: privatIos.id}, ...androidApps];
    expect(appForProject({projectApps: project, installed: both, current: privatIos})).toBe(privatIos.id);
  });

  it('drops an app that is not in the project', function () {
    const settings = {id: 'com.android.settings'};
    expect(appForProject({projectApps: project, installed: androidApps, current: settings})).toBe(privatAndroid.id);
  });

  it('keeps a project app the device does not have yet, to install it', function () {
    expect(appForProject({projectApps: ['com.example.new'], installed: androidApps, current: null})).toBe(
      'com.example.new',
    );
  });

  it('keeps the current project app while the apps of the device are unknown', function () {
    expect(appForProject({projectApps: project, installed: null, current: privatAndroid})).toBe(privatAndroid.id);
  });

  it('is none when the project has no apps', function () {
    expect(appForProject({projectApps: [], installed: androidApps, current: privatAndroid})).toBeNull();
  });
});

describe('the app after the apps of the device are read', function () {
  const setUp = (patch) => {
    backend.device = {
      apps: vi.fn(async () => ({apps: androidApps, error: null})),
      appVersion: vi.fn(async (_device, id) => (androidApps.some((a) => a.id === id) ? {version: '7.15.01'} : null)),
    };
    return storeWith({devices: [emulator], deviceId: emulator.id, projectApps: project, ...patch});
  };

  it('replaces an app the device does not have with the project app it has', async function () {
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

  it('keeps the app when the list of apps cannot be read', async function () {
    const store = setUp({app: privatIos});
    backend.device.apps = vi.fn(async () => ({apps: [], error: {reason: 'failed'}}));
    await store.dispatch(refreshApps());
    expect(store.getState().workstation.app.id).toBe('ua.pb.privat24');
  });

  it('picks the app again when the project changes', async function () {
    const store = setUp({app: privatAndroid});
    await store.dispatch(refreshApps());
    await store.dispatch(setProjectApps(['com.android.settings']));
    expect(store.getState().workstation.app).toMatchObject({id: 'com.android.settings', installed: true});
    await store.dispatch(setProjectApps([]));
    expect(store.getState().workstation.app).toBeNull();
  });
});
