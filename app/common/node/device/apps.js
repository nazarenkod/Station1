import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {readPlist} from '../builds/plist.js';
import {DEVICE_KIND} from '../doctor/devices.js';
import {runTool} from '../doctor/exec.js';

const isAndroid = (device) =>
  device.kind === DEVICE_KIND.ANDROID_DEVICE || device.kind === DEVICE_KIND.ANDROID_EMULATOR;

/**
 * Package names from `pm list packages`: one `package:<name>` per line.
 */
export function parsePmPackages(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('package:'))
    .map((line) => line.slice('package:'.length))
    .filter(Boolean)
    .sort();
}

/**
 * The package of the activity on screen, from `dumpsys activity activities`.
 * Android versions name the line differently (mResumedActivity,
 * topResumedActivity, ResumedActivity).
 */
export function parseResumedPackage(output) {
  const match = /(?:mResumedActivity|topResumedActivity|ResumedActivity)[:=]\s*ActivityRecord\{\S+ \S+ ([\w.]+)\//.exec(
    output,
  );
  return match ? match[1] : null;
}

/**
 * versionName and versionCode from `dumpsys package <name>`.
 */
export function parseAndroidVersion(output) {
  const name = /versionName=(\S+)/.exec(output)?.[1] ?? '';
  const code = /versionCode=(\d+)/.exec(output)?.[1] ?? '';
  return {version: name, build: code};
}

/**
 * User apps of a simulator, from `simctl listapps` converted to JSON.
 */
export function parseSimctlApps(json) {
  return Object.values(json ?? {})
    .filter((app) => app?.ApplicationType === 'User')
    .map((app) => ({
      id: app.CFBundleIdentifier,
      name: app.CFBundleDisplayName || app.CFBundleName || app.CFBundleIdentifier,
      version: app.CFBundleShortVersionString ?? '',
      build: app.CFBundleVersion ?? '',
    }))
    .filter((app) => app.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Apps a person installed on an iPhone, from `devicectl device info apps`.
 */
export function parseDevicectlApps(json) {
  return (json?.result?.apps ?? [])
    .filter((app) => app.removable !== false && !app.hidden && !app.appClip)
    .map((app) => ({
      id: app.bundleIdentifier,
      name: app.name || app.bundleIdentifier,
      version: app.version ?? '',
      build: app.bundleVersion ?? '',
    }))
    .filter((app) => app.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vision-apps-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

async function simulatorApps(udid) {
  const listed = await runTool('xcrun', ['simctl', 'listapps', udid], {timeout: 20000});
  if (!listed.ok) {
    return [];
  }
  // listapps prints an old-style plist; plutil turns it into JSON
  return await withTempDir(async (dir) => {
    const file = path.join(dir, 'apps.plist');
    await writeFile(file, listed.stdout);
    const converted = await runTool('plutil', ['-convert', 'json', '-o', '-', file], {timeout: 10000});
    try {
      return converted.ok ? parseSimctlApps(JSON.parse(converted.stdout)) : [];
    } catch {
      return [];
    }
  });
}

let xcodeVersion = null;
async function installedXcode() {
  if (xcodeVersion === null) {
    const result = await runTool('xcodebuild', ['-version'], {timeout: 10000});
    xcodeVersion = /Xcode\s+(\S+)/.exec(result.stdout)?.[1] ?? '';
  }
  return xcodeVersion;
}

/**
 * Why devicectl could not talk to an iPhone, from the error in its JSON file.
 * The common one: an Xcode older than the phone's iOS cannot mount the
 * developer disk image, and then nothing (apps, WebDriverAgent) works.
 */
export function devicectlProblem(json) {
  const error = json?.error;
  if (!error) {
    return null;
  }
  const text = JSON.stringify(error);
  if (/developer disk image|PersonalizedBundleMissingVariant|DeveloperDiskImage/i.test(text)) {
    return {reason: 'xcodeTooOld'};
  }
  if (/locked|passcode/i.test(text)) {
    return {reason: 'deviceLocked'};
  }
  if (/not paired|pairing/i.test(text)) {
    return {reason: 'notPaired'};
  }
  const description = error.userInfo?.NSLocalizedDescription?.string ?? 'devicectl failed';
  return {reason: 'failed', message: description};
}

async function iphoneApps(device) {
  return await withTempDir(async (dir) => {
    const file = path.join(dir, 'apps.json');
    await runTool('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', device.id, '--json-output', file], {
      timeout: 30000,
    });
    let json;
    try {
      json = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return {apps: [], error: {reason: 'failed', message: 'devicectl gave no answer'}};
    }
    const problem = devicectlProblem(json);
    if (problem) {
      return {
        apps: [],
        error: {...problem, xcode: await installedXcode(), ios: device.platformVersion ?? ''},
      };
    }
    return {apps: parseDevicectlApps(json), error: null};
  });
}

/**
 * The apps a person installed on a running device (system apps are left out),
 * and why they could not be read when that happens. Android lists package
 * names only; versions are read for one app at a time.
 */
export async function listAppsWithStatus(device) {
  if (isAndroid(device)) {
    const result = await runTool('adb', ['-s', device.id, 'shell', 'pm', 'list', 'packages', '-3'], {
      timeout: 15000,
    });
    return result.ok
      ? {apps: parsePmPackages(result.stdout).map((id) => ({id, name: id, version: '', build: ''})), error: null}
      : {apps: [], error: {reason: 'failed', message: (result.stderr || result.stdout).trim()}};
  }
  if (device.kind === DEVICE_KIND.IOS_SIMULATOR) {
    return {apps: await simulatorApps(device.id), error: null};
  }
  if (device.kind === DEVICE_KIND.IOS_DEVICE) {
    return await iphoneApps(device);
  }
  return {apps: [], error: null};
}

export async function listApps(device) {
  return (await listAppsWithStatus(device)).apps;
}

/**
 * The app on screen right now. Only Android can tell without a session.
 */
export async function foregroundApp(device) {
  if (!isAndroid(device)) {
    return null;
  }
  const result = await runTool('adb', ['-s', device.id, 'shell', 'dumpsys', 'activity', 'activities'], {
    timeout: 10000,
  });
  return result.ok ? parseResumedPackage(result.stdout) : null;
}

/**
 * The installed version of one app, or null when it is not installed.
 */
export async function appVersion(device, appId) {
  if (isAndroid(device)) {
    const result = await runTool('adb', ['-s', device.id, 'shell', 'dumpsys', 'package', appId], {timeout: 10000});
    if (!result.ok || !result.stdout.includes(`Package [${appId}]`)) {
      return null;
    }
    return parseAndroidVersion(result.stdout);
  }
  if (device.kind === DEVICE_KIND.IOS_SIMULATOR) {
    // the app's own Info.plist: works for system apps too, which listapps leaves out
    const container = await runTool('xcrun', ['simctl', 'get_app_container', device.id, appId], {timeout: 10000});
    if (!container.ok) {
      return null;
    }
    try {
      const info = await readPlist(await readFile(path.join(container.stdout.trim(), 'Info.plist')));
      return {version: info.CFBundleShortVersionString ?? '', build: info.CFBundleVersion ?? ''};
    } catch {
      return {version: '', build: ''};
    }
  }
  const app = (await listApps(device)).find((candidate) => candidate.id === appId);
  return app ? {version: app.version, build: app.build} : null;
}
