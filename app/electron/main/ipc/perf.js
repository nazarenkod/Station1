import {writeFile} from 'node:fs/promises';
import path from 'node:path';

import {app, BrowserWindow, dialog, ipcMain} from 'electron';

import {PerfSession} from '../../../common/node/perf/session.js';
import {createPerfStore} from '../../../common/node/perf/store.js';
import {perfSettings, runCsv} from '../../../common/shared/perf/baseline.js';

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
  const store = createPerfStore(path.join(app.getPath('userData'), 'perf'));
  let session = null;
  let contents = null;
  // a paused test outlives a measurement started again: the new one starts paused
  let paused = false;

  // what was measured so far is kept before the measurement ends or starts over
  const keep = async (markers) => {
    if (!session) {
      return null;
    }
    try {
      return await store.saveRun(session.run(markers));
    } catch {
      return null;
    }
  };

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
  ipcMain.handle('perf:stop', async (_evt, markers) => {
    const kept = await keep(markers);
    stop();
    return kept;
  });
  ipcMain.handle('perf:cut', async (_evt, markers) => {
    const kept = await keep(markers);
    session?.reset();
    return {kept, startedAt: session?.startedAt ?? null};
  });
  ipcMain.handle('perf:snapshot', () => session?.snapshot() ?? null);

  // the runs kept on this Mac and the references made of them
  ipcMain.handle('perf:history', async (_evt, appId) => await store.readIndex(appId));
  ipcMain.handle('perf:run', async (_evt, appId, id) => await store.readRun(appId, id));
  ipcMain.handle('perf:deleteRun', async (_evt, appId, id) => await store.deleteRun(appId, id));
  ipcMain.handle(
    'perf:setBaseline',
    async (_evt, appId, runId, settings) => await store.setBaseline(appId, runId, perfSettings(settings)),
  );
  ipcMain.handle('perf:export', async (evt, {run, samples, markers, comparison}) => {
    const name = `${run.appId}-${run.build.version || 'build'}-${new Date(run.startedAt).toISOString().slice(0, 16)}`;
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(evt.sender), {
      defaultPath: name.replace(/[:]/g, '-'),
      filters: [
        {name: 'CSV', extensions: ['csv']},
        {name: 'JSON', extensions: ['json']},
      ],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    const json = result.filePath.toLowerCase().endsWith('.json');
    const endAt = samples.at(-1)?.at ?? run.endAt;
    const body = json
      ? JSON.stringify({run, comparison: comparison ?? null, samples, markers}, null, 2)
      : runCsv({run, samples, markers, endAt});
    await writeFile(
      json || result.filePath.toLowerCase().endsWith('.csv') ? result.filePath : `${result.filePath}.csv`,
      body,
    );
    return result.filePath;
  });
}
