import {makeFinding} from '../findings/findings.js';
import {PERF_RULES} from './perf-rules.js';
import {screenSegments, summarize} from './series.js';

// What a measurement of a build leaves behind, and how a build is compared
// with the project's reference values: the median of several runs of one
// build, on one device model, of one kind (debug or release).

const MB = 1024 * 1024;

// a run shorter than this says too little to keep
export const MIN_RUN_MS = 30 * 1000;
// the runs of an app kept with their graphs
export const MAX_RUNS = 50;

/** The project's settings of the Performance tab, as the profile keeps them. */
export const PERF_DEFAULTS = {
  // how much worse than the reference a measure may get, as a share of it
  tolerances: {memory: 0.15, cpu: 0.25, start: 0.1},
  // runs of one build a reference is made of
  baselineRuns: 3,
  // the findings without a reference (perf-rules.js)
  rules: PERF_RULES,
};

/** The settings with every value in place, whatever the profile holds. */
export function perfSettings(saved) {
  const number = (value, fallback, min = 0) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;
  const tolerances = Object.fromEntries(
    Object.entries(PERF_DEFAULTS.tolerances).map(([key, value]) => [key, number(saved?.tolerances?.[key], value)]),
  );
  const rules = Object.fromEntries(
    Object.entries(PERF_DEFAULTS.rules).map(([key, value]) => [key, number(saved?.rules?.[key], value)]),
  );
  return {tolerances, baselineRuns: Math.round(number(saved?.baselineRuns, PERF_DEFAULTS.baselineRuns, 1)), rules};
}

// measures that are compared, lower is better for all; `tolerance` names the project's setting
export const MEASURES = {
  cpuAvg: {tolerance: 'cpu', unit: 'percent'},
  memoryAvg: {tolerance: 'memory', unit: 'bytes'},
  memoryMax: {tolerance: 'memory', unit: 'bytes'},
};
const APP_MEASURES = ['cpuAvg', 'memoryAvg', 'memoryMax'];
const SCREEN_MEASURES = ['cpuAvg', 'memoryMax'];
// a change smaller than this is noise whatever its share: 0.1% → 0.3% CPU is not three times worse
const MIN_CHANGE = {percent: 2, bytes: 5 * MB};

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const numbers = (list) => list.filter((value) => typeof value === 'number' && Number.isFinite(value));

/** What a build is called: its version and its number, as the device reports the app. */
export const buildLabel = (build) =>
  [build?.version, build?.number ? `(${build.number})` : ''].filter(Boolean).join(' ');

/** Runs of the same build: same version and number, same kind. */
export const sameBuild = (a, b) =>
  (a.version ?? '') === (b.version ?? '') && (a.number ?? '') === (b.number ?? '') && a.kind === b.kind;

/** The group a reference belongs to: the device model and the kind of build on one platform. */
export const groupKey = (run) => `${run.platform}|${run.device}|${run.build.kind}`;

/**
 * The summary of a measurement: the app as a whole and each named screen.
 * @param {object} run
 * @param {object[]} run.samples
 * @param {object[]} run.markers
 * @param {number} run.endAt
 */
export function summarizeRun({samples, markers, endAt}) {
  const memory = numbers(samples.map((sample) => sample.memory));
  const app = {
    cpuAvg: average(numbers(samples.map((sample) => sample.cpu))),
    memoryAvg: average(memory),
    memoryMax: memory.length ? Math.max(...memory) : null,
  };
  const screens = {};
  for (const segment of screenSegments(markers, endAt)) {
    if (!segment.title) {
      continue;
    }
    const inside = samples.filter((sample) => sample.at >= segment.from && sample.at < segment.to);
    const part = summarize(samples, segment.from, segment.to);
    const was = screens[segment.key];
    const cpu = numbers(inside.map((sample) => sample.cpu));
    screens[segment.key] = {
      title: segment.title,
      visits: (was?.visits ?? 0) + 1,
      seconds: (was?.seconds ?? 0) + Math.round((segment.to - segment.from) / 1000),
      // CPU over all the visits, second by second
      cpuSamples: [...(was?.cpuSamples ?? []), ...cpu],
      memoryStart: was ? was.memoryStart : part.memoryStart,
      memoryEnd: part.memoryEnd ?? was?.memoryEnd ?? null,
      memoryMax: Math.max(was?.memoryMax ?? -Infinity, part.memoryMax ?? -Infinity),
    };
  }
  for (const screen of Object.values(screens)) {
    screen.cpuAvg = average(screen.cpuSamples);
    delete screen.cpuSamples;
    if (!Number.isFinite(screen.memoryMax)) {
      screen.memoryMax = null;
    }
  }
  return {app, screens};
}

/**
 * The run as it is kept: what was measured, on what, and its summary.
 * Null when the run is too short to say anything.
 */
export function makeRun({id, appId, platform, device, os, build, samples, markers, startedAt, endAt}) {
  if (!samples?.length || endAt - startedAt < MIN_RUN_MS) {
    return null;
  }
  return {
    id,
    appId,
    platform,
    device,
    os: os ?? '',
    build: {version: build?.version ?? '', number: build?.number ?? '', kind: build?.kind ?? 'unknown'},
    startedAt,
    endAt,
    summary: summarizeRun({samples, markers, endAt}),
  };
}

const median = (values) => {
  const sorted = numbers(values).sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** A measure over several runs: the median, and how far the worst run went above it. */
function combine(values) {
  const middle = median(values);
  const present = numbers(values);
  return middle === null ? null : {value: middle, spread: Math.max(...present) - middle, runs: present.length};
}

/**
 * Several runs of one build as one: each measure of the app and of each
 * screen is the median of the runs that have it.
 */
export function combineRuns(runs) {
  const app = Object.fromEntries(
    APP_MEASURES.map((measure) => [measure, combine(runs.map((run) => run.summary.app[measure]))]),
  );
  const keys = [...new Set(runs.flatMap((run) => Object.keys(run.summary.screens)))];
  const screens = {};
  for (const key of keys) {
    const present = runs.map((run) => run.summary.screens[key]).filter(Boolean);
    screens[key] = {
      title: present.at(-1).title,
      ...Object.fromEntries(
        SCREEN_MEASURES.map((measure) => [measure, combine(present.map((screen) => screen[measure]))]),
      ),
    };
  }
  const last = runs.at(-1);
  return {
    build: last.build,
    platform: last.platform,
    device: last.device,
    os: last.os,
    runIds: runs.map((run) => run.id),
    app,
    screens,
  };
}

/** The runs of the build `run` belongs to, on its device, oldest first. */
export const runsOfBuild = (runs, run) =>
  runs
    .filter(
      (other) => other.platform === run.platform && other.device === run.device && sameBuild(other.build, run.build),
    )
    .sort((a, b) => a.startedAt - b.startedAt);

/**
 * A reference made of the runs of one build, or why it cannot be made yet.
 * @returns {{baseline?: object, missing?: number}}
 */
export function makeBaseline(runs, {baselineRuns}, now = Date.now()) {
  if (runs.length < baselineRuns) {
    return {missing: baselineRuns - runs.length};
  }
  return {baseline: {...combineRuns(runs.slice(-baselineRuns)), at: now}};
}

/**
 * Which reference a build is compared with, or why none is: a debug build only
 * with a debug reference, a release one with a release one, on the same
 * device model. Another OS version is compared, and said so.
 */
export function pickBaseline(baselines, build) {
  const key = groupKey(build);
  const own = baselines[key]?.current;
  if (own) {
    return {baseline: own, osDiffers: !!own.os && !!build.os && own.os !== build.os};
  }
  const others = Object.values(baselines)
    .map((entry) => entry.current)
    .filter((baseline) => baseline && baseline.platform === build.platform);
  if (!others.length) {
    return {reason: 'none'};
  }
  const sameDevice = others.filter((baseline) => baseline.device === build.device);
  return sameDevice.length
    ? {reason: 'kind', available: sameDevice.map((baseline) => baseline.build.kind)}
    : {reason: 'device', available: [...new Set(others.map((baseline) => baseline.device))]};
}

/**
 * One measure against the reference. Worse or better only past both the
 * project's tolerance and the reference's own spread, and past a change
 * too small to matter.
 */
export function judge(measure, current, reference, tolerances) {
  if (!current || !reference || current.value === null || reference.value === null) {
    return null;
  }
  const {tolerance, unit} = MEASURES[measure];
  const allowed = tolerances[tolerance] ?? 0;
  const change = current.value - reference.value;
  const share = reference.value ? change / reference.value : 0;
  const margin = Math.max(reference.value * allowed, reference.spread ?? 0, MIN_CHANGE[unit]);
  const verdict = change > margin ? 'worse' : -change > margin ? 'better' : 'same';
  // memory twice past what the project allows is red; the rest is yellow
  const severe =
    verdict === 'worse' && tolerance === 'memory' && change > Math.max(reference.value * allowed * 2, margin);
  return {
    measure,
    unit,
    value: current.value,
    reference: reference.value,
    change,
    share,
    verdict,
    severity: verdict === 'worse' ? (severe ? 'high' : 'medium') : null,
  };
}

/**
 * A build against the reference: the app as a whole, each screen both
 * have, and the screens only one of them has (not anomalies).
 */
export function compareBuild(build, baseline, tolerances) {
  const app = APP_MEASURES.map((measure) =>
    judge(measure, build.app[measure], baseline.app[measure], tolerances),
  ).filter(Boolean);
  const screens = [];
  const onlyBuild = [];
  for (const [key, screen] of Object.entries(build.screens)) {
    const reference = baseline.screens[key];
    if (!reference) {
      onlyBuild.push({key, title: screen.title});
      continue;
    }
    screens.push({
      key,
      title: screen.title,
      measures: SCREEN_MEASURES.map((measure) =>
        judge(measure, screen[measure], reference[measure], tolerances),
      ).filter(Boolean),
    });
  }
  const onlyBaseline = Object.entries(baseline.screens)
    .filter(([key]) => !build.screens[key])
    .map(([key, screen]) => ({key, title: screen.title}));
  return {app, screens, onlyBuild, onlyBaseline};
}

/**
 * The anomalies of a comparison as findings: one per measure, per screen
 * or the app, per build.
 */
export function baselineFindings(comparison, {appId, build, baseline}) {
  const findings = [];
  const add = (judged, screenKey, screenTitle) => {
    if (judged.verdict !== 'worse') {
      return;
    }
    const percent = Math.round(judged.share * 100);
    findings.push({
      ...makeFinding({
        tool: 'perf',
        rule: 'perf-regression',
        severity: judged.severity,
        subject: `${screenKey ?? 'app'}|${judged.measure}`,
        scope: `${appId}|${buildLabel(build.build)}|${build.build.kind}`,
        params: {
          measure: judged.measure,
          screen: screenTitle ?? '',
          percent,
          // CPU is a share already: its change is in percentage points
          points: judged.unit === 'percent' ? Math.round(judged.change * 10) / 10 : null,
          build: buildLabel(build.build),
          reference: buildLabel(baseline.build),
        },
      }),
      textKey: screenTitle ? `perf-regression-${judged.measure}` : `perf-regression-app-${judged.measure}`,
      count: 1,
    });
  };
  for (const judged of comparison.app) {
    add(judged, null, null);
  }
  for (const screen of comparison.screens) {
    for (const judged of screen.measures) {
      add(judged, screen.key, screen.title);
    }
  }
  return findings;
}

/**
 * How a measure went from build to build, oldest first: the median of each
 * build's runs on one device and kind, for the app or one screen.
 */
export function trend(runs, {platform, device, kind}, measure, screenKey = null) {
  const builds = [];
  const sorted = runs
    .filter((run) => run.platform === platform && run.device === device && run.build.kind === kind)
    .sort((a, b) => a.startedAt - b.startedAt);
  for (const run of sorted) {
    const known = builds.find((entry) => sameBuild(entry.build, run.build));
    if (known) {
      known.runs.push(run);
    } else {
      builds.push({build: run.build, runs: [run]});
    }
  }
  return builds
    .map(({build, runs: own}) => {
      const values = own.map((run) =>
        screenKey ? run.summary.screens[screenKey]?.[measure] : run.summary.app[measure],
      );
      return {build, value: median(values), runs: own.length, lastRunId: own.at(-1).id};
    })
    .filter((point) => point.value !== null);
}

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * A run as CSV: a line a second with the screen it was on, after a few
 * lines saying what was measured.
 */
export function runCsv({run, samples, markers, endAt}) {
  const segments = screenSegments(markers, endAt);
  const header = [
    `# app,${csvCell(run.appId)}`,
    `# device,${csvCell(run.device)},${csvCell(run.os)}`,
    `# build,${csvCell(buildLabel(run.build))},${csvCell(run.build.kind)}`,
    'seconds,cpu_percent,memory_mb,threads,screen',
  ];
  const rows = samples.map((sample) => {
    const screen = segments.find((segment) => sample.at >= segment.from && sample.at < segment.to);
    return [
      ((sample.at - run.startedAt) / 1000).toFixed(0),
      typeof sample.cpu === 'number' ? sample.cpu.toFixed(1) : '',
      typeof sample.memory === 'number' ? (sample.memory / MB).toFixed(1) : '',
      sample.threads ?? '',
      csvCell(screen?.title ?? ''),
    ].join(',');
  });
  return `${[...header, ...rows].join('\n')}\n`;
}
