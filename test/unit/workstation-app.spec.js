import {describe, expect, it, vi} from 'vitest';

vi.mock('../../app/common/renderer/polyfills.js', () => ({backend: {}, getSetting: vi.fn(), setSetting: vi.fn()}));

const {appForDevice} = await import('../../app/common/renderer/actions/Workstation.js');

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
