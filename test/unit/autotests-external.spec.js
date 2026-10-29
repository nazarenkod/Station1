import {mkdtemp, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {createStationMcp} from '../../app/common/node/agent/station-mcp.js';
import {externalTools} from '../../app/common/node/autotests/external-run.js';
import {
  callStation,
  readConnection,
  removeConnection,
  stationDataDir,
  writeConnection,
} from '../../app/common/node/autotests/external.js';
import {createPackagesStore} from '../../app/common/node/autotests/packages.js';
import {compileMasks} from '../../app/common/shared/agent/privacy.js';

const objects = [
  {
    name: 'LoginActivity',
    screen: 'Вхід',
    states: [{title: 'стан 1', shot: Buffer.from('jpeg').toString('base64')}],
    elements: [{type: 'TextView', text: 'Картка 4111 1111 1111 1111', actions: ['text'], locators: [['id', 'title']]}],
  },
  {name: 'MainActivity', screen: 'Головна', states: [{title: 'стан 1'}], elements: []},
];

describe('where the bridge finds the station', () => {
  it('takes the folder given, or where the app keeps its data', () => {
    expect(stationDataDir({env: {STATION_DATA_DIR: '/tmp/x'}})).toBe('/tmp/x');
    expect(stationDataDir({env: {}, platform: 'darwin', home: '/Users/qa'})).toBe(
      '/Users/qa/Library/Application Support/vision-inspector',
    );
    expect(stationDataDir({env: {}, platform: 'linux', home: '/home/qa'})).toBe('/home/qa/.config/vision-inspector');
  });
});

describe('the test agent reads packages from the station', () => {
  let dir;
  let packages;
  let mcp;
  let allowed;
  const accessed = [];
  const profiles = async () => ({
    activeId: 'p-1',
    list: [
      {id: 'p-1', name: 'Bank'},
      {id: 'p-2', name: 'Other'},
    ],
  });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'external-'));
    packages = createPackagesStore(path.join(dir, 'autotests'));
    allowed = true;
    mcp = createStationMcp({
      tools: [],
      external: {
        tools: externalTools({packages, profiles, masks: async () => compileMasks()}),
        allowed: async () => allowed,
        onAccess: (tool) => accessed.push(tool),
      },
    });
    const {port} = await mcp.start();
    await writeConnection(dir, {port, token: mcp.externalToken});
  });
  afterEach(async () => {
    await mcp.stop();
    await rm(dir, {recursive: true, force: true});
  });

  it('keeps the connection in a file only this user reads', async () => {
    expect((await stat(path.join(dir, 'external-agents.json'))).mode & 0o777).toBe(0o600);
    expect(await readConnection(dir)).toMatchObject({token: mcp.externalToken});
  });

  it('lists the packages and gives one with its code, marking it taken', async () => {
    const saved = await packages.save('p-1', {name: 'Вхід', platform: 'android', objects});
    await packages.update('p-1', saved.id, (pack) => {
      pack.objects[0].code = 'class LoginActivity';
      return pack;
    });
    const list = await callStation(dir, 'autotests_packages', {});
    expect(list.ok).toBe(true);
    expect(list.text).toContain('«Вхід»');
    expect(list.text).toContain('2 screen objects, 1 with code');

    const one = await callStation(dir, 'autotests_package_get', {package: 'Вхід', elements: true, screenshots: true});
    expect(one.text).toContain('class LoginActivity');
    expect(one.text).toContain('No code yet');
    expect(one.text).toContain('locators: id: title');
    expect(one.text).not.toContain('4111');
    expect(one.images).toHaveLength(1);
    expect((await packages.list('p-1'))[0].takenAt).not.toBeNull();
    expect(accessed).toEqual(['autotests_packages', 'autotests_package_get']);
  });

  it('explains instead of failing: unknown names, access off, no station', async () => {
    expect((await callStation(dir, 'autotests_packages', {project: 'Nope'})).text).toContain('no project «Nope»');
    expect((await callStation(dir, 'autotests_packages', {project: 'Other'})).text).toContain('no packages');
    allowed = false;
    expect(await callStation(dir, 'autotests_packages', {})).toMatchObject({ok: false});
    await removeConnection(dir);
    expect((await callStation(dir, 'autotests_packages', {})).text).toContain('not running');
  });

  it('does not let the token of an external agent reach the station agent', async () => {
    const {port} = await readConnection(dir);
    const response = await fetch(`http://127.0.0.1:${port}/mcp/x`, {
      method: 'POST',
      headers: {authorization: `Bearer ${mcp.externalToken}`, 'content-type': 'application/json'},
      body: '{}',
    });
    expect(response.status).toBe(401);
    const wrong = await fetch(`http://127.0.0.1:${port}/external/autotests_packages`, {
      method: 'POST',
      headers: {authorization: `Bearer ${mcp.token}`},
      body: '{}',
    });
    expect(wrong.status).toBe(403);
  });
});
