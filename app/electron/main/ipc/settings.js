import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {app, BrowserWindow, dialog, ipcMain} from 'electron';
import settings from 'electron-settings';

import {createStationSettings} from '../../../common/node/settings/station-settings.js';
import {PRODUCT_NAME} from '../../../common/shared/product.js';
import i18n from '../i18next.js';

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

const FILTERS = [{name: 'JSON', extensions: ['json']}];

/**
 * Project profiles, export and import of the settings, and the backup
 * copies. Whatever changes the setting keys tells the windows which keys
 * changed, so the tools pick the new settings up at once. Gives the station
 * settings back for the other areas that keep something per profile.
 */
export function setupSettingsIPC() {
  const station = createStationSettings({
    store: {get: (key) => settings.get(key), set: (key, value) => settings.set(key, value)},
    backupDir: path.join(app.getPath('userData'), 'backups'),
    product: PRODUCT_NAME,
    // the translations may still be loading when the first profile is made
    firstProfileName: () => (i18n.exists('settingsFirstProfile') ? i18n.t('settingsFirstProfile') : 'My project'),
  });

  // the copy of the day, once the app is up; a failure here must not stop the app
  station.dailyBackup().catch(() => null);

  const changed = (result) => {
    if (result?.profiles) {
      broadcast('settings:changed', {profiles: result.profiles, keys: result.changedKeys ?? []});
    }
    return result;
  };

  ipcMain.handle('settings:profiles', () => station.profiles());
  ipcMain.handle('settings:switchProfile', async (_evt, id) => changed(await station.switchProfile(id)));
  ipcMain.handle('settings:addProfile', async (_evt, name, options) =>
    changed(await station.addProfile(name, options)),
  );
  ipcMain.handle('settings:renameProfile', async (_evt, id, name) => changed(await station.renameProfile(id, name)));
  ipcMain.handle('settings:setProfileApps', async (_evt, id, apps) => changed(await station.setProfileApps(id, apps)));
  ipcMain.handle('settings:setProfilePlatforms', async (_evt, id, change) =>
    changed(await station.setProfilePlatforms(id, change)),
  );
  ipcMain.handle('settings:setProfileSource', async (_evt, id, source) =>
    changed(await station.setProfileSource(id, source)),
  );
  ipcMain.handle('settings:removeProfile', async (_evt, id) => changed(await station.removeProfile(id)));
  ipcMain.handle('settings:profileForApp', (_evt, appId) => station.profileForApp(appId));

  ipcMain.handle('settings:export', async (evt, options) => {
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(evt.sender), {
      defaultPath: options.fileName,
      filters: FILTERS,
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    await writeFile(result.filePath, await station.exportText(options));
    return result.filePath;
  });

  // the file read stays here between the preview and the import
  let picked = null;
  ipcMain.handle('settings:pickImport', async (evt) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(evt.sender), {
      properties: ['openFile'],
      filters: FILTERS,
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    let text;
    try {
      text = await readFile(result.filePaths[0], 'utf8');
    } catch (error) {
      return {ok: false, error: 'read', detail: error.message};
    }
    const preview = await station.previewImport(text);
    picked = preview.ok ? text : null;
    return {...preview, fileName: path.basename(result.filePaths[0])};
  });
  ipcMain.handle('settings:applyImport', async (_evt, choice) => {
    if (!picked) {
      return {ok: false, error: 'format'};
    }
    const result = changed(await station.applyImport(picked, choice));
    picked = null;
    return result;
  });

  ipcMain.handle('settings:backups', () => station.listBackups());
  ipcMain.handle('settings:restore', async (_evt, file) => changed(await station.restore(file)));
  return station;
}
