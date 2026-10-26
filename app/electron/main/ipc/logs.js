import {writeFile} from 'node:fs/promises';

import {BrowserWindow, dialog, ipcMain} from 'electron';

import {LogSession} from '../../../common/node/logs/session.js';

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

export const logLine = (entry) =>
  entry.kind === 'marker'
    ? `--------- ${entry.event === 'start' ? 'process started' : 'process ended'}: pid ${entry.pid}`
    : `${entry.date} ${entry.time} ${String(entry.pid).padStart(5)} ${String(entry.tid).padStart(5)} ${entry.level} ${entry.tag}: ${entry.message}`;

/**
 * One device log at a time, kept running while the workstation is open,
 * whichever tool is on screen.
 */
export function setupLogsIPC() {
  let session = null;

  const stop = () => {
    session?.stop();
    session = null;
  };

  ipcMain.handle('logs:start', async (_evt, device, appId, rules) => {
    stop();
    session = new LogSession({device, appId, rules, onBatch: (batch) => broadcast('logs:batch', batch)});
    return await session.start();
  });
  ipcMain.handle('logs:stop', () => stop());
  ipcMain.handle('logs:snapshot', () => session?.snapshot() ?? null);
  ipcMain.handle('logs:setApp', async (_evt, appId) => await session?.setApp(appId));
  ipcMain.handle('logs:setRules', (_evt, rules) => session?.setRules(rules));
  ipcMain.handle('logs:clear', () => session?.clear());
  ipcMain.handle('logs:save', async (evt, suggestedName) => {
    if (!session) {
      return null;
    }
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(evt.sender), {
      defaultPath: suggestedName,
      filters: [{name: 'Log', extensions: ['log', 'txt']}],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    await writeFile(result.filePath, `${session.entries.map(logLine).join('\n')}\n`);
    return result.filePath;
  });
}
