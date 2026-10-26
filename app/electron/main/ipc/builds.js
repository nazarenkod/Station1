import {rename} from 'node:fs/promises';
import path from 'node:path';

import {app, BrowserWindow, dialog, ipcMain} from 'electron';
import settings from 'electron-settings';

import {ArtifactCache, extractArchiveBuild, listArchiveBuilds} from '../../../common/node/builds/artifacts.js';
import {inspectBuild} from '../../../common/node/builds/inspect.js';
import {installBuild, uninstallApp} from '../../../common/node/builds/install.js';
import {GitLabService} from '../../../common/node/gitlab/service.js';
import {GITLAB_CONFIG} from '../../../common/shared/setting-defs.js';
import {encryptedSecret} from '../secrets.js';

const gitlabToken = encryptedSecret('GITLAB_TOKEN_ENCRYPTED');

const failure = (error) => ({ok: false, code: error.code ?? null, error: error.message ?? String(error)});

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

export function setupBuildsIPC() {
  const cache = new ArtifactCache(path.join(app.getPath('userData'), 'builds'));
  const gitlab = new GitLabService({
    getSettings: async () => (await settings.get(GITLAB_CONFIG)) ?? {},
    getToken: gitlabToken.read,
  });

  ipcMain.handle('builds:pick', async (evt) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(evt.sender), {
      properties: ['openFile'],
      filters: [{name: 'APK, IPA, APP', extensions: ['apk', 'ipa', 'app', 'aab']}],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('builds:inspect', async (_evt, file) => {
    try {
      return {ok: true, build: await inspectBuild(file)};
    } catch (error) {
      return failure(error);
    }
  });

  // the build is read again here: what gets installed is the file on disk
  ipcMain.handle('builds:install', async (_evt, device, file, options) => {
    try {
      return await installBuild(device, await inspectBuild(file), options);
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('builds:uninstall', async (_evt, device, appId) => await uninstallApp(device, appId));

  ipcMain.handle('builds:gitlab:list', async () => await gitlab.listBuilds());

  ipcMain.handle('builds:gitlab:fetch', async (_evt, jobId) => {
    try {
      if (!(await cache.has(jobId))) {
        await cache.prepare(jobId);
        // a download cut halfway must not pass for the archive next time
        const partial = `${cache.archive(jobId)}.part`;
        await gitlab.downloadArtifacts(jobId, partial, {
          onProgress: (progress) => broadcast('builds:progress', {jobId, ...progress}),
        });
        await rename(partial, cache.archive(jobId));
      }
      return {ok: true, candidates: await listArchiveBuilds(cache.archive(jobId))};
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('builds:gitlab:extract', async (_evt, jobId, candidate) => {
    try {
      return {ok: true, file: await extractArchiveBuild(cache.archive(jobId), candidate, cache.jobDir(jobId))};
    } catch (error) {
      return failure(error);
    }
  });
}
