import {checkManifest} from '../../shared/findings/manifest-rules.js';
import {BUILDS_HISTORY} from '../../shared/setting-defs.js';
import {backend, getSetting, setSetting} from '../polyfills.js';
import {activeDevice, refreshApps, selectApp} from './Workstation.js';

export const SET_BUILD = 'SET_BUILD';
export const SET_BUILD_INSTALL = 'SET_BUILD_INSTALL';
export const SET_BUILDS_HISTORY = 'SET_BUILDS_HISTORY';
export const SET_GITLAB_BUILDS = 'SET_GITLAB_BUILDS';
export const SET_GITLAB_FETCH = 'SET_GITLAB_FETCH';

const MAX_HISTORY = 10;

export function loadBuildsHistory() {
  return async (dispatch) => {
    dispatch({type: SET_BUILDS_HISTORY, history: (await getSetting(BUILDS_HISTORY)) ?? []});
  };
}

async function remember(dispatch, getState, build, source) {
  const entry = {
    file: build.file,
    fileName: build.fileName,
    platform: build.platform,
    appId: build.appId,
    version: build.version,
    build: build.build,
    source,
    openedAt: Date.now(),
  };
  const history = [entry, ...getState().builds.history.filter((item) => item.file !== build.file)].slice(
    0,
    MAX_HISTORY,
  );
  dispatch({type: SET_BUILDS_HISTORY, history});
  await setSetting(BUILDS_HISTORY, history);
}

/**
 * Reads a build file and checks its manifest. `source` tells where it came
 * from: a file on disk or a GitLab job.
 */
export function openBuild(file, source = {kind: 'file'}) {
  return async (dispatch, getState) => {
    dispatch({type: SET_BUILD, current: {status: 'reading', file}});
    dispatch({type: SET_BUILD_INSTALL, install: {status: 'idle'}});
    const result = await backend.builds.inspect(file);
    if (!result.ok) {
      dispatch({type: SET_BUILD, current: {status: 'error', file, code: result.code, error: result.error}});
      return;
    }
    const findings = checkManifest(result.build);
    dispatch({type: SET_BUILD, current: {status: 'ready', file, build: result.build, findings, source}});
    await remember(dispatch, getState, result.build, source);
  };
}

export function pickBuild() {
  return async (dispatch) => {
    const file = await backend.builds.pick();
    if (file) {
      await dispatch(openBuild(file));
    }
  };
}

/**
 * Installs the open build on the active device, then makes its app the
 * workstation's app. `replace` removes the installed app first (its data
 * goes too), for a build signed with another key.
 */
export function installBuild({allowDowngrade = false, replace = false} = {}) {
  return async (dispatch, getState) => {
    const {build} = getState().builds.current;
    const device = activeDevice(getState().workstation);
    if (!build || !device) {
      return;
    }
    dispatch({type: SET_BUILD_INSTALL, install: {status: 'installing', deviceId: device.id}});
    if (replace) {
      await backend.builds.uninstall(device, build.appId);
    }
    const result = await backend.builds.install(device, build.file, {allowDowngrade});
    dispatch({
      type: SET_BUILD_INSTALL,
      install: result.ok
        ? {status: 'done', deviceId: device.id}
        : {status: 'failed', deviceId: device.id, reason: result.reason, code: result.code, error: result.error},
    });
    if (result.ok) {
      // what was just installed is known exactly, whatever the device reports
      await dispatch(selectApp(build.appId, {name: build.name, version: build.version, build: build.build}));
      await dispatch(refreshApps());
    }
  };
}

export function loadGitlabBuilds() {
  return async (dispatch) => {
    if (!backend.gitlab || !(await backend.gitlab.hasToken())) {
      dispatch({type: SET_GITLAB_BUILDS, gitlab: {status: 'off', builds: []}});
      return;
    }
    dispatch({type: SET_GITLAB_BUILDS, gitlab: {status: 'loading', builds: []}});
    const result = await backend.builds.gitlabList();
    dispatch({
      type: SET_GITLAB_BUILDS,
      gitlab: result.ok ? {status: 'ok', builds: result.builds} : {status: 'error', builds: [], error: result.error},
    });
  };
}

/**
 * Takes a build out of a GitLab job: downloads the artifacts once, then
 * opens the build inside, or asks which one when there are several.
 */
export function fetchGitlabBuild(job, candidate = null) {
  return async (dispatch) => {
    dispatch({type: SET_GITLAB_FETCH, fetch: {status: 'downloading', jobId: job.jobId}});
    const unsubscribe = backend.builds.onProgress((progress) => {
      if (progress.jobId === job.jobId) {
        dispatch({type: SET_GITLAB_FETCH, fetch: {status: 'downloading', jobId: job.jobId, progress}});
      }
    });
    try {
      let chosen = candidate;
      if (!chosen) {
        const listed = await backend.builds.gitlabFetch(job.jobId);
        if (!listed.ok) {
          dispatch({type: SET_GITLAB_FETCH, fetch: {status: 'failed', jobId: job.jobId, error: listed.error}});
          return;
        }
        if (!listed.candidates.length) {
          dispatch({type: SET_GITLAB_FETCH, fetch: {status: 'empty', jobId: job.jobId}});
          return;
        }
        if (listed.candidates.length > 1) {
          dispatch({
            type: SET_GITLAB_FETCH,
            fetch: {status: 'choose', jobId: job.jobId, job, candidates: listed.candidates},
          });
          return;
        }
        [chosen] = listed.candidates;
      }
      dispatch({type: SET_GITLAB_FETCH, fetch: {status: 'extracting', jobId: job.jobId}});
      const extracted = await backend.builds.gitlabExtract(job.jobId, chosen);
      if (!extracted.ok) {
        dispatch({type: SET_GITLAB_FETCH, fetch: {status: 'failed', jobId: job.jobId, error: extracted.error}});
        return;
      }
      dispatch({type: SET_GITLAB_FETCH, fetch: {status: 'idle'}});
      await dispatch(openBuild(extracted.file, {kind: 'gitlab', jobId: job.jobId, job: job.name, ref: job.ref}));
    } finally {
      unsubscribe();
    }
  };
}
