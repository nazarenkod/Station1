// The development build (npm run dev:electron) runs inside Electron.app from
// node_modules, and macOS shows that bundle's name and icon in the menu bar,
// the Dock and Cmd+Tab. This renames it to the product and gives it the
// product's icon. Runs after npm install; safe to run again.

import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

if (process.platform !== 'darwin') {
  process.exit(0);
}

const root = path.resolve(import.meta.dirname, '..');
const bundle = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const plist = path.join(bundle, 'Contents', 'Info.plist');
if (!existsSync(plist)) {
  process.exit(0);
}

const {productName} = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8'));
const run = (command, args) => execFileSync(command, args, {stdio: ['ignore', 'ignore', 'inherit']});

for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  try {
    run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${productName}`, plist]);
  } catch {
    run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${productName}`, plist]);
  }
}
copyFileSync(path.join(root, 'build', 'icon.icns'), path.join(bundle, 'Contents', 'Resources', 'electron.icns'));
// the changed Info.plist breaks Electron's signature, and Apple silicon runs only signed code
run('codesign', ['--force', '--deep', '--sign', '-', bundle]);
// let Finder and the Dock pick up the new name and icon
run('touch', [bundle]);
process.stdout.write(`Development Electron.app now shows as ${productName}\n`);
