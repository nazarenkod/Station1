import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {runTool, shellEnv} from './exec.js';

export const DEVICE_KIND = {
  ANDROID_DEVICE: 'android-device',
  ANDROID_EMULATOR: 'android-emulator',
  ANDROID_AVD: 'android-avd',
  IOS_SIMULATOR: 'ios-simulator',
  IOS_DEVICE: 'ios-device',
};

/**
 * Parses `adb devices -l`. Each entry is a serial, its state (device, offline,
 * unauthorized) and the key:value pairs adb adds (model, product, device).
 */
export function parseAdbDevices(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices') && !line.startsWith('*'))
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      const props = Object.fromEntries(
        rest.filter((part) => part.includes(':')).map((part) => part.split(/:(.*)/s).slice(0, 2)),
      );
      return {serial, state, model: props.model?.replace(/_/g, ' ') ?? ''};
    })
    .filter((entry) => entry.serial && entry.state);
}

export function parseAvdList(output) {
  return (
    output
      .split('\n')
      .map((line) => line.trim())
      // the emulator prints INFO/WARNING lines on some setups
      .filter((line) => line && !/^(INFO|WARNING|ERROR)\b/.test(line))
  );
}

// com.apple.CoreSimulator.SimRuntime.iOS-17-0 -> {platform: 'iOS', version: '17.0'}
export function parseSimRuntime(runtime) {
  const match = /SimRuntime\.([A-Za-z]+)-([\d-]+)$/.exec(runtime);
  return match ? {platform: match[1], version: match[2].replace(/-/g, '.')} : null;
}

/**
 * iOS simulators from `xcrun simctl list devices available --json`.
 */
export function parseSimctlDevices(json) {
  const result = [];
  for (const [runtime, devices] of Object.entries(json?.devices ?? {})) {
    const parsed = parseSimRuntime(runtime);
    if (parsed?.platform !== 'iOS') {
      continue;
    }
    for (const device of devices) {
      if (device.isAvailable === false) {
        continue;
      }
      result.push({
        kind: DEVICE_KIND.IOS_SIMULATOR,
        id: device.udid,
        name: device.name,
        platformName: 'iOS',
        platformVersion: parsed.version,
        state: device.state === 'Booted' ? 'running' : 'stopped',
      });
    }
  }
  return result;
}

/**
 * Physical iOS devices from the JSON file of `xcrun devicectl list devices`.
 */
export function parseDevicectlDevices(json) {
  return (json?.result?.devices ?? [])
    .filter((device) => device.hardwareProperties?.platform === 'iOS')
    .map((device) => ({
      kind: DEVICE_KIND.IOS_DEVICE,
      id: device.hardwareProperties.udid,
      name: device.deviceProperties?.name || device.hardwareProperties.marketingName || 'iOS device',
      platformName: 'iOS',
      platformVersion: device.deviceProperties?.osVersionNumber ?? '',
      state: device.connectionProperties?.tunnelState === 'connected' ? 'running' : 'disconnected',
      developerMode: device.deviceProperties?.developerModeStatus === 'enabled',
    }));
}

async function adbShellProp(serial, prop) {
  const result = await runTool('adb', ['-s', serial, 'shell', 'getprop', prop], {timeout: 5000});
  return result.ok ? result.stdout.trim() : '';
}

async function listAndroid() {
  const adb = await runTool('adb', ['devices', '-l'], {timeout: 10000});
  const connected = adb.ok ? parseAdbDevices(adb.stdout) : [];
  const devices = await Promise.all(
    connected.map(async ({serial, state, model}) => {
      const isEmulator = serial.startsWith('emulator-');
      const ready = state === 'device';
      const [platformVersion, avdName] = ready
        ? await Promise.all([
            adbShellProp(serial, 'ro.build.version.release'),
            isEmulator
              ? runTool('adb', ['-s', serial, 'emu', 'avd', 'name'], {timeout: 5000}).then((r) =>
                  r.ok ? r.stdout.split('\n')[0].trim() : '',
                )
              : '',
          ])
        : ['', ''];
      return {
        kind: isEmulator ? DEVICE_KIND.ANDROID_EMULATOR : DEVICE_KIND.ANDROID_DEVICE,
        id: serial,
        name: avdName || model || serial,
        avdName,
        platformName: 'Android',
        platformVersion,
        // offline and unauthorized devices are listed so the doctor can explain them
        state: ready ? 'running' : state,
      };
    }),
  );

  const avds = await runTool('emulator', ['-list-avds'], {timeout: 10000});
  const runningAvds = new Set(devices.map((device) => device.avdName).filter(Boolean));
  const stopped = (avds.ok ? parseAvdList(avds.stdout) : [])
    .filter((name) => !runningAvds.has(name))
    .map((name) => ({
      kind: DEVICE_KIND.ANDROID_AVD,
      id: name,
      name: name.replace(/_/g, ' '),
      avdName: name,
      platformName: 'Android',
      platformVersion: '',
      state: 'stopped',
    }));

  return {devices: [...devices, ...stopped], adbFound: !adb.missing, emulatorFound: !avds.missing};
}

async function listIosSimulators() {
  const result = await runTool('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {timeout: 20000});
  if (!result.ok) {
    return [];
  }
  try {
    return parseSimctlDevices(JSON.parse(result.stdout));
  } catch {
    return [];
  }
}

async function listIosDevices() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vision-devicectl-'));
  const file = path.join(dir, 'devices.json');
  try {
    const result = await runTool('xcrun', ['devicectl', 'list', 'devices', '--json-output', file], {timeout: 20000});
    if (!result.ok) {
      return [];
    }
    return parseDevicectlDevices(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return [];
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

/**
 * Every device a session could run on: connected Android devices and
 * emulators, AVDs that can be started, iOS simulators and physical devices.
 */
export async function listDevices() {
  const isMac = process.platform === 'darwin';
  const [android, simulators, iosDevices] = await Promise.all([
    listAndroid(),
    isMac ? listIosSimulators() : [],
    isMac ? listIosDevices() : [],
  ]);
  return {
    devices: [...android.devices, ...simulators, ...iosDevices].map((device) => ({
      ...device,
      capabilities: capabilitiesFor(device),
    })),
    tools: {adb: android.adbFound, emulator: android.emulatorFound, xcrun: isMac},
  };
}

/**
 * Starts an AVD or boots a simulator. The emulator keeps running after the app quits.
 */
export async function bootDevice(device) {
  if (device.kind === DEVICE_KIND.ANDROID_AVD) {
    const child = spawn('emulator', ['-avd', device.avdName], {
      env: await shellEnv(),
      detached: true,
      stdio: 'ignore',
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return {ok: true};
  }
  if (device.kind === DEVICE_KIND.IOS_SIMULATOR) {
    const boot = await runTool('xcrun', ['simctl', 'boot', device.id], {timeout: 120000});
    // booting an already booted simulator is not an error worth showing
    if (!boot.ok && !/current state: Booted/i.test(boot.stderr)) {
      return {ok: false, error: boot.stderr.trim() || 'simctl boot failed'};
    }
    await runTool('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', device.id]);
    return {ok: true};
  }
  return {ok: false, error: `Cannot start a device of kind ${device.kind}`};
}

const AUTOMATION_NAME = {Android: 'UiAutomator2', iOS: 'XCUITest'};

/**
 * Capabilities that start a session on the device. A stopped AVD is passed by
 * name, so Appium starts it itself.
 */
export function capabilitiesFor(device) {
  const caps = {
    platformName: device.platformName,
    'appium:automationName': AUTOMATION_NAME[device.platformName],
    'appium:deviceName': device.name,
  };
  if (device.kind === DEVICE_KIND.ANDROID_AVD) {
    caps['appium:avd'] = device.avdName;
  } else {
    caps['appium:udid'] = device.id;
  }
  if (device.platformVersion) {
    caps['appium:platformVersion'] = device.platformVersion;
  }
  return caps;
}
