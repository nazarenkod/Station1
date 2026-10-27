import {access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  iosBuildKind,
  parseFootprint,
  parseLaunchctlPid,
  parseMacThreads,
  parsePsTime,
} from '../../shared/perf/parsers.js';
import {macCpuPercent} from '../../shared/perf/series.js';
import {runTool} from '../doctor/exec.js';

/**
 * Measures an app on an iOS simulator. The simulator's app is a process on
 * this Mac, so `ps` and `footprint` read it directly; only its pid comes from
 * inside the simulator.
 */
export function simulatorSampler(device, bundleId) {
  const quiet = {timeout: 5000, quiet: true};
  const cores = os.cpus().length;
  let previous = null;
  let pid = null;

  return {
    memoryEvery: 2000,

    async look() {
      const listed = await runTool('xcrun', ['simctl', 'spawn', device.id, 'launchctl', 'list'], quiet);
      if (!listed.ok) {
        previous = null;
        return {ok: false, error: listed.stderr.trim()};
      }
      pid = parseLaunchctlPid(listed.stdout, bundleId);
      if (!pid) {
        previous = null;
        return {ok: true, pids: [], cpu: null, threads: null};
      }
      const [time, threads] = await Promise.all([
        runTool('ps', ['-o', 'time=', '-p', String(pid)], quiet),
        runTool('ps', ['-M', '-p', String(pid)], quiet),
      ]);
      const next = {pid, at: Date.now(), cpuSeconds: time.ok ? parsePsTime(time.stdout) : null};
      const cpu = macCpuPercent(previous, next, cores);
      previous = next;
      return {ok: true, pids: [pid], cpu, threads: threads.ok ? parseMacThreads(threads.stdout) : null};
    },

    async memory() {
      if (!pid) {
        return null;
      }
      const result = await runTool('footprint', ['-f', 'bytes', '--noCategories', String(pid)], quiet);
      const total = result.ok ? parseFootprint(result.stdout) : null;
      return total === null ? null : {total, parts: {}};
    },

    async build() {
      const container = await runTool('xcrun', ['simctl', 'get_app_container', device.id, bundleId], {timeout: 10000});
      if (!container.ok) {
        return {kind: 'unknown', flutter: null};
      }
      const app = container.stdout.trim();
      const signed = await runTool('codesign', ['-d', '--entitlements', '-', '--xml', app], {timeout: 10000});
      const flutter = await access(path.join(app, 'Frameworks', 'Flutter.framework'))
        .then(() => true)
        .catch(() => false);
      return {kind: signed.ok ? iosBuildKind(signed.stdout) : 'unknown', flutter};
    },
  };
}
