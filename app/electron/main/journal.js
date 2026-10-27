import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {app, BrowserWindow, dialog, ipcMain} from 'electron';

import {
  getSummary,
  journal,
  readPreviousJournal,
  setSummary,
  startJournalFile,
  trackHandler,
} from '../../common/node/journal.js';
import {journalHealth} from '../../common/shared/journal.js';
import {PRODUCT_NAME} from '../../common/shared/product.js';
import {getJournalWindow, openJournalWindow} from './windows.js';

// changes reach the journal window in batches: a burst of commands is one message
const SEND_EVERY_MS = 250;

const journalDir = () => path.join(app.getPath('userData'), 'journal');

// what was recorded before this moment the person has seen: the journal was open
let seenAt = 0;

const health = () => {
  if (getJournalWindow()) {
    seenAt = Date.now();
  }
  return journalHealth(journal.list(), seenAt);
};

// the other windows show the journal as a dot in the title bar
function sendHealth() {
  const journalWindow = getJournalWindow();
  const now = health();
  for (const window of BrowserWindow.getAllWindows()) {
    if (window !== journalWindow && !window.isDestroyed()) {
      window.webContents.send('journal:health', now);
    }
  }
}

/** Opens the journal window; what is in the journal counts as seen from now. */
export function openJournal() {
  seenAt = Date.now();
  openJournalWindow();
  sendHealth();
}

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
      sendHealth();
    }, SEND_EVERY_MS);
  });

  ipcMain.handle('journal:list', () => ({summary: getSummary(), entries: journal.list()}));
  ipcMain.handle('journal:previous', async () => await readPreviousJournal(journalDir()));
  ipcMain.handle('journal:clear', () => journal.clear());
  ipcMain.handle('journal:open', () => openJournal());
  ipcMain.handle('journal:health', () => health());
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
