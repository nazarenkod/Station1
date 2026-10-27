import {mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {ACCESS, simulatorProblem} from '../../shared/app-data/access.js';
import {prefsFormat} from '../../shared/app-data/classify.js';
import {runTool} from '../doctor/exec.js';
import {plistToXml} from './plist-files.js';

// The sandbox of a simulator app is a folder on this Mac. Its preferences go
// through the simulator's cfprefsd (defaults by path): it keeps them cached
// and would write its own copy over a file changed behind its back.

// the container's own bookkeeping, not the app's data
const HIDDEN = /^\.com\.apple\./;

/** The app's group containers from `simctl get_app_container … groups`: id, a tab, the folder. */
export function parseGroups(output) {
  return String(output ?? '')
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([id, dir]) => id?.trim() && dir?.trim())
    .map(([id, dir]) => ({id: id.trim(), dir: dir.trim()}));
}

async function walk(root, prefix) {
  const files = [];
  const visit = async (dir, rel) => {
    let entries;
    try {
      entries = await readdir(dir, {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      if (HIDDEN.test(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      const relative = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(full, relative);
      } else if (entry.isFile()) {
        const info = await stat(full).catch(() => null);
        if (info) {
          files.push({path: prefix + relative, size: info.size, mtime: Math.round(info.mtimeMs)});
        }
      }
    }
  };
  await visit(root, '');
  return files;
}

export async function openSimulator(device, appId) {
  const simctl = (args, options = {}) => runTool('xcrun', ['simctl', ...args], {timeout: 20000, ...options});
  const data = await simctl(['get_app_container', device.id, appId, 'data']);
  if (!data.ok) {
    return {error: simulatorProblem(data)};
  }
  const groups = await simctl(['get_app_container', device.id, appId, 'groups']);
  const roots = [
    {prefix: '', dir: data.stdout.trim()},
    ...(groups.ok ? parseGroups(groups.stdout) : []).map((group) => ({prefix: `@${group.id}/`, dir: group.dir})),
  ];

  const resolve = (file) => {
    const root = roots.find((one) => one.prefix && file.startsWith(one.prefix)) ?? roots[0];
    const full = path.resolve(root.dir, file.slice(root.prefix.length));
    // nothing outside the app's containers
    if (full !== root.dir && !full.startsWith(root.dir + path.sep)) {
      throw new Error(`${file} is outside the app’s container`);
    }
    return full;
  };
  // defaults takes a property list by its path without .plist
  const domain = (file) => resolve(file).replace(/\.plist$/, '');

  const transport = {
    platform: 'ios',
    access: ACCESS.SIMULATOR,
    roots,
    async list() {
      return (await Promise.all(roots.map((root) => walk(root.dir, root.prefix)))).flat();
    },
    async read(file) {
      return await readFile(resolve(file));
    },
    async write(file, bytes) {
      const full = resolve(file);
      await mkdir(path.dirname(full), {recursive: true});
      await writeFile(full, bytes);
    },
    async remove(file) {
      await rm(resolve(file), {force: true});
    },
    // what cfprefsd holds now, which the file may not have yet
    async readPrefs(file) {
      const exported = await simctl(['spawn', device.id, 'defaults', 'export', domain(file), '-'], {quiet: true});
      if (exported.ok && exported.stdout.includes('<plist')) {
        return exported.stdout;
      }
      return await plistToXml(await readFile(resolve(file)));
    },
    async writePrefs(file, xml) {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'vision-prefs-'));
      try {
        const source = path.join(dir, 'prefs.plist');
        await writeFile(source, xml);
        // the whole domain is replaced: a key taken out must not stay in the cache
        await simctl(['spawn', device.id, 'defaults', 'delete', domain(file)]);
        const imported = await simctl(['spawn', device.id, 'defaults', 'import', domain(file), source]);
        if (!imported.ok) {
          throw new Error(`Writing ${file}: ${imported.stderr.trim()}`);
        }
      } finally {
        await rm(dir, {recursive: true, force: true});
      }
    },
    async stop() {
      await simctl(['terminate', device.id, appId]);
    },
    async launch() {
      await simctl(['launch', device.id, appId]);
    },
    // as after a new install: the defaults through cfprefsd, then every file; the folders stay
    async clear() {
      for (const file of await transport.list()) {
        if (prefsFormat(file.path, 'ios')) {
          await simctl(['spawn', device.id, 'defaults', 'delete', domain(file.path)]);
        }
        await rm(resolve(file.path), {force: true});
      }
    },
  };
  return {transport};
}
