import {useSyncExternalStore} from 'react';

import {
  chooseCandidate,
  likelyArtifactJobs,
  parsePipelineUrl,
  pickArtifactJob,
} from '../../../shared/builds/pipelines.js';
import {BUILD_JOBS, PIPELINE_WATCHES} from '../../../shared/setting-defs.js';
import {selectApp} from '../../actions/Workstation.js';
import i18n from '../../i18next.js';
import {backend, getSetting, setSetting} from '../../polyfills.js';
import {notification} from '../../utils/notification.js';

const POLL_MS = 10000;
// what is still on its way: the pipeline is asked again
const ACTIVE = new Set(['loading', 'waiting', 'manual', 'missing', 'retry']);

/**
 * The GitLab pipelines the Builds tool follows until their build is on the
 * devices chosen for it. A pipeline still running is asked every ten
 * seconds; once its job has finished, the artifacts are downloaded, the
 * build for the devices is taken out, and installed where it was sent.
 * Kept outside Redux, and on disk while unfinished, so a restart goes on.
 */
let state = {watches: [], jobs: {}};
const listeners = new Set();
let store = null;
let timer = null;

function publish(patch) {
  state = {...state, ...patch};
  for (const listener of listeners) {
    listener();
  }
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const usePipelineWatches = () => useSyncExternalStore(subscribe, () => state);

const find = (id) => state.watches.find((watch) => watch.id === id);

export const getWatch = find;

function update(id, patch) {
  publish({watches: state.watches.map((watch) => (watch.id === id ? {...watch, ...patch} : watch))});
  persist();
}

async function persist() {
  // what is done is not followed again after a restart
  const open = state.watches.filter((watch) => !['installed', 'failed', 'noArtifacts'].includes(watch.status));
  await setSetting(
    PIPELINE_WATCHES,
    open.map(({url, targets, autoInstall}) => ({url, targets, autoInstall})),
  );
}

const devices = () => store?.getState().workstation.devices ?? [];
const deviceById = (id) => devices().find((device) => device.id === id);
const platformOf = (device) => (/ios/i.test(device?.platformName ?? '') ? 'ios' : 'android');

/**
 * Starts following the pipelines left from the last run. Called once by the
 * workstation shell with the Redux store, for the devices and the app.
 */
export async function startPipelineWatches(reduxStore) {
  if (store || !backend.builds?.pipelineStatus) {
    return;
  }
  store = reduxStore;
  publish({jobs: (await getSetting(BUILD_JOBS)) ?? {}});
  for (const saved of (await getSetting(PIPELINE_WATCHES)) ?? []) {
    addWatch(saved.url, saved);
  }
  timer = setInterval(() => {
    for (const watch of state.watches) {
      if (ACTIVE.has(watch.status)) {
        refresh(watch.id);
      }
    }
  }, POLL_MS);
}

export function stopPipelineWatches() {
  clearInterval(timer);
  timer = null;
  store = null;
}

/**
 * Follows a pipeline from its link. Returns an error key when the text is
 * not a pipeline or job link; the same pipeline is not followed twice.
 */
export function addWatch(url, {targets, autoInstall = true} = {}) {
  const link = parsePipelineUrl(url);
  if (!link) {
    return {error: 'buildsPipelineBadLink'};
  }
  const id = `${link.project}#${link.pipelineId ?? `job-${link.jobId}`}`;
  if (find(id)) {
    return {id};
  }
  const active = store?.getState().workstation.deviceId;
  const watch = {
    id,
    url: url.trim(),
    link,
    targets: targets ?? (active && deviceById(active) ? [active] : []),
    autoInstall,
    status: 'loading',
    addedAt: Date.now(),
    installs: {},
  };
  publish({watches: [watch, ...state.watches]});
  persist();
  refresh(id);
  return {id};
}

/**
 * Opens the choice of jobs again, to change where the project's builds come from.
 */
export function editJobs(id) {
  const watch = find(id);
  const names = state.jobs[watch.link.project]?.jobs ?? likelyArtifactJobs(watch.jobs ?? []);
  update(id, {status: 'configure', suggested: names});
}

export function removeWatch(id) {
  publish({watches: state.watches.filter((watch) => watch.id !== id)});
  persist();
}

export function setTargets(id, targets) {
  update(id, {targets});
}

export function setAutoInstall(id, autoInstall) {
  update(id, {autoInstall});
  const watch = find(id);
  if (autoInstall && watch.status === 'ready') {
    install(id);
  }
}

/**
 * The jobs a project leaves its builds in, set once and used for every
 * pipeline of it.
 */
export async function saveProjectJobs(project, names) {
  const jobs = {...state.jobs, [project]: {...state.jobs[project], jobs: names}};
  publish({jobs});
  await setSetting(BUILD_JOBS, jobs);
  for (const watch of state.watches.filter((item) => item.link.project === project)) {
    update(watch.id, {status: 'loading', file: null, build: null});
    refresh(watch.id);
  }
}

async function rememberCandidate(project, name) {
  const jobs = {...state.jobs, [project]: {...state.jobs[project], candidate: name}};
  publish({jobs});
  await setSetting(BUILD_JOBS, jobs);
}

/**
 * Asks GitLab where the pipeline is, and takes the next step when its job
 * is done.
 */
export async function refresh(id) {
  const watch = find(id);
  if (!watch || watch.busy) {
    return;
  }
  const result = await backend.builds.pipelineStatus(watch.link);
  if (!find(id)) {
    return;
  }
  if (!result.ok) {
    // a link that cannot work stops; a network hiccup is tried again
    const final = ['otherSite', 'notFound', 'notSetUp'].includes(result.code);
    update(id, {status: final ? 'failed' : 'retry', error: result.error, errorCode: result.code});
    return;
  }
  const names = state.jobs[watch.link.project]?.jobs;
  const base = {pipeline: result.pipeline, jobs: result.jobs, error: null, errorCode: null};
  if (!names?.length) {
    update(id, {...base, status: 'configure', suggested: likelyArtifactJobs(result.jobs)});
    return;
  }
  const pick = pickArtifactJob(result.jobs, names);
  const running = ['created', 'pending', 'running', 'waiting_for_resource', 'preparing'].includes(
    result.pipeline.status,
  );
  if (pick.state === 'ready') {
    // the same job's build is already here: nothing new
    if (find(id).artifactJob?.id === pick.job.id && find(id).file) {
      update(id, base);
      return;
    }
    update(id, {...base, artifactJob: pick.job});
    await fetchBuild(id, pick.job);
    return;
  }
  const status = pick.state === 'missing' && !running ? 'noJobs' : pick.state;
  update(id, {...base, status, artifactJob: pick.job});
}

/**
 * Starts the manual job the build waits for.
 */
export async function playJob(id) {
  const watch = find(id);
  const job = watch?.artifactJob;
  if (!job) {
    return;
  }
  update(id, {status: 'waiting'});
  const result = await backend.builds.pipelinePlay({origin: watch.link.origin, project: job.project, jobId: job.id});
  if (!result.ok) {
    update(id, {status: 'manual', error: result.error});
    return;
  }
  setTimeout(() => refresh(id), 2000);
}

async function fetchBuild(id, job, candidate = null) {
  update(id, {status: 'downloading', busy: true, progress: null});
  const unsubscribe = backend.builds.onProgress((progress) => {
    if (progress.jobId === job.id) {
      update(id, {progress});
    }
  });
  try {
    let chosen = candidate;
    if (!chosen) {
      const listed = await backend.builds.gitlabFetch(job.id, job.project);
      if (!listed.ok) {
        update(id, {status: 'retry', error: listed.error});
        return;
      }
      if (!listed.candidates.length) {
        update(id, {status: 'noArtifacts'});
        return;
      }
      const watch = find(id);
      const targets = watch.targets.map(deviceById).filter(Boolean);
      chosen = chooseCandidate(listed.candidates, {
        platforms: [...new Set(targets.map(platformOf))],
        simulator: targets.some((device) => device.kind === 'ios-simulator'),
        remembered: state.jobs[watch.link.project]?.candidate,
      });
      if (!chosen) {
        update(id, {status: 'choose', candidates: listed.candidates});
        return;
      }
    }
    update(id, {status: 'extracting'});
    const extracted = await backend.builds.gitlabExtract(job.id, chosen);
    if (!extracted.ok) {
      update(id, {status: 'failed', error: extracted.error});
      return;
    }
    const read = await backend.builds.inspect(extracted.file);
    if (!read.ok) {
      update(id, {status: 'failed', error: read.error});
      return;
    }
    update(id, {status: 'ready', file: extracted.file, build: read.build, candidates: null, installs: {}});
    if (find(id).autoInstall && find(id).targets.length) {
      await install(id);
    }
  } finally {
    unsubscribe();
    update(id, {busy: false});
  }
}

/**
 * Takes the build a person picked from an archive with several, and
 * remembers the pick for the project's next pipelines.
 */
export async function chooseBuild(id, candidate) {
  const watch = find(id);
  await rememberCandidate(watch.link.project, candidate.name);
  await fetchBuild(id, watch.artifactJob, candidate);
}

/**
 * Installs the build on the devices it was sent to, or on one of them;
 * `replace` removes the app first, for a build signed with another key.
 */
export async function install(id, {deviceId = null, replace = false} = {}) {
  const watch = find(id);
  if (!watch?.file) {
    return;
  }
  const ids = deviceId ? [deviceId] : watch.targets;
  update(id, {status: 'installing'});
  for (const target of ids) {
    const device = deviceById(target);
    if (!device || device.state !== 'running') {
      update(id, {installs: {...find(id).installs, [target]: {status: 'offline'}}});
      continue;
    }
    update(id, {installs: {...find(id).installs, [target]: {status: 'installing'}}});
    if (replace) {
      await backend.builds.uninstall(device, watch.build.appId);
    }
    const result = await backend.builds.install(device, watch.file, {allowDowngrade: true});
    update(id, {
      installs: {
        ...find(id).installs,
        [target]: result.ok ? {status: 'done'} : {status: 'failed', reason: result.reason, error: result.error},
      },
    });
    if (result.ok && store?.getState().workstation.deviceId === target) {
      // the app just installed becomes the one the tools work with
      store.dispatch(
        selectApp(watch.build.appId, {name: watch.build.name, version: watch.build.version, build: watch.build.build}),
      );
    }
  }
  const installs = Object.values(find(id).installs);
  const done = installs.length > 0 && installs.every((item) => item.status === 'done');
  update(id, {status: done ? 'installed' : 'ready'});
  if (done) {
    announce(find(id));
  }
}

function announce(watch) {
  const names = watch.targets.map((target) => deviceById(target)?.name ?? target).join(', ');
  const title = i18n.t('buildsPipelineInstalled', {pipeline: watch.pipeline?.id ?? '', devices: names});
  notification.success({title, description: `${watch.build.appId} ${watch.build.version ?? ''}`});
  // someone waiting in another window hears of it too
  if (typeof document !== 'undefined' && document.hidden && typeof Notification !== 'undefined') {
    // oxlint-disable-next-line no-new
    new Notification(title, {body: `${watch.build.appId} ${watch.build.version ?? ''}`});
  }
}
