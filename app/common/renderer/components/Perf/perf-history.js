import {useSyncExternalStore} from 'react';

import {
  baselineFindings,
  combineRuns,
  compareBuild,
  perfSettings,
  pickBaseline,
  runsOfBuild,
} from '../../../shared/perf/baseline.js';
import {perfConfig} from '../../lib/settings/views.js';
import {backend} from '../../polyfills.js';
import {onRunKept, showRun} from './perf-store.js';

/**
 * The kept runs of the app and its references, as the screens see them: the
 * main process keeps them on this Mac, this store reads them for the app in
 * the title bar and says which run is picked.
 */
let state = {version: 0, appId: null, runs: [], baselines: {}, selectedId: null, loading: false};
const listeners = new Set();
let started = false;

function publish(patch) {
  state = {...state, ...patch, version: state.version + 1};
  for (const listener of listeners) {
    listener();
  }
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const usePerfHistory = () => useSyncExternalStore(subscribe, () => state);
export const perfHistory = () => state;

function apply(index, selectedId = state.selectedId) {
  const runs = index?.runs ?? [];
  publish({
    runs,
    baselines: index?.baselines ?? {},
    // the picked run, else the last one
    selectedId: runs.some((run) => run.id === selectedId) ? selectedId : (runs.at(-1)?.id ?? null),
    loading: false,
  });
}

/** Reads the runs of an app, when it is another one or `force`. */
export async function loadPerfHistory(appId, {force = false} = {}) {
  if (!backend.perf?.history) {
    return;
  }
  if (!started) {
    started = true;
    // a run just kept is picked
    onRunKept((run) => {
      if (run.appId === state.appId) {
        loadPerfHistory(run.appId, {force: true}).then(() => publish({selectedId: run.id}));
      }
    });
  }
  if (!appId) {
    publish({appId: null, runs: [], baselines: {}, selectedId: null});
    return;
  }
  if (appId === state.appId && !force) {
    return;
  }
  publish({appId, loading: true, ...(appId === state.appId ? {} : {runs: [], baselines: {}, selectedId: null})});
  apply(await backend.perf.history(appId).catch(() => null));
}

export const selectRun = (id) => publish({selectedId: id});

/** Opens a kept run in place of the live graphs. */
export async function openRun(id) {
  const run = state.runs.find((item) => item.id === id);
  const data = run && (await backend.perf.run(run.appId, run.id).catch(() => null));
  if (data) {
    selectRun(id);
    showRun(run, data);
  }
  return !!data;
}

export async function deleteRun(id) {
  apply(await backend.perf.deleteRun(state.appId, id));
}

/** Makes the build of a run the reference; says how many runs are missing when it cannot. */
export async function makeReference(id) {
  const result = await backend.perf.setBaseline(state.appId, id, perfConfig.get());
  apply(result.index);
  return result.missing ?? 0;
}

/**
 * What the picked run's build looks like against its reference: the build
 * as the median of its runs, the reference picked for it (or why none), the
 * comparison and its findings.
 */
export function buildReport(history, settings) {
  const run = history.runs.find((item) => item.id === history.selectedId);
  if (!run) {
    return null;
  }
  const runs = runsOfBuild(history.runs, run);
  const build = combineRuns(runs);
  const picked = pickBaseline(history.baselines, build);
  const {tolerances, baselineRuns} = perfSettings(settings);
  if (!picked.baseline) {
    return {run, runs, build, picked, baselineRuns, comparison: null, findings: []};
  }
  // a build compared with itself has nothing to say
  const isReference = picked.baseline.runIds.some((id) => runs.some((item) => item.id === id));
  const comparison = compareBuild(build, picked.baseline, tolerances);
  return {
    run,
    runs,
    build,
    picked,
    baselineRuns,
    isReference,
    comparison,
    findings: isReference ? [] : baselineFindings(comparison, {appId: run.appId, build, baseline: picked.baseline}),
  };
}

/**
 * The anomalies of the app's last build against its reference, for the
 * desk: the last run decides which build that is.
 */
export function lastBuildFindings(history, settings) {
  const last = history.runs.at(-1);
  return last ? (buildReport({...history, selectedId: last.id}, settings)?.findings ?? []) : [];
}
