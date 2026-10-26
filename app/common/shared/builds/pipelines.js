/**
 * What a GitLab link points at: the site, the project's path and the
 * pipeline (or a job of it). Null for anything else.
 */
export function parsePipelineUrl(text) {
  let url;
  try {
    url = new URL(String(text).trim());
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/(.+?)\/-\/(pipelines|jobs)\/(\d+)/);
  if (!match || !/^https?:$/.test(url.protocol)) {
    return null;
  }
  const [, project, kind, id] = match;
  return {
    origin: url.origin,
    project: decodeURIComponent(project),
    ...(kind === 'pipelines' ? {pipelineId: Number(id)} : {jobId: Number(id)}),
  };
}

// a job that is going to finish by itself, unlike one waiting for a click
const WAITING = new Set(['created', 'pending', 'running', 'waiting_for_resource', 'preparing', 'scheduled']);

const hasArchive = (job) => (job.artifacts ?? []).some((artifact) => artifact.file_type === 'archive');

/**
 * Which of the pipeline's jobs to take the build from, by the names set for
 * the project, in their order: the first that finished with artifacts; else
 * what is still to come — running ones to wait for, or manual ones to start.
 */
export function pickArtifactJob(jobs, names) {
  const wanted = names
    .map((name) => jobs.filter((job) => job.name === name).sort((a, b) => b.id - a.id)[0])
    .filter(Boolean);
  if (!wanted.length) {
    return {state: 'missing', job: null, jobs: []};
  }
  const ready = wanted.find((job) => job.status === 'success' && hasArchive(job));
  if (ready) {
    return {state: 'ready', job: ready, jobs: wanted};
  }
  const running = wanted.find((job) => WAITING.has(job.status));
  if (running) {
    return {state: 'waiting', job: running, jobs: wanted};
  }
  const manual = wanted.find((job) => job.status === 'manual');
  if (manual) {
    return {state: 'manual', job: manual, jobs: wanted};
  }
  const done = wanted.find((job) => job.status === 'success');
  if (done) {
    return {state: 'noArtifacts', job: done, jobs: wanted};
  }
  return {state: 'failed', job: wanted[0], jobs: wanted};
}

/**
 * The jobs a project probably builds in, to tick at first: those that left
 * artifacts, or whose name says they build or package.
 */
export function likelyArtifactJobs(jobs) {
  const names = new Set();
  for (const job of jobs) {
    if (hasArchive(job) || /build|package|assemble|apk|ipa|bundle|archive/i.test(job.name)) {
      names.add(job.name);
    }
  }
  return [...names];
}

const normalized = (name) => name.toLowerCase().replace(/\d+/g, '#');

/**
 * The build to take out of an archive for the devices it goes to: what the
 * devices can install (APK for Android; an .app for a simulator, an IPA for
 * an iPhone), the one picked last time for this project, then a universal
 * or the smallest name. Null when it is not clear: then a person chooses.
 */
export function chooseCandidate(candidates, {platforms = [], simulator = false, remembered = null} = {}) {
  const installable = candidates.filter((candidate) => {
    const name = candidate.name.toLowerCase();
    if (name.endsWith('.aab')) {
      return false;
    }
    if (!platforms.length) {
      return true;
    }
    return (
      (platforms.includes('android') && name.endsWith('.apk')) ||
      (platforms.includes('ios') && (simulator ? candidate.folder : name.endsWith('.ipa')))
    );
  });
  if (installable.length === 1) {
    return installable[0];
  }
  if (remembered) {
    const same = installable.find((candidate) => normalized(candidate.name) === normalized(remembered));
    if (same) {
      return same;
    }
  }
  const universal = installable.filter((candidate) => /universal/i.test(candidate.name));
  return universal.length === 1 ? universal[0] : null;
}
