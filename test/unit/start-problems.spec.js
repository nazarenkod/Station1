import {describe, expect, it} from 'vitest';

import {canStart, startProblems} from '../../app/common/shared/start-problems.js';

const pixel = {id: 'p', name: 'Pixel', platformName: 'Android'};
const iphone = {id: 'i', name: 'iPhone', platformName: 'iOS'};
const app = {id: 'com.bank.app', installed: true};

describe('what stands in the way of «Start session»', () => {
  it('asks for a device first, and for one that runs', () => {
    expect(startProblems({device: null, running: false, app})).toEqual([
      {key: 'noDevice', severity: 'error', target: 'device'},
    ]);
    expect(startProblems({device: pixel, running: false, app})[0]).toMatchObject({key: 'deviceOff', target: 'device'});
  });

  it('says what the project lacks for this device, with the field to fix it, as every tool does', () => {
    const advice = {kind: 'noPlatform', platform: 'ios', project: 'Bank', only: 'android', other: null};
    const fix = {section: 'profiles', focus: {field: 'app', platform: 'ios'}};
    const noPlatform = startProblems({device: iphone, running: true, app: null, advice, fix});
    expect(noPlatform).toEqual([{key: 'noPlatform', severity: 'warn', target: 'app', params: advice, fix}]);
    expect(canStart(noPlatform)).toBe(true);
    const noApp = {kind: 'noApp', platform: 'ios', section: 'multi', project: 'Bank'};
    expect(startProblems({device: iphone, running: true, app: null, advice: noApp, fix})[0]).toMatchObject({
      key: 'noAppFor',
      params: noApp,
    });
  });

  it('lets a session start without an app, but not with an app the device lacks', () => {
    const none = startProblems({device: pixel, running: true, app: null});
    expect(none).toEqual([{key: 'noApp', severity: 'warn', target: 'app'}]);
    expect(canStart(none)).toBe(true);
    const missing = startProblems({device: pixel, running: true, app: {...app, installed: false}});
    expect(missing[0]).toMatchObject({key: 'appMissing', severity: 'error', target: 'app'});
    expect(canStart(missing)).toBe(false);
  });

  it('points at the station when Appium or the platform’s driver is missing, unless a server already runs', () => {
    const report = {
      checks: [
        {id: 'appiumMissing', status: 'warn'},
        {id: 'driver', status: 'warn', params: {driver: 'xcuitest'}},
        {id: 'driver', status: 'ok', params: {driver: 'uiautomator2'}},
      ],
    };
    expect(startProblems({device: pixel, running: true, app, report}).map((p) => p.key)).toEqual(['appiumMissing']);
    expect(startProblems({device: iphone, running: true, app, report}).map((p) => p.key)).toEqual([
      'appiumMissing',
      'driver',
    ]);
    expect(startProblems({device: iphone, running: true, app, report, serverRunning: true})).toEqual([]);
  });

  it('needs adb for Android and Xcode for iOS', () => {
    const report = {
      checks: [
        {id: 'adb', status: 'error'},
        {id: 'xcode', status: 'ok'},
      ],
    };
    expect(startProblems({device: pixel, running: true, app, report}).map((p) => p.key)).toEqual(['adb']);
    expect(startProblems({device: iphone, running: true, app, report})).toEqual([]);
  });
});
