import {
  androidBuildKind,
  androidCpuProbeCommand,
  parseAndroidCpuProbe,
  parseMeminfo,
} from '../../shared/perf/parsers.js';
import {androidCpuPercent} from '../../shared/perf/series.js';
import {runTool} from '../doctor/exec.js';

/**
 * Measures an app on an Android device or emulator through adb: CPU and
 * threads of all its processes once a second, the memory of its main process
 * less often, since `dumpsys meminfo` is heavy and itself wakes the app.
 */
export function androidSampler(device, appId) {
  const adb = (args, timeout = 5000) => runTool('adb', ['-s', device.id, 'shell', ...args], {timeout, quiet: true});
  let previous = null;

  return {
    memoryEvery: 5000,

    async look() {
      const result = await adb([androidCpuProbeCommand(appId)]);
      if (!result.ok) {
        previous = null;
        return {ok: false, error: result.stderr.trim() || result.stdout.trim()};
      }
      const probe = parseAndroidCpuProbe(result.stdout);
      const cpu = probe.processes.length ? androidCpuPercent(previous, probe) : null;
      previous = probe;
      return {
        ok: true,
        pids: probe.processes.map((process) => process.pid),
        cpu,
        threads: probe.processes.length ? probe.processes.reduce((sum, process) => sum + process.threads, 0) : null,
      };
    },

    async memory() {
      const result = await adb(['dumpsys', 'meminfo', appId], 10000);
      return result.ok ? parseMeminfo(result.stdout) : null;
    },

    async build() {
      const result = await adb(['dumpsys', 'package', appId], 10000);
      return {kind: result.ok ? androidBuildKind(result.stdout) : 'unknown', flutter: null};
    },
  };
}
