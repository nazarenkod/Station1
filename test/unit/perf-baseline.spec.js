import {mkdtemp, readdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {createPerfStore} from '../../app/common/node/perf/store.js';
import {
  baselineFindings,
  buildLabel,
  combineRuns,
  compareBuild,
  makeBaseline,
  makeRun,
  MAX_RUNS,
  perfSettings,
  pickBaseline,
  runCsv,
  summarizeRun,
  trend,
} from '../../app/common/shared/perf/baseline.js';
import {PERF_CONFIG} from '../../app/common/shared/setting-defs.js';
import {GROUPS, PROFILE_GROUPS} from '../../app/common/shared/settings/groups.js';

const MB = 1024 * 1024;
const T0 = 1_000_000;

/**
 * A run of 60 seconds: the login screen for 20 s, home for 20 s, login again.
 * Memory and CPU are flat on each screen, scaled by `factor`.
 */
function measured({factor = 1, extraHome = 0} = {}) {
  const samples = [];
  for (let i = 0; i < 60; i++) {
    const home = i >= 20 && i < 40;
    samples.push({
      at: T0 + i * 1000,
      cpu: (home ? 20 : 10) * factor,
      memory: ((home ? 200 : 100) + (home ? extraHome : 0)) * MB * factor,
      threads: 30,
    });
  }
  const markers = [
    {at: T0, kind: 'start', pid: 1},
    {at: T0, kind: 'screen', key: 'title:login', title: 'Login'},
    {at: T0 + 20000, kind: 'screen', key: 'title:home', title: 'Home'},
    {at: T0 + 40000, kind: 'screen', key: 'title:login', title: 'Login'},
    {at: T0 + 50000, kind: 'screen', key: 'layout:ab12', title: null},
  ];
  return {samples, markers, startedAt: T0, endAt: T0 + 60000};
}

const meta = (
  id,
  {version = '2.14.0', number = '1532', kind = 'release', device = 'Pixel 7', os: osVersion = '14'} = {},
) => ({
  id,
  appId: 'com.acme.wallet',
  platform: 'android',
  device,
  os: osVersion,
  build: {version, number, kind},
});

const run = (id, options = {}, shape = {}) => makeRun({...meta(id, options), ...measured(shape)});

describe('the summary of a run', () => {
  it('keeps the app as a whole and each named screen, with its visits', () => {
    const {app, screens} = summarizeRun({...measured(), endAt: T0 + 60000});
    expect(app.cpuAvg).toBeCloseTo((40 * 10 + 20 * 20) / 60);
    expect(app.memoryMax).toBe(200 * MB);
    expect(Object.keys(screens)).toEqual(['title:login', 'title:home']);
    expect(screens['title:login']).toMatchObject({title: 'Login', visits: 2, seconds: 30, memoryStart: 100 * MB});
    expect(screens['title:home']).toMatchObject({visits: 1, cpuAvg: 20, memoryMax: 200 * MB});
  });

  it('keeps no run shorter than 30 seconds', () => {
    const short = measured();
    expect(makeRun({...meta('a'), ...short, endAt: T0 + 20000})).toBeNull();
    expect(run('a').build).toEqual({version: '2.14.0', number: '1532', kind: 'release'});
    expect(buildLabel(run('a').build)).toBe('2.14.0 (1532)');
  });
});

describe('the reference', () => {
  const settings = perfSettings({});

  it('needs as many runs of the build as the project asks, and is their median with a spread', () => {
    expect(makeBaseline([run('a'), run('b')], settings)).toEqual({missing: 1});
    const runs = [run('a'), run('b', {}, {factor: 1.1}), run('c', {}, {factor: 0.9})];
    const {baseline} = makeBaseline(runs, settings, 42);
    expect(baseline.at).toBe(42);
    expect(baseline.runIds).toEqual(['a', 'b', 'c']);
    expect(baseline.screens['title:home'].memoryMax.value).toBe(200 * MB);
    expect(baseline.screens['title:home'].memoryMax.spread).toBeCloseTo(20 * MB);
  });

  it('takes the tolerances from the project, defaults where it has none', () => {
    expect(perfSettings({})).toMatchObject({tolerances: {memory: 0.15, cpu: 0.25, start: 0.1}, baselineRuns: 3});
    expect(perfSettings({tolerances: {memory: 0.3}, baselineRuns: 5}).tolerances.memory).toBe(0.3);
    expect(perfSettings({tolerances: {memory: 'x'}}).tolerances.memory).toBe(0.15);
  });

  it('goes with the project profile', () => {
    expect(PROFILE_GROUPS).toContain('perf');
    const saved = {tolerances: {memory: 0.2}};
    expect(GROUPS.perf.read({[PERF_CONFIG]: saved})).toEqual(saved);
    expect(GROUPS.perf.write(saved)).toEqual({[PERF_CONFIG]: saved});
    expect(GROUPS.perf.valid(saved)).toBe(true);
    expect(GROUPS.perf.valid('nope')).toBe(false);
  });
});

describe('a build against the reference', () => {
  const settings = perfSettings({});
  const reference = makeBaseline([run('a'), run('b'), run('c')], settings).baseline;

  it('calls worse only what passes the tolerance, the spread and a change too small to matter', () => {
    const worse = combineRuns([run('n1', {version: '2.15.0', number: '1600'}, {extraHome: 70})]);
    const comparison = compareBuild(worse, reference, settings.tolerances);
    const home = comparison.screens.find((screen) => screen.key === 'title:home');
    const memory = home.measures.find((judged) => judged.measure === 'memoryMax');
    expect(memory).toMatchObject({verdict: 'worse', severity: 'high', change: 70 * MB});
    expect(memory.share).toBeCloseTo(0.35);
    const login = comparison.screens.find((screen) => screen.key === 'title:login');
    expect(login.measures.every((judged) => judged.verdict === 'same')).toBe(true);

    const slightly = combineRuns([run('n2', {version: '2.15.0'}, {extraHome: 20})]);
    const mild = compareBuild(slightly, reference, settings.tolerances).screens.find((s) => s.key === 'title:home');
    expect(mild.measures.find((judged) => judged.measure === 'memoryMax').verdict).toBe('same');
  });

  it('shows the screens only one of them has, and does not count them', () => {
    const other = run('n', {version: '2.15.0'});
    other.summary.screens['title:new'] = {title: 'New', visits: 1, seconds: 5, cpuAvg: 99, memoryMax: 900 * MB};
    delete other.summary.screens['title:login'];
    const comparison = compareBuild(combineRuns([other]), reference, settings.tolerances);
    expect(comparison.onlyBuild).toEqual([{key: 'title:new', title: 'New'}]);
    expect(comparison.onlyBaseline).toEqual([{key: 'title:login', title: 'Login'}]);
  });

  it('makes one finding per measure, screen and build; memory twice past the tolerance is red', () => {
    const build = combineRuns([run('n', {version: '2.15.0', number: '1600'}, {factor: 1.5})]);
    const comparison = compareBuild(build, reference, settings.tolerances);
    const findings = baselineFindings(comparison, {appId: 'com.acme.wallet', build, baseline: reference});
    const ids = findings.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
    const memory = findings.find((finding) => finding.textKey === 'perf-regression-app-memoryMax');
    expect(memory).toMatchObject({
      severity: 'high',
      params: {percent: 50, build: '2.15.0 (1600)', reference: '2.14.0 (1532)'},
    });
    const cpu = findings.find((finding) => finding.textKey === 'perf-regression-cpuAvg');
    expect(cpu.severity).toBe('medium');
    // the same build compared again gives the same findings
    expect(
      baselineFindings(comparison, {appId: 'com.acme.wallet', build, baseline: reference}).map((f) => f.id),
    ).toEqual(ids);
  });

  it('compares debug only with debug, release with release, one device model with itself', () => {
    const baselines = {'android|Pixel 7|release': {current: reference}};
    expect(pickBaseline(baselines, combineRuns([run('d', {kind: 'debug'})]))).toEqual({
      reason: 'kind',
      available: ['release'],
    });
    expect(pickBaseline(baselines, combineRuns([run('s', {device: 'Galaxy S23'})]))).toEqual({
      reason: 'device',
      available: ['Pixel 7'],
    });
    expect(pickBaseline({}, combineRuns([run('x')]))).toEqual({reason: 'none'});
    const newer = pickBaseline(baselines, combineRuns([run('o', {os: '15'})]));
    expect(newer).toMatchObject({baseline: reference, osDiffers: true});
  });

  it('follows a measure from build to build, a point per build', () => {
    const runs = [
      run('a', {version: '2.14.0'}),
      run('b', {version: '2.14.0'}),
      {...run('c', {version: '2.15.0'}, {factor: 1.2}), startedAt: T0 + 1},
      run('d', {version: '2.15.0', kind: 'debug'}),
    ];
    const points = trend(runs, {platform: 'android', device: 'Pixel 7', kind: 'release'}, 'memoryMax', 'title:home');
    expect(points.map((point) => [point.build.version, point.value / MB, point.runs])).toEqual([
      ['2.14.0', 200, 2],
      ['2.15.0', 240, 1],
    ]);
  });

  it('saves a run as CSV with the screen of each second', () => {
    const data = measured();
    const csv = runCsv({run: run('a'), ...data});
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('# app,com.acme.wallet');
    expect(lines[2]).toBe('# build,2.14.0 (1532),release');
    expect(lines[3]).toBe('seconds,cpu_percent,memory_mb,threads,screen');
    expect(lines[4]).toBe('0,10.0,100.0,30,Login');
    expect(lines[4 + 25]).toBe('25,20.0,200.0,30,Home');
  });
});

describe('the runs kept on this Mac', () => {
  let dir = null;
  afterEach(async () => {
    if (dir) {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('keeps runs with their graphs, the last ones only, and a reference with its history', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'perf-store-'));
    const store = createPerfStore(dir);
    const settings = perfSettings({});
    const save = (id, options) => store.saveRun({...meta(id, options), ...measured()});

    expect(await store.saveRun({...meta('short'), ...measured(), endAt: T0 + 1000})).toBeNull();
    for (const id of ['a', 'b']) {
      await save(id);
    }
    expect((await store.setBaseline('com.acme.wallet', 'b', settings)).missing).toBe(1);
    await save('c');
    const {index} = await store.setBaseline('com.acme.wallet', 'c', settings);
    expect(index.baselines['android|Pixel 7|release'].current.runIds).toEqual(['a', 'b', 'c']);
    await save('d', {version: '2.15.0'});
    await save('e', {version: '2.15.0'});
    await save('f', {version: '2.15.0'});
    const next = await store.setBaseline('com.acme.wallet', 'f', settings);
    expect(next.index.baselines['android|Pixel 7|release'].history).toHaveLength(1);
    expect((await store.readRun('com.acme.wallet', 'a')).samples).toHaveLength(60);

    for (let i = 0; i < MAX_RUNS; i++) {
      await save(`z${i}`);
    }
    const kept = await store.readIndex('com.acme.wallet');
    expect(kept.runs).toHaveLength(MAX_RUNS);
    expect(await store.readRun('com.acme.wallet', 'a')).toBeNull();
    expect(await readdir(path.join(dir, 'com.acme.wallet', 'runs'))).toHaveLength(MAX_RUNS);
    await expect(store.readIndex('../../etc')).rejects.toThrow('not an app id');
  });
});
