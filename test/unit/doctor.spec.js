import {describe, expect, it} from 'vitest';

import {appiumArgs} from '../../app/common/node/doctor/appium-server.js';
import {
  androidDeviceName,
  capabilitiesFor,
  DEVICE_KIND,
  parseAdbDevices,
  parseAvdList,
  parseIni,
  parseDevicectlDevices,
  sortDevices,
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
import {androidToolDirs, parseEnvOutput, run} from '../../app/common/node/doctor/exec.js';

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

  it('names Android devices the way people know them', function () {
    const emulator = {serial: 'emulator-5554', model: 'sdk gphone64 arm64'};
    expect(androidDeviceName({...emulator, avdName: 'Pixel_7_API_34'})).toBe('Pixel 7 API 34');
    expect(androidDeviceName(emulator)).toBe('sdk gphone64 arm64');
    expect(androidDeviceName({serial: 'R58M', model: 'SM-G991B', manufacturer: 'samsung'})).toBe('Samsung SM-G991B');
    expect(androidDeviceName({serial: 'R58M', model: 'Pixel 7', manufacturer: 'Google'})).toBe('Google Pixel 7');
    expect(androidDeviceName({serial: 'R58M', model: 'Redmi Note 12', manufacturer: 'Redmi'})).toBe('Redmi Note 12');
    expect(androidDeviceName({serial: 'R58M', model: '2209116AG', marketName: 'Redmi Note 12'})).toBe('Redmi Note 12');
    expect(androidDeviceName({serial: 'R58M'})).toBe('R58M');
  });

  it('reads the emulator ini files', function () {
    expect(
      parseIni(
        'avd.ini.encoding=UTF-8\npath=/Users/qa/.android/avd/Pixel.avd\n# comment\nimage.sysdir.1 = system-images/android-33/google_apis/arm64-v8a/\n',
      ),
    ).toEqual({
      'avd.ini.encoding': 'UTF-8',
      path: '/Users/qa/.android/avd/Pixel.avd',
      'image.sysdir.1': 'system-images/android-33/google_apis/arm64-v8a/',
    });
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
            connectionProperties: {tunnelState: 'connected', transportType: 'wired'},
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

  it('sees a phone on the cable while its CoreDevice tunnel is idle, not one only on the Wi-Fi or gone', function () {
    const phone = (connectionProperties) => ({
      connectionProperties,
      deviceProperties: {name: 'iPhone 17 Pro', osVersionNumber: '27.0'},
      hardwareProperties: {platform: 'iOS', udid: '00008150-000E29361AB8401C'},
    });
    const states = parseDevicectlDevices({
      result: {
        devices: [
          phone({tunnelState: 'disconnected', transportType: 'wired', pairingState: 'paired'}),
          phone({tunnelState: 'disconnected', transportType: 'localNetwork', pairingState: 'paired'}),
          phone({tunnelState: 'connected', transportType: 'localNetwork', pairingState: 'paired'}),
          phone({tunnelState: 'unavailable', pairingState: 'paired'}),
        ],
      },
    }).map((device) => device.state);
    expect(states).toEqual(['running', 'disconnected', 'running', 'disconnected']);
  });

  it('puts the devices that can be used now first, real phones before emulators', function () {
    const device = (name, kind, state) => ({name, kind, state});
    const sorted = sortDevices([
      device('Pixel 2 API 29', DEVICE_KIND.ANDROID_AVD, 'broken'),
      device('iPhone 15', DEVICE_KIND.IOS_SIMULATOR, 'stopped'),
      device('iPhone 14 Pro', DEVICE_KIND.IOS_DEVICE, 'disconnected'),
      device('Pixel 8', DEVICE_KIND.ANDROID_EMULATOR, 'running'),
      device('iPhone 17 Pro', DEVICE_KIND.IOS_DEVICE, 'running'),
    ]).map((d) => d.name);
    expect(sorted).toEqual(['iPhone 17 Pro', 'Pixel 8', 'iPhone 15', 'iPhone 14 Pro', 'Pixel 2 API 29']);
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

describe.skipIf(process.platform === 'win32')('doctor: running a tool', function () {
  it('returns what the tool printed and its exit code', async function () {
    const result = await run('/bin/sh', ['-c', 'echo out; echo err >&2; exit 3']);
    expect(result).toMatchObject({
      ok: false,
      missing: false,
      timedOut: false,
      code: 3,
      stdout: 'out\n',
      stderr: 'err\n',
    });
    expect(await run('/bin/sh', ['-c', 'printf ok'])).toMatchObject({ok: true, code: 0, stdout: 'ok'});
  });

  it('tells a missing binary', async function () {
    expect(await run('no-such-tool-for-the-doctor')).toMatchObject({ok: false, missing: true});
  });

  it('gives a prompt in a shell profile nothing to read', async function () {
    const result = await run('/bin/sh', ['-c', 'read answer; echo "got [$answer]"'], {timeout: 2000});
    expect(result).toMatchObject({ok: true, timedOut: false, stdout: 'got []\n'});
  });

  it('ends by the timeout a shell that ignores SIGTERM and its background job', async function () {
    const started = Date.now();
    const result = await run('/bin/sh', ['-c', "trap '' TERM; sleep 30 & sleep 30"], {timeout: 300});
    expect(result).toMatchObject({ok: false, timedOut: true});
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('the Appium server the station starts', function () {
  it('listens on this machine only, so the network cannot drive the devices', function () {
    const args = appiumArgs(4723);
    expect(args.slice(0, 4)).toEqual(['--address', '127.0.0.1', '--port', '4723']);
    expect(args).toContain('--allow-cors');
    expect(appiumArgs(4724, ['--log-level', 'debug']).slice(-2)).toEqual(['--log-level', 'debug']);
  });
});
