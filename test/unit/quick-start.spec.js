import {describe, expect, it, vi} from 'vitest';

vi.mock('../../app/common/renderer/polyfills.js', () => ({backend: {}, getSetting: vi.fn(), setSetting: vi.fn()}));

const {quickCapabilities} = await import('../../app/common/renderer/components/SessionBuilder/QuickStart.jsx');

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
