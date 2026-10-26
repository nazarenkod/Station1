import {useSyncExternalStore} from 'react';

import {
  chooseCandidate,
  DEVICE_KINDS,
  deviceKind,
  filePatternFor,
  jobsFor,
  likelyArtifactJobs,
  parsePipelineUrl,
  pickArtifactJob,
  ruleFor,
} from '../../../shared/builds/pipelines.js';
import {BUILD_JOBS, PIPELINE_WATCHES} from '../../../shared/setting-defs.js';
import {selectApp} from '../../actions/Workstation.js';
import i18n from '../../i18next.js';
import {backend, getSetting, setSetting} from '../../polyfills.js';
import {notification} from '../../utils/notification.js';

const POLL_MS = 10000;
// a build still on its way: the pipeline is asked again
const ACTIVE = new Set(['waiting', 'manual', 'missing', 'retry']);
// a build that is through, one way or the other
const FINISHED = new Set(['installed', 'failed', 'noArtifacts', 'noJobs']);

/**
 * The GitLab pipelines the Builds tool follows until their builds are on the
 * devices chosen for them. Simulators and emulators often take another
 * build than real devices (an .app, not an IPA), so each kind of device has
 * its own: its job, by the rules written once for the project in the
 * settings, its download and its installs. A pipeline still running is
 * asked every ten seconds. Kept outside Redux, and on disk while
 * unfinished, so a restart goes on.
 */
let state = {watches: [], sources: {rules: [], picks: {}}};
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
  if (!find(id)) {
    return;
  }
  publish({watches: state.watches.map((watch) => (watch.id === id ? {...watch, ...patch} : watch))});
  persist();
}

function updateBuild(id, kind, patch) {
  const watch = find(id);
  if (watch) {
    update(id, {builds: {...watch.builds, [kind]: {...watch.builds[kind], ...patch}}});
  }
}

const isDone = (watch) => {
  const builds = Object.values(watch.builds ?? {});
  return watch.status === 'failed' || (builds.length > 0 && builds.every((build) => FINISHED.has(build.status)));
};

async function persist() {
  // what is through is not followed again after a restart
  await setSetting(
    PIPELINE_WATCHES,
    state.watches.filter((watch) => !isDone(watch)).map(({url, targets, autoInstall}) => ({url, targets, autoInstall})),
  );
}

const devices = () => store?.getState().workstation.devices ?? [];
const deviceById = (id) => devices().find((device) => device.id === id);
const platformOf = (device) => (/ios/i.test(device?.platformName ?? '') ? 'ios' : 'android');

/**
 * The rules of where builds come from; the shape of before (jobs by
 * project) becomes rules.
 */
function readSources(saved) {
  if (Array.isArray(saved?.rules)) {
    return {rules: saved.rules, picks: saved.picks ?? {}};
  }
  const rules = Object.entries(saved ?? {}).map(([project, value]) => ({
    id: project,
    project,
    virtual: {jobs: value.jobs ?? [], file: ''},
    real: {jobs: [], file: ''},
  }));
  return {rules, picks: {}};
}

export async function loadBuildSources() {
  publish({sources: readSources(await getSetting(BUILD_JOBS))});
}

/**
 * Saves the rules of where builds come from; what waited for a rule goes on.
 */
export async function saveBuildSources(rules) {
  const sources = {...state.sources, rules};
  publish({sources});
  await setSetting(BUILD_JOBS, sources);
  for (const watch of state.watches) {
    if (['configure', 'failed'].includes(watch.status)) {
      update(watch.id, {status: 'loading'});
    }
    refresh(watch.id);
  }
}

/**
 * Starts following the pipelines left from the last run. Called once by the
 * workstation shell with the Redux store, for the devices and the app.
 */
export async function startPipelineWatches(reduxStore) {
  if (store || !backend.builds?.pipelineStatus) {
    return;
  }
  store = reduxStore;
  await loadBuildSources();
  for (const saved of (await getSetting(PIPELINE_WATCHES)) ?? []) {
    addWatch(saved.url, saved);
  }
  timer = setInterval(() => {
    for (const watch of state.watches) {
      const waiting = Object.values(watch.builds ?? {}).some((build) => ACTIVE.has(build.status));
      if (waiting || watch.status === 'retry') {
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
  publish({
    watches: [
      {
        id,
        url: url.trim(),
        link,
        targets: targets ?? (active && deviceById(active) ? [active] : []),
        autoInstall,
        status: 'loading',
        builds: {},
        addedAt: Date.now(),
      },
      ...state.watches,
    ],
  });
  persist();
  refresh(id);
  return {id};
}

export function removeWatch(id) {
  publish({watches: state.watches.filter((watch) => watch.id !== id)});
  persist();
}

export function setTargets(id, targets) {
  update(id, {targets});
  // a device of another kind needs a build of its own
  refresh(id);
}

export function setAutoInstall(id, autoInstall) {
  update(id, {autoInstall});
  if (autoInstall) {
    for (const [kind, build] of Object.entries(find(id).builds)) {
      if (build.status === 'ready') {
        install(id, {kind});
      }
    }
  }
}

/**
 * The kinds of device the pipeline's builds go to: those of the devices
 * chosen, or every kind the rule has jobs for when none is chosen yet.
 */
function kindsFor(watch, rule) {
  const chosen = new Set(watch.targets.map(deviceById).filter(Boolean).map(deviceKind));
  if (chosen.size) {
    return DEVICE_KINDS.filter((kind) => chosen.has(kind));
  }
  return DEVICE_KINDS.filter((kind) => rule?.[kind]?.jobs?.length);
}

export const targetsOf = (watch, kind) =>
  watch.targets.filter((target) => deviceKind(deviceById(target) ?? {kind: ''}) === kind);

/**
 * Asks GitLab where the pipeline is, and takes the next step for each kind
 * of device whose job is done.
 */
export async function refresh(id) {
  const watch = find(id);
  if (!watch || watch.refreshing) {
    return;
  }
  update(id, {refreshing: true});
  try {
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
    const rule = ruleFor(state.sources.rules, watch.link.project);
    update(id, {pipeline: result.pipeline, jobs: result.jobs, error: null, errorCode: null});
    if (!rule) {
      update(id, {status: 'configure', suggested: likelyArtifactJobs(result.jobs)});
      return;
    }
    update(id, {status: 'tracking', rule: rule.project});
    const running = ['created', 'pending', 'running', 'waiting_for_resource', 'preparing'].includes(
      result.pipeline.status,
    );
    for (const kind of kindsFor(find(id), rule)) {
      const pick = pickArtifactJob(result.jobs, jobsFor(rule, kind));
      const current = find(id).builds[kind] ?? {};
      if (pick.state === 'ready') {
        // the same job's build is already here: nothing new
        if (current.job?.id !== pick.job.id || !current.file) {
          await fetchBuild(id, kind, pick.job);
        }
        continue;
      }
      updateBuild(id, kind, {
        status: pick.state === 'missing' ? (running ? 'missing' : 'noJobs') : pick.state,
        job: pick.job,
      });
    }
  } finally {
    update(id, {refreshing: false});
  }
}

/**
 * Starts the manual job a kind of device waits for.
 */
export async function playJob(id, kind) {
  const watch = find(id);
  const job = watch?.builds[kind]?.job;
  if (!job) {
    return;
  }
  updateBuild(id, kind, {status: 'waiting', error: null});
  const result = await backend.builds.pipelinePlay({origin: watch.link.origin, project: job.project, jobId: job.id});
  if (!result.ok) {
    updateBuild(id, kind, {status: 'manual', error: result.error});
    return;
  }
  setTimeout(() => refresh(id), 2000);
}

const pickKey = (project, kind) => `${project}|${kind}`;

async function fetchBuild(id, kind, job, candidate = null) {
  updateBuild(id, kind, {status: 'downloading', job, progress: null, file: null, build: null, installs: {}});
  const unsubscribe = backend.builds.onProgress((progress) => {
    if (progress.jobId === job.id) {
      updateBuild(id, kind, {progress});
    }
  });
  try {
    let chosen = candidate;
    if (!chosen) {
      const listed = await backend.builds.gitlabFetch(job.id, job.project);
      if (!listed.ok) {
        updateBuild(id, kind, {status: 'retry', error: listed.error});
        return;
      }
      const watch = find(id);
      const rule = ruleFor(state.sources.rules, watch.link.project);
      const targets = targetsOf(watch, kind).map(deviceById).filter(Boolean);
      chosen = chooseCandidate(listed.candidates, {
        platforms: [...new Set(targets.map(platformOf))],
        simulator: kind === 'virtual',
        remembered: state.sources.picks[pickKey(watch.link.project, kind)],
        file: filePatternFor(rule, kind),
      });
      if (!chosen) {
        updateBuild(
          id,
          kind,
          listed.candidates.length ? {status: 'choose', candidates: listed.candidates} : {status: 'noArtifacts'},
        );
        return;
      }
    }
    updateBuild(id, kind, {status: 'extracting', candidates: null});
    const extracted = await backend.builds.gitlabExtract(job.id, chosen);
    const read = extracted.ok ? await backend.builds.inspect(extracted.file) : extracted;
    if (!read.ok) {
      updateBuild(id, kind, {status: 'failed', error: read.error});
      return;
    }
    updateBuild(id, kind, {status: 'ready', file: extracted.file, build: read.build});
    if (find(id).autoInstall && targetsOf(find(id), kind).length) {
      await install(id, {kind});
    }
  } finally {
    unsubscribe();
  }
}

/**
 * Takes the build a person picked from an archive with several, and
 * remembers the pick for the project's next pipelines.
 */
export async function chooseBuild(id, kind, candidate) {
  const watch = find(id);
  const picks = {...state.sources.picks, [pickKey(watch.link.project, kind)]: candidate.name};
  publish({sources: {...state.sources, picks}});
  await setSetting(BUILD_JOBS, state.sources);
  await fetchBuild(id, kind, watch.builds[kind].job, candidate);
}

/**
 * Installs a kind's build on its devices, or on one of them; `replace`
 * removes the app first, for a build signed with another key.
 */
export async function install(id, {kind, deviceId = null, replace = false}) {
  const watch = find(id);
  const build = watch?.builds[kind];
  if (!build?.file) {
    return;
  }
  updateBuild(id, kind, {status: 'installing'});
  const installs = () => find(id).builds[kind].installs ?? {};
  for (const target of deviceId ? [deviceId] : targetsOf(watch, kind)) {
    const device = deviceById(target);
    if (device?.state !== 'running') {
      updateBuild(id, kind, {installs: {...installs(), [target]: {status: 'offline'}}});
      continue;
    }
    updateBuild(id, kind, {installs: {...installs(), [target]: {status: 'installing'}}});
    if (replace) {
      await backend.builds.uninstall(device, build.build.appId);
    }
    const result = await backend.builds.install(device, build.file, {allowDowngrade: true});
    updateBuild(id, kind, {
      installs: {
        ...installs(),
        [target]: result.ok ? {status: 'done'} : {status: 'failed', reason: result.reason, error: result.error},
      },
    });
    if (result.ok && store?.getState().workstation.deviceId === target) {
      // the app just installed becomes the one the tools work with
      store.dispatch(
        selectApp(build.build.appId, {name: build.build.name, version: build.build.version, build: build.build.build}),
      );
    }
  }
  const results = Object.values(installs());
  const done = results.length > 0 && results.every((item) => item.status === 'done');
  updateBuild(id, kind, {status: done ? 'installed' : 'ready'});
  if (done) {
    announce(find(id), kind);
  }
}

function announce(watch, kind) {
  const build = watch.builds[kind].build;
  const names = targetsOf(watch, kind)
    .map((target) => deviceById(target)?.name ?? target)
    .join(', ');
  const title = i18n.t('buildsPipelineInstalled', {pipeline: watch.pipeline?.id ?? '', devices: names});
  const body = `${build.appId} ${build.version ?? ''}`;
  notification.success({title, description: body});
  // someone waiting in another window hears of it too
  if (typeof document !== 'undefined' && document.hidden && typeof Notification !== 'undefined') {
    // oxlint-disable-next-line no-new
    new Notification(title, {body});
  }
}
