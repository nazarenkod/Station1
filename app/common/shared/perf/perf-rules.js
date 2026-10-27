import {makeFinding} from '../findings/findings.js';
import {screenSegments, segmentAt, summarize} from './series.js';

// What a measurement says is wrong even without a baseline: CPU high for a
// long while, and memory that grows each time the same screen opens again
// (what a leak looks like when a flow goes back and forth). The findings
// join the others on the desk; the texts are finding_<rule>_title.

const MB = 1024 * 1024;

export const PERF_RULES = {
  // % of all cores: on an eight-core phone 40% is three cores busy
  cpuPercent: 40,
  cpuSeconds: 15,
  // memory on entering a screen again, against the first time: both must be passed
  memoryGrowthBytes: 30 * MB,
  memoryGrowthShare: 0.2,
};

const screenName = (segment) => segment?.title || segment?.key || '';

/**
 * Stretches of samples in a row with CPU at or over the threshold, long enough.
 * A sample without CPU breaks a stretch.
 */
function cpuStretches(samples, rules) {
  const stretches = [];
  let run = [];
  const close = () => {
    if (run.length >= rules.cpuSeconds) {
      stretches.push(run);
    }
    run = [];
  };
  for (const sample of samples) {
    if (typeof sample.cpu === 'number' && sample.cpu >= rules.cpuPercent) {
      run.push(sample);
    } else {
      close();
    }
  }
  close();
  return stretches;
}

/**
 * The findings of a measurement.
 * @param {object} perf
 * @param {object[]} perf.samples a sample a second: {at, cpu, memory, threads}
 * @param {object[]} perf.markers screens and processes
 * @param {string} [perf.appId]
 * @param {number} perf.endAt when the measurement ends (now while it runs)
 */
export function perfFindings({samples, markers, appId = '', endAt}, rules = PERF_RULES) {
  const segments = screenSegments(markers ?? [], endAt);
  const findings = [];

  // CPU: one finding for each screen it happened on
  const byScreen = new Map();
  for (const stretch of cpuStretches(samples ?? [], rules)) {
    const segment = segmentAt(segments, stretch[0].at);
    const key = segment?.key ?? '';
    const was = byScreen.get(key);
    const peak = Math.max(...stretch.map((sample) => sample.cpu));
    const seconds = Math.round((stretch.at(-1).at - stretch[0].at) / 1000) + 1;
    byScreen.set(key, {
      screen: screenName(segment),
      count: (was?.count ?? 0) + 1,
      percent: Math.max(was?.percent ?? 0, Math.round(peak)),
      seconds: Math.max(was?.seconds ?? 0, seconds),
      lastTime: stretch.at(-1).at,
    });
  }
  for (const [key, found] of byScreen) {
    findings.push({
      ...makeFinding({
        tool: 'perf',
        rule: 'perf-cpu-high',
        severity: 'medium',
        subject: key || 'app',
        scope: appId,
        params: {percent: found.percent, seconds: found.seconds, screen: found.screen},
      }),
      textKey: found.screen ? 'perf-cpu-high' : 'perf-cpu-high-app',
      count: found.count,
      lastTime: found.lastTime,
    });
  }

  // memory: the same screen entered again, with more memory than the first time
  const visits = new Map();
  for (const segment of segments) {
    const {memoryStart} = summarize(samples ?? [], segment.from, segment.to);
    if (memoryStart !== null) {
      visits.set(segment.key, [...(visits.get(segment.key) ?? []), {segment, memory: memoryStart}]);
    }
  }
  for (const [key, list] of visits) {
    if (list.length < 2) {
      continue;
    }
    const first = list[0].memory;
    const last = list.at(-1).memory;
    const growth = last - first;
    if (growth >= rules.memoryGrowthBytes && growth >= first * rules.memoryGrowthShare) {
      findings.push({
        ...makeFinding({
          tool: 'perf',
          rule: 'perf-memory-growth',
          severity: 'medium',
          subject: key,
          scope: appId,
          params: {screen: screenName(list[0].segment), mb: Math.round(growth / MB), visits: list.length},
        }),
        count: list.length,
        lastTime: list.at(-1).segment.from,
      });
    }
  }
  return findings;
}
