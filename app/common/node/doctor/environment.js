import {access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {checkKiro} from '../agent/kiro-doctor.js';
import {runTool, shellEnv, shellEnvFailure} from './exec.js';

export const CHECK_STATUS = {OK: 'ok', WARN: 'warn', ERROR: 'error'};
const {OK, WARN, ERROR} = CHECK_STATUS;

// Node.js versions Appium 3 runs on: ^20.19.0 || ^22.12.0 || >=24.0.0
export const APPIUM_NODE_RANGE = '^20.19 || ^22.12 || >=24';

const exists = async (target) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

export function parseVersion(text) {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?(-[\w.]+)?/.exec(text ?? '');
  return match
    ? {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3] ?? 0),
        pre: match[4] ?? '',
        raw: match[0],
      }
    : null;
}

/**
 * Where Android Studio puts the SDK when ANDROID_HOME is not set.
 */
export function defaultAndroidSdkPaths(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'darwin') {
    return [path.join(home, 'Library', 'Android', 'sdk')];
  }
  if (platform === 'win32') {
    return env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Android', 'Sdk')] : [];
  }
  return [path.join(home, 'Android', 'Sdk')];
}

/**
 * The Android SDK to use: the configured one, else the default install location.
 */
export async function findAndroidSdk(env) {
  const configured = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (configured) {
    return {path: configured, configured: true, exists: await exists(configured)};
  }
  for (const candidate of defaultAndroidSdkPaths()) {
    if (await exists(candidate)) {
      return {path: candidate, configured: false, exists: true};
    }
  }
  return null;
}

/**
 * Parses `appium driver list --installed --json`: driver name to its version.
 */
export function parseInstalledDrivers(output) {
  const start = output.indexOf('{');
  if (start < 0) {
    return {};
  }
  try {
    const drivers = JSON.parse(output.slice(start));
    return Object.fromEntries(
      Object.entries(drivers)
        .filter(([, info]) => info.installed !== false)
        .map(([name, info]) => [name, {version: info.version, automationName: info.automationName}]),
    );
  } catch {
    return {};
  }
}

/**
 * Parses `appium driver doctor <driver>`: ✔ marks a passed check, ✖ a failed one;
 * failed checks logged as warnings or marked optional are not blocking.
 */
export function parseDriverDoctor(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /[✔✖]/.test(line))
    .map((line) => {
      const status = line.includes('✔') ? OK : /optional|^WARN/i.test(line) ? WARN : ERROR;
      return {status, text: line.replace(/^(info|WARN|ERR!?)\s+(Doctor\s+)?/i, '').trim()};
    });
}

export function isAppiumNodeSupported({major, minor}) {
  return (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 24;
}

async function checkNode() {
  const result = await runTool('node', ['-v']);
  const version = result.ok ? parseVersion(result.stdout) : null;
  if (!version) {
    return {id: 'node', status: ERROR};
  }
  // an unsupported Node only matters to an Appium on PATH: our own server runs on the app's Node
  return {
    id: 'node',
    status: isAppiumNodeSupported(version) ? OK : WARN,
    params: {version: version.raw, range: APPIUM_NODE_RANGE},
  };
}

async function checkAppium() {
  const result = await runTool('appium', ['-v'], {timeout: 20000});
  const version = result.ok ? parseVersion(result.stdout) : null;
  if (!version) {
    return {check: {id: 'appiumMissing', status: WARN}, version: null};
  }
  const status = version.major < 2 ? ERROR : version.pre ? WARN : OK;
  return {check: {id: 'appium', status, params: {version: version.raw}}, version};
}

async function checkDrivers(appiumVersion) {
  if (!appiumVersion || appiumVersion.major < 2) {
    return {checks: [], drivers: {}};
  }
  const result = await runTool('appium', ['driver', 'list', '--installed', '--json'], {timeout: 30000});
  const drivers = parseInstalledDrivers(result.stdout);
  const wanted = ['uiautomator2', ...(process.platform === 'darwin' ? ['xcuitest'] : [])];
  const checks = wanted.map((name) =>
    drivers[name]
      ? {id: 'driver', status: OK, params: {driver: name, version: drivers[name].version}}
      : {id: 'driver', status: WARN, params: {driver: name}, fix: {action: 'installDriver', driver: name}},
  );
  return {checks, drivers};
}

async function checkAndroid(env) {
  const sdk = await findAndroidSdk(env);
  const checks = [];
  if (!sdk) {
    checks.push({id: 'androidSdk', status: ERROR});
  } else if (!sdk.exists) {
    checks.push({id: 'androidSdkMissing', status: ERROR, params: {path: sdk.path}});
  } else if (!sdk.configured) {
    // Appium refuses to start Android sessions without ANDROID_HOME
    checks.push({id: 'androidHome', status: WARN, params: {path: sdk.path}});
  } else {
    checks.push({id: 'androidSdk', status: OK, params: {path: sdk.path}});
  }

  const adb = await runTool('adb', ['version']);
  checks.push(
    adb.ok
      ? {id: 'adb', status: OK, params: {version: parseVersion(adb.stdout)?.raw ?? ''}}
      : {id: 'adb', status: ERROR},
  );

  const java = await runTool('java', ['-version']);
  const javaVersion = parseVersion(java.stderr || java.stdout)?.raw ?? '';
  if (!java.ok) {
    checks.push({id: 'java', status: ERROR});
  } else {
    checks.push({
      id: 'java',
      status: env.JAVA_HOME ? OK : WARN,
      params: {version: javaVersion, home: env.JAVA_HOME ?? ''},
    });
  }
  return {checks, sdk};
}

async function checkXcode() {
  const select = await runTool('xcode-select', ['-p']);
  if (!select.ok) {
    return [{id: 'xcode', status: ERROR}];
  }
  const build = await runTool('xcodebuild', ['-version'], {timeout: 20000});
  // xcode-select pointing at the Command Line Tools cannot build WebDriverAgent
  if (!build.ok || select.stdout.includes('CommandLineTools')) {
    return [{id: 'xcode', status: ERROR, params: {path: select.stdout.trim()}}];
  }
  return [
    {id: 'xcode', status: OK, params: {version: parseVersion(build.stdout)?.raw ?? '', path: select.stdout.trim()}},
  ];
}

/**
 * What a session needs on this machine: Node.js, Appium and its drivers, the
 * Android SDK, adb and Java, and Xcode on macOS. Each check has an id and a
 * status; the UI turns them into text.
 */
export async function checkEnvironment() {
  const env = await shellEnv();
  const [node, appium, android, xcode, kiro] = await Promise.all([
    checkNode(),
    checkAppium(),
    checkAndroid(env),
    process.platform === 'darwin' ? checkXcode() : [],
    // the station's agent runs on Kiro CLI
    checkKiro(),
  ]);
  const drivers = await checkDrivers(appium.version);
  const shell = await shellEnvFailure();
  return {
    checks: [
      ...(shell ? [{id: 'shellEnv', status: WARN, params: shell}] : []),
      node,
      appium.check,
      ...drivers.checks,
      ...android.checks,
      ...xcode,
      kiro,
    ],
    appiumVersion: appium.version?.raw ?? null,
    drivers: drivers.drivers,
    androidSdk: android.sdk?.exists ? android.sdk.path : null,
  };
}

/**
 * Runs the driver's own checks (Appium 2.4+).
 */
export async function runDriverDoctor(driver) {
  const result = await runTool('appium', ['driver', 'doctor', driver], {timeout: 120000});
  const output = `${result.stdout}\n${result.stderr}`;
  if (/invalid choice: 'doctor'/.test(output)) {
    return {supported: false, items: [], output};
  }
  return {supported: true, items: parseDriverDoctor(output), output};
}
