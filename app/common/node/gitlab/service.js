import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const REQUEST_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const PROGRESS_INTERVAL_MS = 250;

export const GITLAB_DEFAULTS = {
  url: '',
  project: '',
};

const message = (error) => (error instanceof Error ? error.message : String(error));

/**
 * The GitLab site the builds come from: the account behind the access token
 * and the project whose pipelines produce the APK and IPA files.
 */
export class GitLabService {
  constructor({getSettings, getToken, fetchImpl = globalThis.fetch}) {
    this.getSettings = getSettings;
    this.getToken = getToken;
    this.fetchImpl = fetchImpl;
  }

  async connection() {
    const settings = {...GITLAB_DEFAULTS, ...(await this.getSettings())};
    const token = await this.getToken();
    if (!settings.url || !token) {
      throw new Error('GitLab is not set up: add the site and an access token');
    }
    return {settings, token, base: `${settings.url.replace(/\/+$/, '')}/api/v4`};
  }

  async request({base, token}, path) {
    const response = await this.fetchImpl(`${base}${path}`, {
      headers: {'PRIVATE-TOKEN': token, Accept: 'application/json'},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const reason = response.status === 401 ? 'the token is wrong or expired' : `HTTP ${response.status}`;
      throw new Error(`GitLab answered: ${reason}`);
    }
    return await response.json();
  }

  projectPath(connection) {
    const project = connection.settings.project.trim();
    if (!project) {
      throw new Error('Choose the GitLab project the builds come from');
    }
    return `/projects/${encodeURIComponent(project)}`;
  }

  /**
   * The latest successful jobs that kept artifacts, newest first: where a
   * build to install can come from.
   */
  async listBuilds({limit = 20} = {}) {
    try {
      const connection = await this.connection();
      const jobs = await this.request(connection, `${this.projectPath(connection)}/jobs?scope[]=success&per_page=100`);
      const builds = jobs
        .map((job) => ({job, archive: (job.artifacts ?? []).find((a) => a.file_type === 'archive')}))
        .filter(({archive}) => archive)
        .slice(0, limit)
        .map(({job, archive}) => ({
          jobId: job.id,
          name: job.name,
          stage: job.stage,
          ref: job.ref,
          pipelineId: job.pipeline?.id ?? null,
          commit: job.commit?.title ?? '',
          author: job.user?.name ?? job.commit?.author_name ?? '',
          finishedAt: job.finished_at ?? job.created_at,
          size: archive.size ?? null,
          webUrl: job.web_url,
        }));
      return {ok: true, builds};
    } catch (error) {
      return {ok: false, error: message(error)};
    }
  }

  /**
   * Downloads the artifacts archive of a job to `file`.
   */
  async downloadArtifacts(jobId, file, {onProgress} = {}) {
    const connection = await this.connection();
    const response = await this.fetchImpl(`${connection.base}${this.projectPath(connection)}/jobs/${jobId}/artifacts`, {
      headers: {'PRIVATE-TOKEN': connection.token},
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`GitLab answered: HTTP ${response.status}`);
    }
    const total = Number(response.headers.get('content-length')) || null;
    let received = 0;
    let reportedAt = 0;
    const body = Readable.fromWeb(response.body);
    body.on('data', (chunk) => {
      received += chunk.length;
      // a few updates a second are enough for a progress bar
      if (Date.now() - reportedAt > PROGRESS_INTERVAL_MS) {
        reportedAt = Date.now();
        onProgress?.({received, total});
      }
    });
    await pipeline(body, createWriteStream(file));
    onProgress?.({received, total: total ?? received});
    return file;
  }

  /**
   * Whether the token works, whose it is and whether the project is reachable.
   */
  async test() {
    try {
      const connection = await this.connection();
      const user = await this.request(connection, '/user');
      const projectPath = connection.settings.project.trim();
      if (!projectPath) {
        return {ok: true, user: user.name || user.username};
      }
      const project = await this.request(connection, `/projects/${encodeURIComponent(projectPath)}`);
      return {ok: true, user: user.name || user.username, project: project.path_with_namespace};
    } catch (error) {
      return {ok: false, error: message(error)};
    }
  }
}
