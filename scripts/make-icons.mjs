// Makes every app icon from two SVG sources, so the Dock, Finder, the
// Windows installer and the app's own header show the same mark:
//   build/icon.svg                          macOS tile with margins and shadow -> icon.icns, icon.png
//   app/common/renderer/assets/images/vision-logo.svg   full-bleed logo -> icon.ico, favicon
// Needs rsvg-convert and ImageMagick (brew install librsvg imagemagick); iconutil comes with macOS.

import {execFileSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const macSource = path.join(root, 'build', 'icon.svg');
const logo = path.join(root, 'app', 'common', 'renderer', 'assets', 'images', 'vision-logo.svg');
const run = (command, args) => execFileSync(command, args, {stdio: 'inherit'});
const render = (source, size, target) =>
  run('rsvg-convert', ['-w', String(size), '-h', String(size), source, '-o', target]);

const tmp = mkdtempSync(path.join(os.tmpdir(), 'station-icons-'));
try {
  // macOS: an .iconset with every size and its @2x, then iconutil
  const iconset = path.join(tmp, 'icon.iconset');
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    render(macSource, size, path.join(iconset, `icon_${size}x${size}.png`));
    render(macSource, size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'build', 'icon.icns')]);
  // Linux and the development build's Dock icon
  render(macSource, 1024, path.join(root, 'build', 'icon.png'));

  // Windows: the logo fills the square, as Windows icons do
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((size) => {
    const file = path.join(tmp, `win-${size}.png`);
    render(logo, size, file);
    return file;
  });
  run('magick', [...pngs, path.join(root, 'build', 'icon.ico')]);

  copyFileSync(logo, path.join(root, 'app', 'common', 'public', 'favicon.svg'));
  process.stdout.write('Icons written: build/icon.icns, build/icon.png, build/icon.ico, public/favicon.svg\n');
} finally {
  rmSync(tmp, {recursive: true, force: true});
}
