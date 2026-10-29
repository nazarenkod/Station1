import {chmod, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {DATA_FOLDER} from '../../shared/product.js';

// How an agent outside the station finds it: while access is on, the station
// writes its port and a token made for this run into a file of its data
// folder that only this user can read. The bridge (`vision-inspector mcp`)
// reads the file and asks the station over 127.0.0.1.

export const CONNECTION_FILE = 'external-agents.json';

/** The station's data folder as the bridge finds it: the one given, or where the app keeps it. */
export function stationDataDir({env = process.env, platform = process.platform, home = os.homedir()} = {}) {
  if (env.STATION_DATA_DIR) {
    return env.STATION_DATA_DIR;
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', DATA_FOLDER);
  }
  if (platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), DATA_FOLDER);
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), DATA_FOLDER);
}

export async function writeConnection(dataDir, {port, token}) {
  await mkdir(dataDir, {recursive: true});
  const file = path.join(dataDir, CONNECTION_FILE);
  await writeFile(file, `${JSON.stringify({port, token, pid: process.pid})}\n`, {mode: 0o600});
  // a file that was there before keeps its old mode otherwise
  await chmod(file, 0o600);
}

export async function removeConnection(dataDir) {
  await rm(path.join(dataDir, CONNECTION_FILE), {force: true});
}

export async function readConnection(dataDir) {
  try {
    const value = JSON.parse(await readFile(path.join(dataDir, CONNECTION_FILE), 'utf8'));
    return Number.isInteger(value.port) && typeof value.token === 'string' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Calls a tool of the station for the bridge. Whatever goes wrong comes back
 * as words for the agent: the station is not running, access is off.
 * @returns {Promise<{ok: boolean, text: string, images?: {data: string, mimeType: string}[]}>}
 */
export async function callStation(dataDir, tool, args, {fetchImpl = fetch} = {}) {
  const connection = await readConnection(dataDir);
  if (!connection) {
    return {
      ok: false,
      text: 'The station is not running, or access for external agents is off. Start the station and turn on «External agents» in its settings.',
    };
  }
  try {
    const response = await fetchImpl(`http://127.0.0.1:${connection.port}/external/${tool}`, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${connection.token}`},
      body: JSON.stringify(args ?? {}),
    });
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        text: 'The station refused: access for external agents is off. Turn it on in the station settings.',
      };
    }
    const answer = await response.json();
    return {ok: response.ok && answer.ok !== false, text: answer.text ?? '', images: answer.images ?? []};
  } catch {
    return {ok: false, text: 'The station is not running. Start it and try again.'};
  }
}
