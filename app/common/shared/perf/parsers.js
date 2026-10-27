/**
 * What the device tools print about an app's process, read into numbers.
 * Pure functions: the Node side runs the tools, the tests feed their output.
 */

const KB = 1024;

// a package name or bundle id: safe to put into a device shell command
export const isAppId = (value) => typeof value === 'string' && /^[A-Za-z0-9_]+(\.[A-Za-z0-9_-]+)+$/.test(value);

// ---- Android

/**
 * The first line of `/proc/stat`: the time all cores spent, in clock ticks.
 * Guest time is already counted in user time, so only the first eight count.
 */
export function parseProcStatTotal(line) {
  const match = /^cpu\s+(.+)$/.exec(line?.trim() ?? '');
  if (!match) {
    return null;
  }
  const fields = match[1].trim().split(/\s+/).slice(0, 8).map(Number);
  return fields.every(Number.isFinite) ? fields.reduce((sum, value) => sum + value, 0) : null;
}

/**
 * One `/proc/<pid>/stat`: CPU ticks the process used (user and system) and
 * its threads. The name in brackets may hold spaces, so fields are counted
 * from the closing bracket.
 */
export function parsePidStat(text) {
  const close = text?.lastIndexOf(')') ?? -1;
  if (close < 0) {
    return null;
  }
  const pid = Number(text.slice(0, text.indexOf('(')).trim());
  // field 3 (state) comes first after the bracket
  const fields = text
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  const threads = Number(fields[17]);
  if (!Number.isFinite(pid) || !Number.isFinite(utime) || !Number.isFinite(stime)) {
    return null;
  }
  return {pid, ticks: utime + stime, threads: Number.isFinite(threads) ? threads : 0};
}

/**
 * The output of the station's CPU probe: the `/proc/stat` line, then a
 * `P <pid> <stat>` line for each process of the app.
 */
export function parseAndroidCpuProbe(output) {
  const lines = (output ?? '').split('\n').map((line) => line.replace(/\r$/, ''));
  const total = parseProcStatTotal(lines.find((line) => line.startsWith('cpu ')) ?? '');
  const processes = [];
  for (const line of lines) {
    const match = /^P (\d+) (.+)$/.exec(line);
    const stat = match && parsePidStat(match[2]);
    if (stat) {
      processes.push(stat);
    }
  }
  return {total, processes};
}

/**
 * The shell command that prints the CPU probe for the app's processes: the
 * main one is named after the package, the others `package:name`.
 */
export function androidCpuProbeCommand(appId) {
  if (!isAppId(appId)) {
    throw new Error(`not a package name: ${appId}`);
  }
  return (
    `head -n 1 /proc/stat; ` +
    `for p in $(ps -A -o PID,NAME | awk '$2=="${appId}" || index($2,"${appId}:")==1 {print $1}'); ` +
    `do echo "P $p $(cat /proc/$p/stat 2>/dev/null)"; done`
  );
}

const MEMINFO_PARTS = {
  'Java Heap': 'java',
  'Native Heap': 'native',
  Code: 'code',
  Stack: 'stack',
  Graphics: 'graphics',
  'Private Other': 'other',
  System: 'system',
};

/**
 * The App Summary of `dumpsys meminfo <package>`, in bytes: PSS in total and
 * by part. Android 10+ prints `TOTAL PSS:`, older ones `TOTAL:`.
 */
export function parseMeminfo(text) {
  const start = text?.indexOf('App Summary') ?? -1;
  if (start < 0) {
    return null;
  }
  const parts = {};
  let total = null;
  for (const line of text.slice(start).split('\n')) {
    const part = /^\s*([A-Za-z ]+):\s+(\d+)/.exec(line);
    if (part && MEMINFO_PARTS[part[1].trim()]) {
      parts[MEMINFO_PARTS[part[1].trim()]] = Number(part[2]) * KB;
    }
    const sum = /TOTAL(?: PSS)?:\s+(\d+)/.exec(line);
    if (sum && total === null) {
      total = Number(sum[1]) * KB;
    }
  }
  return total === null ? null : {total, parts};
}

/**
 * Whether `dumpsys package <package>` says the app is debuggable.
 */
export function androidBuildKind(text) {
  const flags = /^\s*(?:pkgFlags|flags)=\[([^\]]*)\]/m.exec(text ?? '');
  if (!flags) {
    return 'unknown';
  }
  return /\bDEBUGGABLE\b/.test(flags[1]) ? 'debug' : 'release';
}

// ---- iOS simulator

/**
 * The pid of the app from `launchctl list` inside a simulator:
 * "57556  0  UIKitApplication:com.acme.wallet[d3a2][rb-legacy]". A dash
 * instead of a pid means the app is not running.
 */
export function parseLaunchctlPid(output, bundleId) {
  for (const line of (output ?? '').split('\n')) {
    const [pid, , label] = line.trim().split(/\s+/);
    if (label?.startsWith(`UIKitApplication:${bundleId}[`) && /^\d+$/.test(pid)) {
      return Number(pid);
    }
  }
  return null;
}

/**
 * CPU time from `ps -o time=` on a Mac: "16:17.59", "1:02:03.45" or
 * "2-01:02:03.45", in seconds.
 */
export function parsePsTime(text) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text?.trim() ?? '');
  if (!match) {
    return null;
  }
  const [, days = '0', hours = '0', minutes, seconds] = match;
  return Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/**
 * Threads of a process from `ps -M -p <pid>`: a line per thread under a header.
 */
export function parseMacThreads(output) {
  const lines = (output ?? '').split('\n').filter((line) => line.trim());
  return Math.max(0, lines.length - 1);
}

/**
 * The footprint of a process from `footprint -f bytes`: what iOS counts when
 * it decides to end an app for memory.
 */
export function parseFootprint(text) {
  const match = /Footprint:\s+(\d+)\s*B\b/.exec(text ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * Whether the entitlements an app is signed with (`codesign -d
 * --entitlements - --xml`) allow a debugger: a debug build.
 */
export function iosBuildKind(xml) {
  if (!xml || !xml.includes('<plist')) {
    return 'unknown';
  }
  const match = /<key>(?:com\.apple\.security\.)?get-task-allow<\/key>\s*<(true|false)\s*\/>/.exec(xml);
  return match?.[1] === 'true' ? 'debug' : 'release';
}
