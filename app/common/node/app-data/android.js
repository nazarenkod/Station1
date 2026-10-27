import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {ACCESS, androidAccess} from '../../shared/app-data/access.js';
import {DEVICE_KIND} from '../doctor/devices.js';
import {runTool} from '../doctor/exec.js';

// The sandbox of an Android app: through run-as for a debug build, through
// su on an emulator without Google Play. adbd is never restarted as root:
// that would cut the Appium session, the log and the proxy.

const BIG = 512 * 1024 * 1024;

/** A word for the device shell, quoted so nothing in it is read by the shell. */
export const shellQuote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;

// the time with its fraction: two writes in one second with the same size must still differ
export const LIST_SCRIPT = "find . -type f -exec stat -c '%s|%y|%n' {} +";

/**
 * Paths with size and time from LIST_SCRIPT: `123|2026-10-27 23:30:00.123456789 +0200|./shared_prefs/a.xml`.
 * @returns {{path: string, size: number, mtime: number}[]}
 */
export function parseStatList(output) {
  const files = [];
  for (const line of String(output ?? '').split('\n')) {
    const match = /^(\d+)\|(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(?:\.(\d+))? ([+-]\d\d)(\d\d)\|\.\/(.+)$/.exec(
      line.trimEnd(),
    );
    if (match) {
      const [, size, day, time, fraction = '', zoneHours, zoneMinutes, file] = match;
      const ms = Date.parse(`${day}T${time}${zoneHours}:${zoneMinutes}`) + Number(`0.${fraction || '0'}`) * 1000;
      files.push({path: file, size: Number(size), mtime: Math.round(ms * 1000) / 1000});
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The command line that runs a script in the app's data folder, as the app
 * (run-as) or as root (su). Root makes new files the app's, or it could not
 * read them.
 */
export function sandboxCommand(appId, mode, script) {
  const home = `cd /data/data/${appId} 2>/dev/null || cd /data/user/0/${appId} || exit 1; ${script}`;
  return mode === ACCESS.RUN_AS ? `run-as ${appId} sh -c ${shellQuote(home)}` : `su 0 sh -c ${shellQuote(home)}`;
}

const dirOf = (file) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.');

/**
 * The script that puts a file pushed to /data/local/tmp into the sandbox.
 * New files get the app's usual rights (660, folders 770); root gives the
 * file and its folders back to the app, or it could not read them.
 */
export function writeScript(mode, file, staged) {
  const dir = dirOf(file);
  const folders = dir === '.' ? [] : dir.split('/').map((_part, index, parts) => parts.slice(0, index + 1).join('/'));
  const steps = ['umask 007'];
  const copy = `cat ${shellQuote(staged)} > ${shellQuote(file)}`;
  steps.push(folders.length ? `mkdir -p ${shellQuote(dir)} && ${copy}` : copy);
  if (mode === ACCESS.ROOT) {
    const owned = [...folders, file].map(shellQuote).join(' ');
    steps.push(`chown $(stat -c %u:%g .) ${owned} && (restorecon ${owned} 2>/dev/null; true)`);
  }
  return steps.join(' && ');
}

export async function openAndroid(device, appId) {
  const adb = (args, options = {}) => runTool('adb', ['-s', device.id, ...args], {timeout: 20000, ...options});

  const installed = await adb(['shell', 'pm', 'path', appId]);
  const runAs = await adb(['shell', 'run-as', appId, 'id', '-u']);
  const root = runAs.ok ? null : await adb(['shell', 'su', '0', 'id', '-u']);
  const access = androidAccess({
    runAs,
    root,
    emulator: device.kind === DEVICE_KIND.ANDROID_EMULATOR,
    installed: installed.ok ? installed.stdout.includes('package:') : true,
  });
  if (!access.mode) {
    return {error: {reason: access.reason, detail: access.detail ?? (runAs.stderr || runAs.stdout).trim()}};
  }
  const mode = access.mode;
  const inSandbox = (script, options) => adb(['exec-out', sandboxCommand(appId, mode, script)], options);
  const fail = (result, what) => {
    if (!result.ok) {
      throw new Error(`${what}: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`);
    }
  };

  return {
    transport: {
      platform: 'android',
      access: mode,
      async list() {
        const result = await inSandbox(LIST_SCRIPT, {quiet: true, timeout: 30000});
        fail(result, 'Listing the sandbox');
        return parseStatList(result.stdout);
      },
      async read(file) {
        const result = await inSandbox(`cat ${shellQuote(file)}`, {maxOutput: BIG, timeout: 60000, quiet: true});
        fail(result, `Reading ${file}`);
        return result.stdoutBuffer;
      },
      // pushed first, then copied: adb exec-in ends the command as soon as its input does,
      // so a write through stdin may be cut and nothing after it runs
      async write(file, bytes) {
        const staged = `/data/local/tmp/station-data-${process.pid}-${Date.now()}`;
        const local = await mkdtemp(path.join(os.tmpdir(), 'vision-push-'));
        try {
          await writeFile(path.join(local, 'file'), bytes);
          fail(await adb(['push', path.join(local, 'file'), staged], {timeout: 60000}), `Sending ${file}`);
          fail(await adb(['shell', sandboxCommand(appId, mode, writeScript(mode, file, staged))]), `Writing ${file}`);
        } finally {
          await adb(['shell', 'rm', '-f', staged], {quiet: true});
          await rm(local, {recursive: true, force: true});
        }
      },
      async remove(file) {
        fail(await adb(['shell', sandboxCommand(appId, mode, `rm -f ${shellQuote(file)}`)]), `Deleting ${file}`);
      },
      async stop() {
        await adb(['shell', 'am', 'force-stop', appId]);
      },
      async launch() {
        await adb(['shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1']);
      },
      async clear() {
        fail(await adb(['shell', 'pm', 'clear', appId]), 'Clearing the data');
      },
    },
  };
}
