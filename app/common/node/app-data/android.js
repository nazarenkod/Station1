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
  // root writes files as root; the app gets them back, with their SELinux label
  const owned = (file) =>
    mode === ACCESS.ROOT
      ? ` && chown $(stat -c %u:%g .) ${shellQuote(file)} && (restorecon ${shellQuote(file)} 2>/dev/null; true)`
      : '';

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
      async write(file, bytes) {
        const script = `mkdir -p ${shellQuote(dirOf(file))} && cat > ${shellQuote(file)}${owned(file)}`;
        const result = await adb(['exec-in', sandboxCommand(appId, mode, script)], {
          input: Buffer.from(bytes),
          timeout: 60000,
        });
        fail(result, `Writing ${file}`);
      },
      async remove(file) {
        fail(await inSandbox(`rm -f ${shellQuote(file)}`), `Deleting ${file}`);
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
