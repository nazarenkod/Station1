import {describe, expect, it, vi} from 'vitest';

const backend = {};
vi.mock('../../app/common/renderer/polyfills.js', () => ({backend, getSetting: vi.fn(), setSetting: vi.fn()}));

const {appForDevice, refreshApps, selectApp} = await import('../../app/common/renderer/actions/Workstation.js');
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

describe('the app on a device just picked', function () {
  it('takes the app last used on that device', function () {
    expect(appForDevice({installed: androidApps, remembered: privatAndroid, current: privatIos, recentApps: []})).toBe(
      privatAndroid,
    );
  });

  it('keeps the current app when the device has it', function () {
    const settings = {id: 'com.android.settings'};
    expect(appForDevice({installed: androidApps, current: settings, recentApps: []})).toBe(settings);
  });

  it('drops an app of another device for the most recent one installed there', function () {
    expect(appForDevice({installed: androidApps, current: privatIos, recentApps: [privatIos, privatAndroid]})).toBe(
      privatAndroid,
    );
  });

  it('falls back to the app on screen, but not the home screen, else none', function () {
    expect(
      appForDevice({installed: androidApps, current: privatIos, recentApps: [], onScreen: 'com.android.settings'}),
    ).toEqual({id: 'com.android.settings'});
    expect(
      appForDevice({
        installed: androidApps,
        current: privatIos,
        recentApps: [],
        onScreen: 'com.google.android.apps.nexuslauncher',
      }),
    ).toBeNull();
  });
});

describe('the app after the apps of the device are read', function () {
  const setUp = (patch) => {
    backend.device = {
      apps: vi.fn(async () => ({apps: androidApps, error: null})),
      foreground: vi.fn(async () => 'com.google.android.apps.nexuslauncher'),
      appVersion: vi.fn(async (_device, id) => (androidApps.some((a) => a.id === id) ? {version: '7.15.01'} : null)),
    };
    return storeWith({devices: [emulator], deviceId: emulator.id, ...patch});
  };

  it('replaces an app the device does not have, left from the last run, with a recent one it has', async function () {
    const store = setUp({app: privatIos, recentApps: [privatIos, privatAndroid]});
    await store.dispatch(refreshApps());
    expect(store.getState().workstation.app).toMatchObject({id: 'ua.privatbank.ap24', installed: true});
    expect(store.getState().workstation.appByDevice[emulator.id].id).toBe('ua.privatbank.ap24');
  });

  it('keeps an app picked for this device even when it is not installed yet', async function () {
    const store = setUp({recentApps: []});
    await store.dispatch(selectApp('com.example.new'));
    await store.dispatch(refreshApps());
    expect(store.getState().workstation.app).toMatchObject({id: 'com.example.new', installed: false});
  });

  it('keeps the app when the list of apps cannot be read', async function () {
    const store = setUp({app: privatIos, recentApps: []});
    backend.device.apps = vi.fn(async () => ({apps: [], error: {reason: 'failed'}}));
    await store.dispatch(refreshApps());
    expect(store.getState().workstation.app.id).toBe('ua.pb.privat24');
  });
});
