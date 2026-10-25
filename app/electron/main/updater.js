import {dialog} from 'electron';
import pkg from 'electron-updater';
const {autoUpdater} = pkg;

import {t} from './helpers.js';

// Vision Inspector has no release channel yet: the update check stays off and
// out of the menus until electron-builder.json gets a "publish" target
export const UPDATES_ENABLED = false;
const RELEASES_LINK = '';

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

autoUpdater.on('error', (error) => {
  dialog.showErrorBox(t('Could not download update'), t('updateDownloadFailed', {message: error}));
});

autoUpdater.on('update-not-available', () => {
  dialog.showMessageBox({
    type: 'info',
    buttons: [t('OK')],
    message: t('No update available'),
    detail: t('Vision Inspector is up-to-date'),
  });
});

autoUpdater.on('update-available', async ({version, releaseDate}) => {
  const pubDate = new Date(releaseDate).toDateString();
  const {response} = await dialog.showMessageBox({
    type: 'info',
    message: t('appiumIsAvailable', {name: version}),
    buttons: [t('Install Now'), t('Install Later')],
    detail: t('updateDetails', {pubDate, notes: RELEASES_LINK}),
  });
  if (response === 0) {
    // download is started without waiting for the dialog box to be dismissed
    dialog.showMessageBox({
      type: 'info',
      buttons: [t('OK')],
      message: t('updateIsBeingDownloaded'),
    });
    autoUpdater.downloadUpdate();
  }
});

autoUpdater.on('update-downloaded', async ({releaseName}) => {
  const {response} = await dialog.showMessageBox({
    type: 'info',
    buttons: [t('Restart Now'), t('Later')],
    message: t('Update Downloaded'),
    detail: t('updateIsDownloaded', {releaseName}),
  });
  if (response === 0) {
    autoUpdater.quitAndInstall();
  }
});

export function checkForUpdates() {
  autoUpdater.checkForUpdates();
}
