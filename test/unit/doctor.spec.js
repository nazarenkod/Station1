import {describe, expect, it} from 'vitest';

import {
  capabilitiesFor,
  DEVICE_KIND,
  parseAdbDevices,
  parseAvdList,
  parseDevicectlDevices,
  parseSimctlDevices,
  parseSimRuntime,
} from '../../app/common/node/doctor/devices.js';
import {
  defaultAndroidSdkPaths,
  isAppiumNodeSupported,
  parseDriverDoctor,
  parseInstalledDrivers,
  parseVersion,
} from '../../app/common/node/doctor/environment.js';
import {androidToolDirs, parseEnvOutput} from '../../app/common/node/doctor/exec.js';

describe('doctor: devices', function () {
  it('parses adb devices with states and models', function () {
    const output = [
      '* daemon not running; starting now at tcp:5037',
      'List of devices attached',
      'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1',
      'R58M1234ABC            unauthorized usb:1-1 transport_id:2',
      '',
    ].join('\n');
    expect(parseAdbDevices(output)).toEqual([
      {serial: 'emulator-5554', state: 'device', model: 'sdk gphone64 arm64'},
      {serial: 'R58M1234ABC', state: 'unauthorized', model: ''},
    ]);
  });

  it('skips emulator log lines in the AVD list', function () {
    expect(parseAvdList('INFO    | Storing crashdata\nPixel_6_API_31\nPixel_XL_API_33\n')).toEqual([
      'Pixel_6_API_31',
      'Pixel_XL_API_33',
    ]);
  });

  it('reads the platform and version of a simulator runtime', function () {
    expect(parseSimRuntime('com.apple.CoreSimulator.SimRuntime.iOS-17-0')).toEqual({platform: 'iOS', version: '17.0'});
    expect(parseSimRuntime('com.apple.CoreSimulator.SimRuntime.iOS-17-0-1')).toEqual({
      platform: 'iOS',
      version: '17.0.1',
    });
  });

  it('lists available iOS simulators only', function () {
    const json = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.watchOS-8-5': [{udid: 'W', name: 'Watch', state: 'Shutdown'}],
        'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
          {udid: 'A', name: 'iPhone 15', state: 'Booted', isAvailable: true},
          {udid: 'B', name: 'iPhone SE (3rd generation)', state: 'Shutdown', isAvailable: true},
          {udid: 'C', name: 'Broken', state: 'Shutdown', isAvailable: false},
        ],
      },
    };
    expect(parseSimctlDevices(json)).toEqual([
      {
        kind: DEVICE_KIND.IOS_SIMULATOR,
        id: 'A',
        name: 'iPhone 15',
        platformName: 'iOS',
        platformVersion: '17.0',
        state: 'running',
      },
      {
        kind: DEVICE_KIND.IOS_SIMULATOR,
        id: 'B',
        name: 'iPhone SE (3rd generation)',
        platformName: 'iOS',
        platformVersion: '17.0',
        state: 'stopped',
      },
    ]);
  });

  it('lists physical iOS devices and leaves out watches', function () {
    const json = {
      result: {
        devices: [
          {
            connectionProperties: {tunnelState: 'unavailable'},
            deviceProperties: {name: 'Watch', osVersionNumber: '10.3.1'},
            hardwareProperties: {platform: 'watchOS', udid: 'W1'},
          },
          {
            connectionProperties: {tunnelState: 'connected'},
            deviceProperties: {name: 'QA iPhone', osVersionNumber: '17.4', developerModeStatus: 'enabled'},
            hardwareProperties: {platform: 'iOS', udid: '00008120-000428E43A60C01E', marketingName: 'iPhone 14 Pro'},
          },
        ],
      },
    };
    expect(parseDevicectlDevices(json)).toEqual([
      {
        kind: DEVICE_KIND.IOS_DEVICE,
        id: '00008120-000428E43A60C01E',
        name: 'QA iPhone',
        platformName: 'iOS',
        platformVersion: '17.4',
        state: 'running',
        developerMode: true,
      },
    ]);
  });

  it('builds capabilities for a connected device and for a stopped AVD', function () {
    expect(
      capabilitiesFor({
        kind: DEVICE_KIND.ANDROID_EMULATOR,
        id: 'emulator-5554',
        name: 'Pixel 6',
        platformName: 'Android',
        platformVersion: '12',
      }),
    ).toEqual({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Pixel 6',
      'appium:udid': 'emulator-5554',
      'appium:platformVersion': '12',
    });
    expect(
      capabilitiesFor({
        kind: DEVICE_KIND.ANDROID_AVD,
        id: 'Pixel_6_API_31',
        avdName: 'Pixel_6_API_31',
        name: 'Pixel 6 API 31',
        platformName: 'Android',
        platformVersion: '',
      }),
    ).toEqual({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Pixel 6 API 31',
      'appium:avd': 'Pixel_6_API_31',
    });
  });
});

describe('doctor: environment', function () {
  it('parses versions with pre-release tags', function () {
    expect(parseVersion('2.0.0-beta.65')).toMatchObject({major: 2, minor: 0, patch: 0, pre: '-beta.65'});
    expect(parseVersion('v22.12.0\n')).toMatchObject({major: 22, minor: 12, pre: ''});
    expect(parseVersion('openjdk version "17.0.2" 2022-01-18')).toMatchObject({major: 17, minor: 0, patch: 2});
    expect(parseVersion('nothing here')).toBeNull();
  });

  it('reads installed drivers past the warnings printed before the JSON', function () {
    const output = [
      '(node:96797) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.',
      JSON.stringify({
        uiautomator2: {version: '2.17.0', automationName: 'UiAutomator2', installed: true},
        espresso: {version: '3.0.0', installed: false},
      }),
    ].join('\n');
    expect(parseInstalledDrivers(output)).toEqual({uiautomator2: {version: '2.17.0', automationName: 'UiAutomator2'}});
    expect(parseInstalledDrivers('garbage')).toEqual({});
  });

  it('turns driver doctor output into statuses', function () {
    const output = [
      'info Doctor ### Starting doctor checks for uiautomator2 ###',
      'info Doctor   ✔ ANDROID_HOME is set to: /sdk',
      'WARN Doctor   ✖ JAVA_HOME environment variable is NOT set!',
      'WARN Doctor   ✖ bundletool.jar cannot be found (optional)',
    ].join('\n');
    expect(parseDriverDoctor(output)).toEqual([
      {status: 'ok', text: '✔ ANDROID_HOME is set to: /sdk'},
      {status: 'warn', text: '✖ JAVA_HOME environment variable is NOT set!'},
      {status: 'warn', text: '✖ bundletool.jar cannot be found (optional)'},
    ]);
    expect(parseDriverDoctor('  ✖ Xcode is NOT installed').map((item) => item.status)).toEqual(['error']);
  });

  it('accepts only the Node.js versions Appium 3 supports', function () {
    const supported = ['20.19.0', '22.12.0', '24.0.0', '25.1.0'].map((v) => isAppiumNodeSupported(parseVersion(v)));
    const unsupported = ['18.6.0', '20.18.1', '22.11.0', '23.3.0'].map((v) => isAppiumNodeSupported(parseVersion(v)));
    expect(supported).toEqual([true, true, true, true]);
    expect(unsupported).toEqual([false, false, false, false]);
  });

  it('knows where Android Studio puts the SDK', function () {
    expect(defaultAndroidSdkPaths('darwin', '/Users/qa')).toEqual(['/Users/qa/Library/Android/sdk']);
    expect(defaultAndroidSdkPaths('linux', '/home/qa')).toEqual(['/home/qa/Android/Sdk']);
  });
});

describe('doctor: shell environment', function () {
  it('reads env -0 output after the marker, ignoring shell noise', function () {
    const output = 'Welcome!\n__VISION_ENV_START__PATH=/usr/bin:/opt/homebrew/bin\0ANDROID_HOME=/sdk\0MULTI=a\nb\0';
    expect(parseEnvOutput(output)).toEqual({PATH: '/usr/bin:/opt/homebrew/bin', ANDROID_HOME: '/sdk', MULTI: 'a\nb'});
  });

  it('adds the Android SDK tool folders', function () {
    expect(androidToolDirs({ANDROID_SDK_ROOT: '/sdk'})).toEqual(['/sdk/platform-tools', '/sdk/emulator']);
    expect(androidToolDirs({})).toEqual([]);
  });
});
