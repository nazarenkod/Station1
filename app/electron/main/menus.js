import {app, dialog, Menu, shell} from 'electron';

import webdriverPackageJson from '../../../node_modules/webdriver/package.json';
import {PRODUCT_NAME} from '../../common/shared/product.js';
import {isDev, t} from './helpers.js';
import {checkForUpdates, UPDATES_ENABLED} from './updater.js';
import {launchNewSessionWindow} from './windows.js';

const APPIUM_DOCS_URL = 'https://appium.io';
const APPIUM_FORUM_URL = 'https://discuss.appium.io';

const separator = {type: 'separator'};

export function rebuildMenus(mainWindow) {
  const isMac = process.platform === 'darwin';

  const menu = Menu.buildFromTemplate(menuTemplate(isMac));

  if (isMac) {
    Menu.setApplicationMenu(menu);
  } else {
    mainWindow.setMenu(menu);
  }
}

function showAppInfoPopup() {
  dialog.showMessageBox({
    title: PRODUCT_NAME,
    message:
      `${PRODUCT_NAME} ${app.getVersion()}\n\n` +
      `WebdriverIO ${webdriverPackageJson.version}\n` +
      `Electron ${process.versions.electron}\n` +
      `Node.js ${process.versions.node}`,
  });
}

function optionAbout() {
  return {
    label: t('menuAbout', {app: PRODUCT_NAME}),
    click: () => showAppInfoPopup(),
  };
}

// empty until the product has its own release channel
function optionsCheckForUpdates() {
  return UPDATES_ENABLED ? [{label: t('Check for Updates…'), click: () => checkForUpdates()}] : [];
}

function dropdownApp() {
  return {
    label: PRODUCT_NAME,
    submenu: [
      optionAbout(),
      ...optionsCheckForUpdates(),
      separator,
      {label: t('menuHide', {app: PRODUCT_NAME}), role: 'hide'},
      {label: t('Hide Others'), role: 'hideOthers'},
      {label: t('Show All'), role: 'unhide'},
      separator,
      {label: t('menuQuit', {app: PRODUCT_NAME}), role: 'quit'},
    ],
  };
}

function dropdownFile(isMac) {
  const submenu = [
    {label: t('New Window'), accelerator: 'CmdOrCtrl+N', click: launchNewSessionWindow},
    {label: t('Close Window'), role: 'close'},
  ];

  if (!isMac) {
    submenu.push(...[separator, optionAbout(), ...optionsCheckForUpdates()]);
  }

  return {
    label: t('File'),
    submenu,
  };
}

function dropdownEdit() {
  return {
    label: t('Edit'),
    submenu: [
      {label: t('Undo'), role: 'undo'},
      {label: t('Redo'), role: 'redo'},
      separator,
      {label: t('Cut'), role: 'cut'},
      {label: t('Copy'), role: 'copy'},
      {label: t('Paste'), role: 'paste'},
      {label: t('Delete'), role: 'delete'},
      {label: t('Select All'), role: 'selectAll'},
    ],
  };
}

function dropdownView() {
  const submenu = [
    {label: t('Toggle Full Screen'), role: 'togglefullscreen'},
    {label: t('Reset Zoom Level'), role: 'resetZoom'},
    {label: t('Zoom In'), role: 'zoomIn'},
    {label: t('Zoom Out'), role: 'zoomOut'},
  ];

  if (isDev) {
    submenu.push(
      ...[
        separator,
        {label: t('Reload'), role: 'reload'},
        {label: t('Toggle Developer Tools'), role: 'toggleDevTools'},
      ],
    );
  }

  return {
    label: t('View'),
    submenu,
  };
}

function dropdownWindow() {
  return {
    label: t('Window'),
    submenu: [
      {label: t('Minimize'), role: 'minimize'},
      {label: t('Zoom'), role: 'zoom'},
      separator,
      {label: t('Bring All to Front'), role: 'front'},
    ],
  };
}

function dropdownHelp() {
  return {
    label: t('Help'),
    submenu: [
      {label: t('Appium Documentation'), click: () => shell.openExternal(APPIUM_DOCS_URL)},
      {label: t('Appium Discussion Forum'), click: () => shell.openExternal(APPIUM_FORUM_URL)},
    ],
  };
}

function menuTemplate(isMac) {
  return [
    ...(isMac ? [dropdownApp()] : []),
    dropdownFile(isMac),
    dropdownEdit(),
    dropdownView(),
    ...(isMac ? [dropdownWindow()] : []),
    dropdownHelp(),
  ];
}
