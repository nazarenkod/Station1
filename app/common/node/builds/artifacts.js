import {mkdir, readdir, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {runTool} from '../doctor/exec.js';
import {withZip} from './zip.js';

const BUILD_FILE = /\.(apk|aab|ipa)$/i;
const APP_INFO = /^(.*?\.app)\/Info\.plist$/;
const KEEP_JOBS = 5;

/**
 * The builds inside an artifacts archive: APK, AAB and IPA files, and
 * simulator .app folders (found by their Info.plist).
 */
export function buildsInEntries(names) {
  const files = names.filter((name) => BUILD_FILE.test(name) && !name.endsWith('/'));
  const apps = names
    .map((name) => APP_INFO.exec(name)?.[1])
    .filter((app) => app && !app.slice(0, -4).includes('.app/'));
  return [...files, ...new Set(apps)].map((name) => ({
    entry: name,
    name: path.basename(name),
    folder: !BUILD_FILE.test(name),
  }));
}

export async function listArchiveBuilds(zipPath) {
  return await withZip(zipPath, async (zip) => buildsInEntries(zip.entries.map((entry) => entry.name)));
}

/**
 * Takes one build out of the archive into `dir`; returns its path.
 */
export async function extractArchiveBuild(zipPath, candidate, dir) {
  await mkdir(dir, {recursive: true});
  if (!candidate.folder) {
    const target = path.join(dir, path.basename(candidate.entry));
    await withZip(zipPath, async (zip) => {
      const entry = zip.find(candidate.entry);
      if (!entry) {
        throw new Error(`${candidate.entry} is not in the artifacts`);
      }
      await writeFile(target, await zip.readEntry(entry));
    });
    return target;
  }
  // an app folder keeps its file modes (the executable): unzip restores them
  const result = await runTool('unzip', ['-q', '-o', zipPath, `${candidate.entry}/*`, '-d', dir], {
    timeout: 5 * 60 * 1000,
  });
  if (!result.ok) {
    throw new Error(result.stderr.trim() || `Cannot unpack ${candidate.entry}`);
  }
  return path.join(dir, candidate.entry);
}

/**
 * Where downloaded artifacts live: one folder per job, the latest few kept.
 */
export class ArtifactCache {
  constructor(root) {
    this.root = root;
  }

  jobDir(jobId) {
    return path.join(this.root, `job-${jobId}`);
  }

  archive(jobId) {
    return path.join(this.jobDir(jobId), 'artifacts.zip');
  }

  async has(jobId) {
    return await stat(this.archive(jobId))
      .then((s) => s.size > 0)
      .catch(() => false);
  }

  async prepare(jobId) {
    await mkdir(this.jobDir(jobId), {recursive: true});
    await this.prune(jobId);
  }

  async prune(keepJobId) {
    const dirs = await readdir(this.root).catch(() => []);
    const jobs = await Promise.all(
      dirs
        .filter((name) => name.startsWith('job-') && name !== `job-${keepJobId}`)
        .map(async (name) => ({name, mtime: (await stat(path.join(this.root, name))).mtimeMs})),
    );
    const stale = jobs.sort((a, b) => b.mtime - a.mtime).slice(KEEP_JOBS - 1);
    await Promise.all(stale.map(({name}) => rm(path.join(this.root, name), {recursive: true, force: true})));
  }
}
