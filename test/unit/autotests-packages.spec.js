import {mkdtemp, readdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {createPackagesStore} from '../../app/common/node/autotests/packages.js';

const SHOT = Buffer.from('jpeg').toString('base64');

const objects = [
  {
    name: 'LoginActivity',
    screen: 'Вхід',
    states: [{title: 'стан 1', shot: SHOT}],
    elements: [{type: 'Button', actions: ['tap'], locators: [['id', 'next']]}],
  },
  {name: 'MainActivity', screen: 'Головна', states: [{title: 'стан 1', shot: null}], elements: []},
];

describe('packages of screen objects', () => {
  let dir;
  let store;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'packages-'));
    store = createPackagesStore(dir);
  });
  afterEach(async () => {
    await rm(dir, {recursive: true, force: true});
  });

  it('keeps a package with its screen objects and the screenshots apart', async () => {
    const saved = await store.save('p-1', {name: 'Вхід', platform: 'android', app: {id: 'ua.bank'}, objects});
    expect(saved).toMatchObject({name: 'Вхід', objects: 2, generated: 0, ready: false});
    const pack = await store.get('p-1', saved.id);
    expect(pack.objects[0].elements).toHaveLength(1);
    expect(pack.objects[0].states[0].shot).toMatch(/\.jpg$/);
    expect(pack.objects[1].states[0].shot).toBeNull();
    expect(await store.shot('p-1', saved.id, pack.objects[0].states[0].shot)).toBe(SHOT);
    expect((await readdir(path.join(dir, 'p-1', saved.id))).length).toBe(2);
  });

  it('lists the packages of a project, newest first, without their elements', async () => {
    await store.save('p-1', {name: 'old', platform: 'ios', objects}, new Date('2026-10-01'));
    await store.save('p-1', {name: 'new', platform: 'ios', objects}, new Date('2026-10-02'));
    await store.save('p-2', {name: 'other', platform: 'ios', objects});
    const list = await store.list('p-1');
    expect(list.map((one) => one.name)).toEqual(['new', 'old']);
    expect(list[0].elements).toBeUndefined();
    expect(await store.list('p-none')).toEqual([]);
  });

  it('changes and removes a package', async () => {
    const {id} = await store.save('p-1', {name: 'a', platform: 'android', objects});
    await store.update('p-1', id, (pack) => ({...pack, name: 'b', ready: true}));
    expect((await store.list('p-1'))[0]).toMatchObject({name: 'b', ready: true});
    await store.remove('p-1', id);
    expect(await store.list('p-1')).toEqual([]);
  });

  it('reads nothing outside its folder', async () => {
    await expect(store.get('../x', 'y')).resolves.toBeNull();
    expect(await store.shot('p-1', 'pk-1', '../../secret')).toBeNull();
    await expect(store.remove('p-1', '../..')).rejects.toThrow('Not a package');
  });
});

describe('the autotests repository', () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'autotests-'));
  });
  afterEach(async () => {
    await rm(dir, {recursive: true, force: true});
  });

  it('says what the generation lacks', async () => {
    const {execFileSync} = await import('node:child_process');
    const {mkdir, writeFile} = await import('node:fs/promises');
    const {inspectAutotests, readRules} = await import('../../app/common/node/autotests/repo.js');
    expect(await inspectAutotests(null, {})).toMatchObject({ok: false, missing: ['folder']});
    expect(await inspectAutotests(dir, {})).toMatchObject({ok: false, error: 'notRepo'});

    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    expect(await inspectAutotests(dir, {examples: 'screens'})).toMatchObject({
      ok: true,
      branch: 'main',
      rules: false,
      missing: ['rules', 'examples'],
    });

    await mkdir(path.join(dir, '.station'));
    await writeFile(path.join(dir, '.station', 'screen-objects.md'), '# Rules');
    await mkdir(path.join(dir, 'screens', 'login'), {recursive: true});
    await writeFile(path.join(dir, 'screens', 'login', 'LoginScreen.kt'), 'class LoginScreen');
    expect(await inspectAutotests(dir, {examples: 'screens'})).toMatchObject({
      ok: true,
      rules: true,
      examples: {found: true, files: 1},
      missing: [],
    });
    expect(await readRules(dir, {})).toBe('# Rules');
  });
});
