import {join} from 'node:path';

import {BrowserWindow, ipcMain, Menu, nativeTheme} from 'electron';
import settings from 'electron-settings';

import {PREFERRED_THEME} from '../../common/shared/setting-defs.js';
import {isDev} from './helpers.js';
import i18n from './i18next.js';
import {rebuildMenus} from './menus.js';

const mainPath = isDev ? process.env.ELECTRON_RENDERER_URL : join(__dirname, '..', 'renderer', 'index.html'); // from 'main' in package.json
const splashPath = isDev
  ? `${process.env.ELECTRON_RENDERER_URL}/splash.html`
  : join(__dirname, '..', 'renderer', 'splash.html'); // from 'main' in package.json
const journalPath = isDev
  ? `${process.env.ELECTRON_RENDERER_URL}/journal.html`
  : join(__dirname, '..', 'renderer', 'journal.html'); // from 'main' in package.json
const pathLoadMethod = isDev ? 'loadURL' : 'loadFile';

let mainWindow = null;
let journalWindow = null;
let journalOpening = null;

export async function setupMainWindow() {
  const preferredTheme = await settings.get(PREFERRED_THEME);
  const isDarkTheme = preferredTheme === 'dark' || (preferredTheme === 'system' && nativeTheme.shouldUseDarkColors);
  const backgroundColor = isDarkTheme ? '#09090D' : '#F5F5F8';

  const splashWindow = buildSplashWindow(backgroundColor);
  splashWindow[pathLoadMethod](splashPath);
  splashWindow.show();

  mainWindow = buildSessionWindow(backgroundColor);
  mainWindow[pathLoadMethod](mainPath);

  mainWindow.webContents.on('did-finish-load', () => {
    rebuildMenus(mainWindow);
    splashWindow.destroy();
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('context-menu', (e, props) => {
    const {x, y} = props;

    Menu.buildFromTemplate([
      {
        label: i18n.t('Inspect element'),
        click() {
          mainWindow.inspectElement(x, y);
        },
      },
    ]).popup(mainWindow);
  });

  // Override the 'content-type' header to allow connecting to Selenium Grid devices
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['content-type'] = 'application/json; charset=utf-8';
    callback({requestHeaders: details.requestHeaders});
  });

  // Not included in `setupIPCListeners` to avoid circular dependency
  ipcMain.on('electron:updateLanguage', async (_evt, lngCode) => {
    await i18n.changeLanguage(lngCode);
    rebuildMenus(mainWindow);
  });
}

export const getJournalWindow = () => journalWindow;

/**
 * The journal of the station in a window of its own: it keeps working when
 * the main window hangs. Asked again, it shows the same window.
 */
export function openJournalWindow() {
  if (journalWindow && !journalWindow.isDestroyed()) {
    journalWindow.show();
    journalWindow.focus();
    return;
  }
  // a second click while the window is being made must not make another one
  journalOpening ??= buildJournalWindow().finally(() => {
    journalOpening = null;
  });
}

async function buildJournalWindow() {
  const preferredTheme = await settings.get(PREFERRED_THEME);
  const isDarkTheme = preferredTheme === 'dark' || (preferredTheme === 'system' && nativeTheme.shouldUseDarkColors);
  journalWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 560,
    minHeight: 400,
    title: i18n.t('journalTitle'),
    backgroundColor: isDarkTheme ? '#09090D' : '#F5F5F8',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.mjs'), // from 'main' in package.json
      sandbox: false,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  journalWindow[pathLoadMethod](journalPath);
  journalWindow.on('closed', () => {
    journalWindow = null;
  });
}

export function launchNewSessionWindow() {
  const win = buildSessionWindow();
  win[pathLoadMethod](mainPath);
  win.show();
}

function buildSplashWindow(backgroundColor) {
  return new BrowserWindow({
    width: 300,
    height: 300,
    minWidth: 300,
    minHeight: 300,
    frame: false,
    backgroundColor,
    webPreferences: {
      devTools: false,
    },
  });
}

// On macOS the app header is the title bar; the window buttons sit inside it
const macTitleBar =
  process.platform === 'darwin' ? {titleBarStyle: 'hiddenInset', trafficLightPosition: {x: 18, y: 19}} : {};

function buildSessionWindow(backgroundColor) {
  return new BrowserWindow({
    show: false,
    width: 1240,
    height: 800,
    minWidth: 500,
    minHeight: 600,
    backgroundColor,
    ...macTitleBar,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.mjs'), // from 'main' in package.json
      sandbox: false,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
}
