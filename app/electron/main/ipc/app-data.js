import path from 'node:path';

import {app, BrowserWindow, dialog, ipcMain} from 'electron';

import {createAppDataService} from '../../../common/node/app-data/service.js';

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

/**
 * The data of the app chosen in the title bar. The window says which device
 * and app; the service reads only when asked or while watching.
 */
export function setupAppDataIPC() {
  const service = createAppDataService({
    dataDir: app.getPath('userData'),
    onUpdate: (state) => broadcast('appData:update', state),
  });

  ipcMain.handle('appData:select', (_evt, device, appId) => service.select(device, appId));
  ipcMain.handle('appData:state', () => service.state());
  ipcMain.handle('appData:refresh', async () => await service.refresh());
  ipcMain.handle('appData:watch', (_evt, on) => service.watch(on));
  ipcMain.handle('appData:screen', (_evt, title) => service.setScreen(title));
  ipcMain.handle('appData:table', async (_evt, file, table, options) => await service.table(file, table, options));
  ipcMain.handle('appData:query', async (_evt, file, sql, options) => await service.query(file, sql, options));
  ipcMain.handle('appData:file', async (_evt, file) => await service.fileContent(file));
  ipcMain.handle('appData:setPref', async (_evt, file, key, value, type, options) =>
    service.setPref(file, key, value, type, options),
  );
  ipcMain.handle(
    'appData:removePref',
    async (_evt, file, key, options) => await service.removePref(file, key, options),
  );
  ipcMain.handle('appData:put', async (_evt, file, localFile, options) => await service.put(file, localFile, options));
  ipcMain.handle('appData:removeFile', async (_evt, file, options) => await service.removeFile(file, options));
  ipcMain.handle('appData:revert', async (_evt, editId, options) => await service.revert(editId, options));
  ipcMain.handle('appData:clear', async () => await service.clear());
  ipcMain.handle('appData:clearBackups', async () => await service.clearBackups());
  ipcMain.handle('appData:search', async (_evt, text) => await service.search(text));
  ipcMain.handle('appData:save', async (evt, file, isFolder) => {
    const window = BrowserWindow.fromWebContents(evt.sender);
    const result = isFolder
      ? await dialog.showOpenDialog(window, {properties: ['openDirectory', 'createDirectory']})
      : await dialog.showSaveDialog(window, {defaultPath: path.basename(file)});
    const destination = isFolder ? result.filePaths?.[0] : result.filePath;
    if (result.canceled || !destination) {
      return {ok: false, canceled: true};
    }
    try {
      const saved = await service.saveTo(file, isFolder ? path.join(destination, path.basename(file)) : destination);
      return {ok: true, ...saved, destination};
    } catch (error) {
      return {ok: false, error: String(error.message ?? error)};
    }
  });

  app.on('before-quit', () => service.stop());
  return service;
}
