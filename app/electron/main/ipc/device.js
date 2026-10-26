import {ipcMain} from 'electron';

import {appVersion, foregroundApp, listAppsWithStatus} from '../../../common/node/device/apps.js';

export function setupDeviceIPC() {
  ipcMain.handle('device:apps', async (_evt, device) => await listAppsWithStatus(device));
  ipcMain.handle('device:foreground', async (_evt, device) => await foregroundApp(device));
  ipcMain.handle('device:appVersion', async (_evt, device, appId) => await appVersion(device, appId));
}
