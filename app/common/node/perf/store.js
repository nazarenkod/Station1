import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {groupKey, makeBaseline, makeRun, MAX_RUNS, runsOfBuild} from '../../shared/perf/baseline.js';
import {isAppId} from '../../shared/perf/parsers.js';

const emptyIndex = () => ({runs: [], baselines: {}});

/**
 * The runs and references of each app on this Mac: an index per app with the
 * summaries and the references, and the graphs of each run in a file of its
 * own, so the index stays small. Only the last MAX_RUNS runs are kept.
 */
export function createPerfStore(dir) {
  const appDir = (appId) => {
    if (!isAppId(appId)) {
      throw new Error(`not an app id: ${appId}`);
    }
    return path.join(dir, appId);
  };
  const indexFile = (appId) => path.join(appDir(appId), 'index.json');
  const runFile = (appId, id) => path.join(appDir(appId), 'runs', `${String(id).replace(/[^\w-]/g, '')}.json`);

  async function readIndex(appId) {
    // an id that is not an app's is refused, not read as an empty history
    const file = indexFile(appId);
    try {
      return {...emptyIndex(), ...JSON.parse(await readFile(file, 'utf8'))};
    } catch {
      return emptyIndex();
    }
  }

  async function writeIndex(appId, index) {
    await mkdir(appDir(appId), {recursive: true});
    await writeFile(indexFile(appId), JSON.stringify(index));
  }

  return {
    readIndex,

    /**
     * Keeps a finished run: its summary in the index, its graphs in a file.
     * Returns the run kept, or null when it was too short.
     */
    async saveRun({samples, markers, ...meta}) {
      const run = makeRun({...meta, samples, markers});
      if (!run) {
        return null;
      }
      const index = await readIndex(run.appId);
      index.runs = [...index.runs.filter((other) => other.id !== run.id), run];
      const dropped = index.runs.length > MAX_RUNS ? index.runs.splice(0, index.runs.length - MAX_RUNS) : [];
      await mkdir(path.dirname(runFile(run.appId, run.id)), {recursive: true});
      await writeFile(runFile(run.appId, run.id), JSON.stringify({samples, markers}));
      await writeIndex(run.appId, index);
      await Promise.all(dropped.map((old) => rm(runFile(run.appId, old.id), {force: true})));
      return run;
    },

    /** The graphs of one run, or null when they are gone. */
    async readRun(appId, id) {
      try {
        return JSON.parse(await readFile(runFile(appId, id), 'utf8'));
      } catch {
        return null;
      }
    },

    async deleteRun(appId, id) {
      const index = await readIndex(appId);
      index.runs = index.runs.filter((run) => run.id !== id);
      await writeIndex(appId, index);
      await rm(runFile(appId, id), {force: true});
      return index;
    },

    /**
     * Makes the build of a run the reference of its device and kind, from its
     * last runs. The reference it replaces goes into the history.
     */
    async setBaseline(appId, runId, settings, now = Date.now()) {
      const index = await readIndex(appId);
      const run = index.runs.find((other) => other.id === runId);
      if (!run) {
        return {index, missing: settings.baselineRuns};
      }
      const {baseline, missing} = makeBaseline(runsOfBuild(index.runs, run), settings, now);
      if (!baseline) {
        return {index, missing};
      }
      const key = groupKey(run);
      const was = index.baselines[key];
      index.baselines[key] = {
        current: baseline,
        history: [...(was?.history ?? []), ...(was?.current ? [was.current] : [])],
      };
      await writeIndex(appId, index);
      return {index};
    },
  };
}
