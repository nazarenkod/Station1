// first: where the app keeps its data, before any module reads settings
import './identity.js';
import {app} from 'electron';
import debug from 'electron-debug';

import {installExtensions} from './debug.js';
import {isDev, setupIPCListeners} from './helpers.js';
import {setupAiIPC} from './ipc/ai.js';
import {setupBuildsIPC} from './ipc/builds.js';
import {setupDeviceIPC} from './ipc/device.js';
import {setupDoctorIPC} from './ipc/doctor.js';
import {setupGitLabIPC} from './ipc/gitlab.js';
import {setupJiraIPC} from './ipc/jira.js';
import {setupLogsIPC} from './ipc/logs.js';
import {setupProxyIPC} from './ipc/proxy.js';
import {setupSettingsIPC} from './ipc/settings.js';
import {setupMainWindow} from './windows.js';

// Used when opening Inspector through an .appiumsession file (Windows/Linux).
// This value is not set in dev mode, since accessing argv[1] there throws an error,
// and this flow only makes sense for the installed Inspector app anyway
let openFilePath = process.platform === 'darwin' || isDev ? null : process.argv[1];

// Ensures scrollbar visibility mode (always visible or overlay) follows OS preferences.
// Explicitly required: the default mode is always visible.
// Reference: https://peter.sh/experiments/chromium-command-line-switches/
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar:mode/device');

// Used when opening Inspector through an .appiumsession file (macOS)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openFilePath = filePath;
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('ready', async () => {
  if (isDev) {
    debug();
    await installExtensions();
  }

  setupIPCListeners(() => openFilePath);
  setupDoctorIPC();
  setupJiraIPC();
  setupAiIPC();
  setupGitLabIPC();
  setupDeviceIPC();
  setupBuildsIPC();
  setupLogsIPC();
  setupProxyIPC();
  setupSettingsIPC();
  await setupMainWindow();
});
