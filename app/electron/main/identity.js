import path from 'node:path';

import {app} from 'electron';

import {DATA_FOLDER} from '../../common/shared/product.js';

// Imported before anything else in the main process: settings, keys, the
// proxy certificate and caches live in one folder whatever the app is called
// (the installed app takes the product name, the development build the
// package name), so a rename or a switch between them loses nothing.
app.setPath('userData', path.join(app.getPath('appData'), DATA_FOLDER));

// the development build runs inside Electron.app: give the Dock the product's own icon
if (!app.isPackaged && process.platform === 'darwin') {
  app.whenReady().then(() => app.dock?.setIcon(path.join(app.getAppPath(), 'build', 'icon.png')));
}
