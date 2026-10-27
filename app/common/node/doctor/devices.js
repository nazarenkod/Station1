import {spawn} from 'node:child_process';
import {access, mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {findAndroidSdk} from './environment.js';
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

// key=value lines of the emulator's .ini files
export function parseIni(text) {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

const fileExists = async (target) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether an AVD's system image is gone (a partly removed SDK package): the
 * emulator then fails with "No initial system image for this configuration".
 * Unknown (false) when the AVD files cannot be read.
 */
export async function isAvdImageMissing(name, env) {
  const avdHome = env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android', 'avd');
  try {
    const avdIni = parseIni(await readFile(path.join(avdHome, `${name}.ini`), 'utf8'));
    const config = parseIni(await readFile(path.join(avdIni.path, 'config.ini'), 'utf8'));
    const sdk = await findAndroidSdk(env);
    const sysdir = config['image.sysdir.1'];
    if (!sdk?.exists || !sysdir) {
      return false;
    }
    return !(await fileExists(path.join(sdk.path, sysdir, 'system.img')));
  } catch {
    return false;
  }
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
 * Whether a paired iPhone is connected now. The CoreDevice tunnel opens on
 * demand and closes when idle, so a phone on the cable often shows
 * "disconnected"; the cable is what tells it is there. A phone only seen on
 * the Wi-Fi network (paired earlier, lying on a desk nearby) is not
 * connected until a tunnel to it is open.
 */
export function isIosDeviceConnected(connection = {}) {
  return connection.transportType === 'wired' || connection.tunnelState === 'connected';
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
      name: (device.deviceProperties?.name || device.hardwareProperties.marketingName || 'iOS device').trim(),
      platformName: 'iOS',
      platformVersion: device.deviceProperties?.osVersionNumber ?? '',
      state: isIosDeviceConnected(device.connectionProperties) ? 'running' : 'disconnected',
      developerMode: device.deviceProperties?.developerModeStatus === 'enabled',
    }));
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A name a person knows the Android device by: the AVD of an emulator
 * (Pixel_7_API_34 -> "Pixel 7 API 34"), the marketing name of a phone, else
 * its maker and model ("Samsung SM-G991B"); the serial when nothing is known.
 */
export function androidDeviceName({serial, model = '', avdName = '', manufacturer = '', marketName = ''}) {
  if (avdName) {
    return avdName.replace(/_/g, ' ');
  }
  if (marketName) {
    return marketName;
  }
  if (model && manufacturer && !model.toLowerCase().startsWith(manufacturer.toLowerCase())) {
    return `${capitalize(manufacturer)} ${model}`;
  }
  return model || serial;
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
      const prop = (name) => (ready ? adbShellProp(serial, name) : '');
      const [platformVersion, consoleAvd, propAvd, manufacturer, marketName] = await Promise.all([
        prop('ro.build.version.release'),
        // the console answers only with its auth token in place; Android 12+ says it in a property too
        isEmulator && ready
          ? runTool('adb', ['-s', serial, 'emu', 'avd', 'name'], {timeout: 5000}).then((r) =>
              r.ok && !/^KO\b/.test(r.stdout) ? r.stdout.split('\n')[0].trim() : '',
            )
          : '',
        isEmulator ? prop('ro.boot.qemu.avd_name') : '',
        isEmulator ? '' : prop('ro.product.manufacturer'),
        isEmulator ? '' : prop('ro.product.marketname'),
      ]);
      const avdName = consoleAvd || propAvd;
      return {
        kind: isEmulator ? DEVICE_KIND.ANDROID_EMULATOR : DEVICE_KIND.ANDROID_DEVICE,
        id: serial,
        name: androidDeviceName({serial, model, avdName, manufacturer, marketName}),
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
  const env = await shellEnv();
  const stopped = await Promise.all(
    (avds.ok ? parseAvdList(avds.stdout) : [])
      .filter((name) => !runningAvds.has(name))
      .map(async (name) => ({
        kind: DEVICE_KIND.ANDROID_AVD,
        id: name,
        name: name.replace(/_/g, ' '),
        avdName: name,
        platformName: 'Android',
        platformVersion: '',
        state: (await isAvdImageMissing(name, env)) ? 'broken' : 'stopped',
      })),
  );

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

const PHYSICAL = new Set([DEVICE_KIND.ANDROID_DEVICE, DEVICE_KIND.IOS_DEVICE]);
const STATE_ORDER = ['running', 'stopped', 'disconnected', 'offline', 'unauthorized', 'broken'];

/**
 * The order every list shows devices in: what can be used right now first
 * (real phones before emulators and simulators), then what can be started,
 * then what is unplugged or broken.
 */
export function sortDevices(devices) {
  const stateRank = (device) => {
    const index = STATE_ORDER.indexOf(device.state);
    return index < 0 ? STATE_ORDER.length : index;
  };
  return [...devices].sort(
    (a, b) =>
      stateRank(a) - stateRank(b) ||
      Number(PHYSICAL.has(b.kind)) - Number(PHYSICAL.has(a.kind)) ||
      a.name.localeCompare(b.name),
  );
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
    devices: sortDevices([...android.devices, ...simulators, ...iosDevices]).map((device) => ({
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
