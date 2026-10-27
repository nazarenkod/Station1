import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {ACCESS, devicectlDataProblem} from '../../shared/app-data/access.js';
import {runTool} from '../doctor/exec.js';

// The sandbox of an app on an iPhone, through devicectl (Xcode 15 and
// later). It works for apps signed for development only: the container of an
// App Store or TestFlight build is closed.

const CONTAINER = ['--domain-type', 'appDataContainer'];

/**
 * Files from `devicectl device info files --json-output`. The JSON names
 * them a little differently across Xcode versions, so it is read loosely.
 */
export function parseDevicectlFiles(json) {
  const files = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const name = value.relativePath ?? value.path ?? value.name;
    const isDir = value.isDirectory === true || value.type === 'directory';
    const size = value.fileSize ?? value.size;
    if (typeof name === 'string' && !isDir && Number.isFinite(Number(size))) {
      const date = value.lastModDate ?? value.modificationDate ?? value.lastModified;
      files.push({
        path: name.replace(/^\.?\//, ''),
        size: Number(size),
        mtime: date ? Date.parse(date) || 0 : 0,
      });
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(json?.result ?? {});
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** The process of the app among `devicectl device info processes`, by the folder of its bundle. */
export function findAppProcess(processes, bundleUrl) {
  if (!bundleUrl) {
    return null;
  }
  const folder = bundleUrl.replace(/^file:\/\//, '').replace(/\/?$/, '/');
  return (
    (processes?.result?.runningProcesses ?? []).find((one) =>
      String(one.executable ?? '')
        .replace(/^file:\/\//, '')
        .startsWith(folder),
    ) ?? null
  );
}

async function withJson(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vision-devicectl-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

export async function openIphone(device, appId) {
  const devicectl = async (args, {timeout = 60000, quiet = false} = {}) =>
    await withJson(async (dir) => {
      const output = path.join(dir, 'out.json');
      const result = await runTool('xcrun', ['devicectl', ...args, '--device', device.id, '--json-output', output], {
        timeout,
        quiet,
      });
      let json = null;
      try {
        json = JSON.parse(await readFile(output, 'utf8'));
      } catch {
        // no JSON: the result says why
      }
      return {result, json, dir};
    });
  const container = ['--domain-identifier', appId, ...CONTAINER];

  const list = async () => {
    const {json, result} = await devicectl(['device', 'info', 'files', ...container], {quiet: true});
    const problem = devicectlDataProblem(json);
    if (problem || !json) {
      return {error: problem ?? {reason: 'failed', detail: (result.stderr || result.stdout).trim()}};
    }
    return {files: parseDevicectlFiles(json)};
  };

  const probe = await list();
  if (probe.error) {
    return {error: probe.error};
  }

  const copy = async (direction, source, destination) => {
    const {json, result} = await devicectl([
      'device',
      'copy',
      direction,
      ...container,
      '--source',
      source,
      '--destination',
      destination,
    ]);
    const problem = devicectlDataProblem(json);
    if (problem || !result.ok) {
      throw new Error(
        problem?.detail || (result.stderr || result.stdout).trim() || `devicectl copy ${direction} failed`,
      );
    }
  };

  const appProcess = async () => {
    const apps = await devicectl(['device', 'info', 'apps', '--bundle-id', appId], {quiet: true});
    const url = apps.json?.result?.apps?.[0]?.url;
    const processes = await devicectl(['device', 'info', 'processes'], {quiet: true});
    return findAppProcess(processes.json, url);
  };

  return {
    transport: {
      platform: 'ios',
      access: ACCESS.DEVICECTL,
      async list() {
        const listed = await list();
        if (listed.error) {
          throw new Error(listed.error.detail || listed.error.reason);
        }
        return listed.files;
      },
      async read(file) {
        return await withJson(async (dir) => {
          const local = path.join(dir, 'pulled');
          await copy('from', file, local);
          return await readFile(local);
        });
      },
      async write(file, bytes) {
        await withJson(async (dir) => {
          const local = path.join(dir, path.basename(file));
          await writeFile(local, bytes);
          await copy('to', local, file);
        });
      },
      async remove() {
        // devicectl has no delete; an empty file is what the station can leave
        throw Object.assign(new Error('An iPhone file cannot be deleted through devicectl'), {code: 'notSupported'});
      },
      async stop() {
        const running = await appProcess();
        if (running?.processIdentifier) {
          await devicectl(['device', 'process', 'terminate', '--pid', String(running.processIdentifier)]);
        }
      },
      async launch() {
        await devicectl(['device', 'process', 'launch', '--terminate-existing', appId]);
      },
      async clear() {
        throw Object.assign(new Error('An iPhone app’s data is cleared only by reinstalling it'), {
          code: 'notSupported',
        });
      },
    },
  };
}
