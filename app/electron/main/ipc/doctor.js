import {app, BrowserWindow, ipcMain} from 'electron';

import {ManagedAppium} from '../../../common/node/doctor/appium-server.js';
import {bootDevice, listDevices} from '../../../common/node/doctor/devices.js';
import {checkEnvironment, runDriverDoctor} from '../../../common/node/doctor/environment.js';
import {deleteSession, scanServers} from '../../../common/node/doctor/servers.js';
import {applyStress, restoreStress} from '../../../common/node/doctor/stress.js';
import {journal} from '../../../common/node/journal.js';

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

export function setupDoctorIPC() {
  // the journal keeps only how the server changes; its own log is in the doctor
  let lastStatus = null;
  const noteState = (state) => {
    if (state.status === lastStatus) {
      return;
    }
    lastStatus = state.status;
    journal.add({
      source: 'appium',
      level: state.status === 'failed' ? 'error' : 'info',
      text: `Appium ${state.status}${state.port ? ` :${state.port}` : ''}${state.binary ? ` (${state.binary})` : ''}`,
      detail: state.error ?? undefined,
    });
  };
  // the lines of an install the agent ran, so it sees why one failed
  let capture = null;
  const captured = async (task) => {
    capture = [];
    try {
      const ok = await task();
      return {ok, stdout: capture.join('\n')};
    } catch (error) {
      return {ok: false, stdout: [...capture, error.message].join('\n')};
    } finally {
      capture = null;
    }
  };
  const appium = new ManagedAppium({
    dataDir: app.getPath('userData'),
    onLog: (entry) => {
      capture?.push(...entry.lines);
      broadcast('doctor:server:log', entry);
    },
    onState: (state) => {
      noteState(state);
      broadcast('doctor:server:state', state);
    },
  });

  ipcMain.handle('doctor:servers', async (_evt, options) => await scanServers(options));
  ipcMain.handle('doctor:deleteSession', async (_evt, server, sessionId) => await deleteSession(server, sessionId));
  ipcMain.handle('doctor:devices', async () => await listDevices());
  ipcMain.handle('doctor:bootDevice', async (_evt, device) => await bootDevice(device));
  ipcMain.handle('doctor:environment', async () => await checkEnvironment({appium}));
  ipcMain.handle('doctor:driverDoctor', async (_evt, driver) => await runDriverDoctor(driver));

  ipcMain.handle('doctor:stress:apply', async (_evt, device, mode) => await applyStress(device, mode));
  ipcMain.handle(
    'doctor:stress:restore',
    async (_evt, device, mode, previous) => await restoreStress(device, mode, previous),
  );

  ipcMain.handle('doctor:server:get', () => ({state: appium.state, logs: appium.logs}));
  ipcMain.handle('doctor:server:start', async (_evt, options) => await appium.start(options));
  ipcMain.handle('doctor:server:stop', () => appium.stop());
  ipcMain.handle('doctor:server:install', async (_evt, drivers) => await appium.install(drivers));
  ipcMain.handle('doctor:server:installDriver', async (_evt, driver) => await appium.installDriver(driver));

  // the server is ours: it goes away with the app
  app.on('before-quit', () => appium.stop());

  // the agent fixes the environment through these
  return {
    check: () => checkEnvironment({appium}),
    installDriver: (driver) => captured(() => appium.installDriver(driver)),
    installAppium: () =>
      captured(() => appium.install(['uiautomator2', ...(process.platform === 'darwin' ? ['xcuitest'] : [])])),
    changed: () => broadcast('doctor:changed', {}),
  };
}
