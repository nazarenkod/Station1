import {ipcMain} from 'electron';
import settings from 'electron-settings';

import {GitLabService} from '../../../common/node/gitlab/service.js';
import {GITLAB_CONFIG} from '../../../common/shared/setting-defs.js';
import {encryptedSecret} from '../secrets.js';

const token = encryptedSecret('GITLAB_TOKEN_ENCRYPTED');

export function setupGitLabIPC() {
  const service = new GitLabService({
    getSettings: async () => (await settings.get(GITLAB_CONFIG)) ?? {},
    getToken: token.read,
  });

  ipcMain.handle('gitlab:hasToken', token.has);
  ipcMain.handle('gitlab:setToken', async (_evt, value) => await token.write(value));
  ipcMain.handle('gitlab:test', async () => await service.test());
}
