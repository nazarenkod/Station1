import {ipcMain, safeStorage} from 'electron';
import settings from 'electron-settings';

import {JiraBugService} from '../../../common/node/jira/bug-service.js';
import {JIRA_CONFIG} from '../../../common/shared/setting-defs.js';

// the API token never reaches the renderer: it is stored encrypted by the OS keychain
const TOKEN_KEY = 'JIRA_TOKEN_ENCRYPTED';

async function readToken() {
  const stored = await settings.get(TOKEN_KEY);
  if (!stored) {
    return null;
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    return null;
  }
}

export function setupJiraIPC() {
  const service = new JiraBugService({
    getSettings: async () => (await settings.get(JIRA_CONFIG)) ?? {},
    getToken: readToken,
  });

  ipcMain.handle('jira:hasToken', async () => !!(await readToken()));
  ipcMain.handle('jira:setToken', async (_evt, token) => {
    if (!token) {
      await settings.unset(TOKEN_KEY);
      return true;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('The system keychain is not available to keep the token safe');
    }
    await settings.set(TOKEN_KEY, safeStorage.encryptString(token).toString('base64'));
    return true;
  });
  ipcMain.handle('jira:test', async () => await service.test());
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
