import {BrowserWindow, ipcMain} from 'electron';

import {PerfSession} from '../../../common/node/perf/session.js';

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

/**
 * Measures one app at a time, from "Start" until "Stop", whichever tool is
 * on screen.
 */
export function setupPerfIPC() {
  let session = null;
  let contents = null;
  // a paused test outlives a measurement started again: the new one starts paused
  let paused = false;

  const stop = () => {
    session?.stop();
    session = null;
    // the window goes back to resting in the background as before
    if (contents && !contents.isDestroyed()) {
      contents.setBackgroundThrottling(true);
    }
    contents = null;
  };

  ipcMain.handle('perf:start', async (evt, device, appId) => {
    stop();
    // the screens are followed while the person works on the device, the station often behind other
    // windows: its timers must not slow down to once a minute there
    contents = evt.sender;
    contents.setBackgroundThrottling(false);
    session = new PerfSession({device, appId, onBatch: (batch) => broadcast('perf:batch', batch)});
    session.setPaused(paused);
    return await session.start();
  });
  ipcMain.handle('perf:setPaused', (_evt, on) => {
    paused = !!on;
    session?.setPaused(paused);
  });
  ipcMain.handle('perf:stop', () => stop());
  ipcMain.handle('perf:snapshot', () => session?.snapshot() ?? null);
}
