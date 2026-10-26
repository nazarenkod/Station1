import {mkdtemp, readdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {compatibility} from '../../shared/builds/compatibility.js';
import {DEVICE_KIND} from '../doctor/devices.js';
import {runTool} from '../doctor/exec.js';

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

const ANDROID_FAILURES = {
  INSTALL_FAILED_UPDATE_INCOMPATIBLE: 'signatureMismatch',
  INSTALL_FAILED_VERSION_DOWNGRADE: 'downgrade',
  INSTALL_FAILED_NO_MATCHING_ABIS: 'abi',
  INSTALL_FAILED_INSUFFICIENT_STORAGE: 'storage',
  INSTALL_FAILED_OLDER_SDK: 'olderSdk',
  INSTALL_FAILED_TEST_ONLY: 'testOnly',
  INSTALL_PARSE_FAILED_NO_CERTIFICATES: 'unsigned',
  INSTALL_FAILED_USER_RESTRICTED: 'userRestricted',
};

/**
 * Why `adb install` failed, as a reason the screens can explain, plus the
 * raw text adb printed.
 */
export function parseAdbInstall({ok, stdout, stderr}) {
  const output = `${stdout}\n${stderr}`;
  if (ok && /\bSuccess\b/.test(output)) {
    return {ok: true};
  }
  const code = /\[(INSTALL_[A-Z_]+)/.exec(output)?.[1] ?? /(INSTALL_[A-Z_]+)/.exec(output)?.[1] ?? null;
  return {
    ok: false,
    reason: (code && ANDROID_FAILURES[code]) || 'failed',
    code,
    error: output.trim().split('\n').filter(Boolean).pop() ?? 'adb install failed',
  };
}

export {compatibility};

const isAndroid = (device) =>
  device.kind === DEVICE_KIND.ANDROID_DEVICE || device.kind === DEVICE_KIND.ANDROID_EMULATOR;

async function withExtractedApp(ipa, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vision-ipa-'));
  try {
    const unpacked = await runTool('ditto', ['-x', '-k', ipa, dir], {timeout: INSTALL_TIMEOUT_MS});
    if (!unpacked.ok) {
      return {ok: false, reason: 'failed', error: unpacked.stderr.trim() || 'Cannot unpack the IPA'};
    }
    const app = (await readdir(path.join(dir, 'Payload'))).find((name) => name.endsWith('.app'));
    if (!app) {
      return {ok: false, reason: 'failed', error: 'The IPA has no app inside'};
    }
    return await fn(path.join(dir, 'Payload', app));
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

const toolResult = (result) =>
  result.ok
    ? {ok: true}
    : {ok: false, reason: 'failed', error: (result.stderr || result.stdout).trim().split('\n').pop() || 'failed'};

/**
 * Installs a build on a running device. Android replaces the installed app
 * keeping its data; `allowDowngrade` lets an older version replace a newer one.
 */
export async function installBuild(device, build, {allowDowngrade = false} = {}) {
  const fits = compatibility(build, device);
  if (!fits.ok) {
    return fits;
  }
  if (isAndroid(device)) {
    const args = ['-s', device.id, 'install', '-r'];
    if (allowDowngrade) {
      args.push('-d');
    }
    if (build.manifest.application.testOnly) {
      args.push('-t');
    }
    args.push(build.file);
    return parseAdbInstall(await runTool('adb', args, {timeout: INSTALL_TIMEOUT_MS}));
  }
  if (device.kind === DEVICE_KIND.IOS_SIMULATOR) {
    const install = async (app) =>
      toolResult(await runTool('xcrun', ['simctl', 'install', device.id, app], {timeout: INSTALL_TIMEOUT_MS}));
    return build.format === 'ipa' ? await withExtractedApp(build.file, install) : await install(build.file);
  }
  if (device.kind === DEVICE_KIND.IOS_DEVICE) {
    return toolResult(
      await runTool('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device.id, build.file], {
        timeout: INSTALL_TIMEOUT_MS,
      }),
    );
  }
  return {ok: false, reason: 'wrongPlatform'};
}

/**
 * Removes an app with its data, for when a build signed differently has to replace it.
 */
export async function uninstallApp(device, appId) {
  if (isAndroid(device)) {
    const result = await runTool('adb', ['-s', device.id, 'uninstall', appId], {timeout: 60000});
    return result.ok && /Success/.test(result.stdout) ? {ok: true} : toolResult({...result, ok: false});
  }
  if (device.kind === DEVICE_KIND.IOS_SIMULATOR) {
    return toolResult(await runTool('xcrun', ['simctl', 'uninstall', device.id, appId], {timeout: 60000}));
  }
  return toolResult(
    await runTool('xcrun', ['devicectl', 'device', 'uninstall', 'app', '--device', device.id, appId], {timeout: 60000}),
  );
}
