import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {app, dialog, ipcMain} from 'electron';

import {
  getSummary,
  journal,
  readPreviousJournal,
  setSummary,
  startJournalFile,
  trackHandler,
} from '../../common/node/journal.js';
import {PRODUCT_NAME} from '../../common/shared/product.js';
import {getJournalWindow} from './windows.js';

// changes reach the journal window in batches: a burst of commands is one message
const SEND_EVERY_MS = 250;

const journalDir = () => path.join(app.getPath('userData'), 'journal');

/**
 * Starts the journal before anything else runs: every IPC handler set up
 * after this call is written to it, and so are errors of the main process.
 */
export function setupJournal() {
  setSummary({
    app: PRODUCT_NAME,
    version: app.getVersion(),
    os: process.platform === 'darwin' ? `macOS ${process.getSystemVersion()}` : `${os.type()} ${os.release()}`,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
  });
  startJournalFile(journalDir()).catch((error) => journal.add({level: 'warn', text: `journal file: ${error.message}`}));

  // a monitor only looks: the app fails on an uncaught error just as before
  process.on('uncaughtExceptionMonitor', (error, origin) =>
    journal.add({level: 'error', text: `${origin}: ${error?.message ?? error}`, detail: error?.stack}),
  );

  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, trackHandler(channel, handler));

  let pending = [];
  let cleared = false;
  let timer = null;
  journal.subscribe((entry) => {
    if (entry) {
      pending.push(entry);
    } else {
      cleared = true;
      pending = [];
    }
    timer ??= setTimeout(() => {
      timer = null;
      const window = getJournalWindow();
      if (window && !window.isDestroyed()) {
        window.webContents.send('journal:changed', {entries: pending, cleared, summary: getSummary()});
      }
      pending = [];
      cleared = false;
    }, SEND_EVERY_MS);
  });

  ipcMain.handle('journal:list', () => ({summary: getSummary(), entries: journal.list()}));
  ipcMain.handle('journal:previous', async () => await readPreviousJournal(journalDir()));
  ipcMain.handle('journal:clear', () => journal.clear());
  ipcMain.handle('journal:save', async (_evt, text, name) => {
    const {canceled, filePath} = await dialog.showSaveDialog(getJournalWindow() ?? undefined, {
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [{name: 'Text', extensions: ['txt']}],
    });
    if (canceled || !filePath) {
      return null;
    }
    await writeFile(filePath, text, 'utf8');
    return filePath;
  });
  ipcMain.on('journal:report', (_evt, {text, detail} = {}) =>
    journal.add({source: 'ui', level: 'error', text: String(text ?? 'error'), detail}),
  );
}
