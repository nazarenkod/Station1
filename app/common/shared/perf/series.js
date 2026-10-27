/**
 * The series of samples an app gives while the station measures it, and what
 * is read from it: CPU between two samples, processes starting and ending,
 * the stretches of time each screen was on.
 */

// two hours, one sample a second
export const MAX_SAMPLES = 7200;

const clampPercent = (value) => Math.min(100, Math.max(0, value));

/**
 * CPU of the app between two Android probes, in % of all cores: the ticks its
 * processes used against the ticks all cores went through. A process seen
 * for the first time counts from the next probe, as its ticks so far cover
 * more than this interval.
 */
export function androidCpuPercent(previous, next) {
  if (!previous || !next || previous.total === null || next.total === null) {
    return null;
  }
  const elapsed = next.total - previous.total;
  if (elapsed <= 0) {
    return null;
  }
  const before = new Map(previous.processes.map((process) => [process.pid, process.ticks]));
  let used = 0;
  for (const process of next.processes) {
    if (before.has(process.pid)) {
      used += Math.max(0, process.ticks - before.get(process.pid));
    }
  }
  return clampPercent((used / elapsed) * 100);
}

/**
 * CPU of a process on this Mac (a simulator's app) between two looks, in % of
 * all the Mac's cores: CPU seconds used against the wall time of all cores.
 */
export function macCpuPercent(previous, next, cores) {
  if (!previous || !next || previous.pid !== next.pid || cores <= 0) {
    return null;
  }
  const wall = (next.at - previous.at) / 1000;
  if (wall <= 0 || previous.cpuSeconds === null || next.cpuSeconds === null) {
    return null;
  }
  return clampPercent(((next.cpuSeconds - previous.cpuSeconds) / (wall * cores)) * 100);
}

/**
 * Which processes of the app started and which ended between two looks.
 */
export function processChanges(previousPids, nextPids) {
  const before = new Set(previousPids);
  const after = new Set(nextPids);
  return {
    started: [...after].filter((pid) => !before.has(pid)),
    ended: [...before].filter((pid) => !after.has(pid)),
  };
}

/**
 * Adds a sample, keeping the series within its limit. The list is changed in
 * place: it can hold thousands of samples.
 */
export function addSample(samples, sample, limit = MAX_SAMPLES) {
  samples.push(sample);
  if (samples.length > limit) {
    samples.splice(0, samples.length - limit);
  }
  return samples;
}

/**
 * The stretches of time each screen was on, from the screen markers: a
 * screen lasts until the next one, the last one until `endAt`. The same
 * screen twice in a row is one stretch.
 */
export function screenSegments(markers, endAt) {
  const screens = markers.filter((marker) => marker.kind === 'screen').sort((a, b) => a.at - b.at);
  const segments = [];
  for (const marker of screens) {
    const last = segments.at(-1);
    if (last?.key === marker.key) {
      continue;
    }
    if (last) {
      last.to = marker.at;
    }
    segments.push({key: marker.key, title: marker.title, from: marker.at, to: endAt});
  }
  return segments.filter((segment) => segment.to > segment.from);
}

/** The stretch of the screen on at a moment, or null. */
export const segmentAt = (segments, at) => segments.find((segment) => at >= segment.from && at < segment.to) ?? null;

/**
 * What the samples of a stretch say: CPU on average and at most, memory on
 * entering, on leaving and at most. Samples without a value are left out.
 */
export function summarize(samples, from, to) {
  const inside = samples.filter((sample) => sample.at >= from && sample.at < to);
  const cpu = inside.map((sample) => sample.cpu).filter((value) => typeof value === 'number');
  const memory = inside.map((sample) => sample.memory).filter((value) => typeof value === 'number');
  return {
    samples: inside.length,
    cpuAvg: cpu.length ? cpu.reduce((sum, value) => sum + value, 0) / cpu.length : null,
    cpuMax: cpu.length ? Math.max(...cpu) : null,
    memoryStart: memory.length ? memory[0] : null,
    memoryEnd: memory.length ? memory.at(-1) : null,
    memoryMax: memory.length ? Math.max(...memory) : null,
  };
}
