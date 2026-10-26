// Builds the Mac app for this computer and installs it into /Applications,
// ready to open like any other app: `npm run install:mac`.
//
// The app is signed ad hoc (no Developer ID needed): it runs on this Mac.
// For colleagues, `npm run pack:mac` makes the DMG; docs/signing.md covers
// signing and notarizing it with a Developer ID.

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

if (process.platform !== 'darwin') {
  process.stderr.write('install:mac installs into /Applications on macOS only\n');
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, '..');
const {productName} = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8'));
// the Mac's own processor: Node may run under Rosetta and call itself x64 on Apple silicon
const appleSilicon = execFileSync('sysctl', ['-in', 'hw.optional.arm64'], {encoding: 'utf8'}).trim() === '1';
const arch = appleSilicon ? 'arm64' : 'x64';
const built = path.join(root, 'release', arch === 'arm64' ? 'mac-arm64' : 'mac', `${productName}.app`);
const installed = path.join('/Applications', `${productName}.app`);

const run = (command, args, {optional = false} = {}) => {
  process.stdout.write(`\n› ${command} ${args.join(' ')}\n`);
  try {
    execFileSync(command, args, {cwd: root, stdio: 'inherit'});
  } catch (error) {
    if (!optional) {
      throw error;
    }
  }
};

run('npm', ['run', 'build:electron']);
// only the app folder for this Mac, unsigned: no DMG, no notarization, no keychain prompts
run('npx', ['electron-builder', '--mac', 'dir', `--${arch}`, '-c.mac.identity=null', '-c.mac.notarize=false']);

if (!existsSync(built)) {
  process.stderr.write(`\nThe build did not produce ${built}\n`);
  process.exit(1);
}

// a running copy would keep the old version in memory
run('osascript', ['-e', `tell application "${productName}" to quit`], {optional: true});
run('rm', ['-rf', installed]);
run('ditto', [built, installed]);
// ad hoc signature: Apple silicon runs only signed code, and the bundle changed since Electron signed it
run('codesign', ['--force', '--deep', '--sign', '-', installed]);
run('xattr', ['-dr', 'com.apple.quarantine', installed], {optional: true});

process.stdout.write(`\n${productName} is installed in /Applications. Opening it…\n`);
run('open', [installed]);
