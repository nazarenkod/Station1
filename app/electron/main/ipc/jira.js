import {ipcMain} from 'electron';
import settings from 'electron-settings';

import {JiraBugService} from '../../../common/node/jira/bug-service.js';
import {JIRA_CONFIG} from '../../../common/shared/setting-defs.js';
import {encryptedSecret} from '../secrets.js';

const token = encryptedSecret('JIRA_TOKEN_ENCRYPTED');

export function setupJiraIPC() {
  const service = new JiraBugService({
    getSettings: async () => (await settings.get(JIRA_CONFIG)) ?? {},
    getToken: token.read,
  });

  ipcMain.handle('jira:hasToken', token.has);
  ipcMain.handle('jira:setToken', async (_evt, value) => await token.write(value));
  ipcMain.handle('jira:test', async () => await service.test());
  ipcMain.handle('jira:mine', async () => await service.mine());
  ipcMain.handle('jira:findUsers', async (_evt, query) => {
    try {
      return await service.findUsers(query);
    } catch {
      return [];
    }
  });
  ipcMain.handle('jira:prepare', async (_evt, request) => await service.prepare(request));
  ipcMain.handle('jira:file', async (_evt, request) => await service.file(request));
  ipcMain.handle('jira:lookup', async (_evt, request) => await service.lookup(request));
  ipcMain.handle('jira:link', async (_evt, request) => await service.link(request));
  ipcMain.handle('jira:unlink', async (_evt, request) => await service.unlink(request));
}
