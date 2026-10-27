import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {createStationSettings} from '../../app/common/node/settings/station-settings.js';
import {
  AI_CONFIG,
  BUILDS_HISTORY,
  GITLAB_CONFIG,
  JIRA_CONFIG,
  LOG_RULES_CONFIG,
  PIPELINE_WATCHES,
  PREFERRED_THEME,
  PROFILES,
  PROXY_CONFIG,
  SAVED_SESSIONS,
  SESSION_SERVER_PARAMS,
  SOURCE_PATHS,
  WORKSTATION,
} from '../../app/common/shared/setting-defs.js';
import {ensureProfiles, setProfileApps, setProfileSource} from '../../app/common/shared/settings/profiles.js';
import {
  applyImport,
  buildExport,
  parseSettingsFile,
  SETTINGS_FORMAT,
  summarizeImport,
} from '../../app/common/shared/settings/transfer.js';

const SECRETS = {
  JIRA_TOKEN_ENCRYPTED: 'c2VjcmV0LWppcmE=',
  GITLAB_TOKEN_ENCRYPTED: 'c2VjcmV0LWdpdGxhYg==',
  AI_KEY_ENCRYPTED: 'c2VjcmV0LWFp',
};

const station = () => ({
  ...SECRETS,
  [PREFERRED_THEME]: 'dark',
  [JIRA_CONFIG]: {url: 'https://acme.atlassian.net', email: 'qa@acme.io', issueType: 'Bug'},
  [GITLAB_CONFIG]: {url: 'https://git.acme.io', project: 'mobile/app'},
  [AI_CONFIG]: {provider: 'gemini', model: 'flash', consent: true, apiKey: 'leaked'},
  [PROXY_CONFIG]: {port: 8890, mockRules: [], trafficRules: {duplicates: {ignoreParams: ['ts']}}},
  [LOG_RULES_CONFIG]: {overrides: {}, custom: [{id: 'pay'}]},
  [SAVED_SESSIONS]: [
    {name: 'Pixel', caps: [{name: 'appium:deviceName', value: 'Pixel'}], server: {sauce: {accessKey: 'sauce-key'}}},
  ],
  [SESSION_SERVER_PARAMS]: {sauce: {username: 'me', accessKey: 'sauce-key'}},
  [WORKSTATION]: {deviceId: 'emulator-5554', app: {id: 'ua.acme'}},
  [BUILDS_HISTORY]: [{path: '/Users/me/app.apk'}],
  [PIPELINE_WATCHES]: [{url: 'https://git.acme.io/p/1'}],
});

const memoryStore = (values) => {
  const map = new Map(Object.entries(values));
  return {map, get: async (key) => map.get(key), set: async (key, value) => void map.set(key, value)};
};

const profilesOf = (all) => ensureProfiles(null, all, 'Мій проєкт').profiles;

describe('export', () => {
  it('writes the format, version, product and date with the profile only', () => {
    const all = station();
    const file = buildExport({
      profiles: profilesOf(all),
      all,
      kind: 'profile',
      product: 'Station#1',
      now: new Date('2026-10-26T10:00:00Z'),
    });
    expect(file).toMatchObject({format: SETTINGS_FORMAT, version: 1, product: 'Station#1', kind: 'profile'});
    expect(file.exportedAt).toBe('2026-10-26T10:00:00.000Z');
    expect(file.station).toBeUndefined();
    expect(file.profiles).toHaveLength(1);
    expect(Object.keys(file.profiles[0].groups)).toEqual(['proxy', 'logs', 'filters', 'a11y', 'builds', 'jira']);
  });

  it('puts only the chosen groups in', () => {
    const all = station();
    const file = buildExport({profiles: profilesOf(all), all, kind: 'all', groups: ['proxy', 'general'], product: 'x'});
    expect(Object.keys(file.station)).toEqual(['general']);
    expect(Object.keys(file.profiles[0].groups)).toEqual(['proxy']);
  });

  it('never carries tokens, keys, server params, the AI consent or the device of this Mac', () => {
    const all = station();
    const text = JSON.stringify(buildExport({profiles: profilesOf(all), all, kind: 'all', product: 'x'}));
    for (const secret of [...Object.values(SECRETS), 'sauce-key', 'leaked']) {
      expect(text).not.toContain(secret);
    }
    for (const word of ['_ENCRYPTED', 'consent', '"server"', 'emulator-5554', 'app.apk', 'git.acme.io/p/1']) {
      expect(text).not.toContain(word);
    }
    expect(text).toContain('acme.atlassian.net');
    expect(text).toContain('Pixel');
  });
});

describe('the code of a profile', () => {
  const code = {
    devBranch: 'dev',
    releaseBranch: 'release',
    repos: [
      {id: 'r-app', name: 'bank-android', role: 'android'},
      {id: 'r-ui', name: 'design', role: 'shared'},
    ],
  };
  const withCode = (all) => {
    const profiles = profilesOf(all);
    return setProfileSource(profiles, profiles.activeId, code);
  };

  it('goes out with the branches and repositories, never with the folders of this Mac', () => {
    const all = {...station(), [SOURCE_PATHS]: {any: {'r-app': {path: '/Users/me/code/bank-android'}}}};
    const file = buildExport({profiles: withCode(all), all, kind: 'all', product: 'x'});
    expect(file.profiles[0].source).toEqual(code);
    expect(JSON.stringify(file)).not.toContain('/Users/me/code');
  });

  it('comes back with the same repositories, so the folders here still fit', () => {
    const all = station();
    const text = JSON.stringify(buildExport({profiles: withCode(all), all, kind: 'profile', product: 'x'}));
    const file = parseSettingsFile(text).file;
    expect(file.profiles[0].source).toEqual(code);

    const here = profilesOf(station());
    const replaced = applyImport(file, here, station(), {profiles: [{index: 0, mode: 'replace', groups: []}]});
    expect(replaced.profiles.list[0].source).toEqual(code);
    const added = applyImport(file, here, station(), {profiles: [{index: 0, mode: 'new', groups: []}]});
    expect(added.profiles.list[1].source).toEqual(code);
  });

  it('keeps the code here for a file made before the code, and refuses a broken one', () => {
    const all = station();
    const data = JSON.parse(
      JSON.stringify(buildExport({profiles: profilesOf(all), all, kind: 'profile', product: 'x'})),
    );
    delete data.profiles[0].source;
    const file = parseSettingsFile(JSON.stringify(data)).file;
    const here = withCode(station());
    const {profiles} = applyImport(file, here, station(), {profiles: [{index: 0, mode: 'replace', groups: []}]});
    expect(profiles.list[0].source).toEqual(code);

    data.profiles[0].source = {repos: 'bank-android'};
    expect(parseSettingsFile(JSON.stringify(data))).toMatchObject({ok: false, error: 'shape', detail: 'source'});
  });
});

describe('import', () => {
  const exportOf = (all, kind = 'all') =>
    JSON.stringify(buildExport({profiles: profilesOf(all), all, kind, product: 'x'}));

  it('explains what is wrong and changes nothing', () => {
    expect(parseSettingsFile('{not json')).toMatchObject({ok: false, error: 'json'});
    expect(parseSettingsFile('{"format":"charles"}')).toMatchObject({ok: false, error: 'format'});
    expect(parseSettingsFile(JSON.stringify({format: SETTINGS_FORMAT, version: 9}))).toMatchObject({
      ok: false,
      error: 'version',
    });
    const bad = JSON.parse(exportOf(station()));
    bad.profiles[0].groups.logs = {custom: 'all of them'};
    expect(parseSettingsFile(JSON.stringify(bad))).toMatchObject({ok: false, error: 'shape', detail: 'logs'});
    expect(parseSettingsFile(JSON.stringify({format: SETTINGS_FORMAT, version: 1}))).toMatchObject({
      ok: false,
      error: 'empty',
    });
  });

  it('drops tokens, keys, server params and unknown keys someone put in the file', () => {
    const data = JSON.parse(exportOf(station()));
    data.station.integrations.jira.apiToken = 'planted';
    data.station.inspector.sessions[0].server = {sauce: {accessKey: 'planted'}};
    data.station.JIRA_TOKEN_ENCRYPTED = 'planted';
    data.station[SESSION_SERVER_PARAMS] = {sauce: {accessKey: 'planted'}};
    data.profiles[0].groups.secrets = {token: 'planted'};
    const parsed = parseSettingsFile(JSON.stringify(data));
    expect(parsed.ok).toBe(true);

    const here = {[PREFERRED_THEME]: 'light', JIRA_TOKEN_ENCRYPTED: 'mine'};
    const {patch} = applyImport(parsed.file, profilesOf(here), here, {
      profiles: [
        {index: 0, mode: 'replace', groups: ['proxy', 'logs', 'filters', 'a11y', 'builds', 'jira', 'secrets']},
      ],
      station: ['general', 'integrations', 'inspector', 'JIRA_TOKEN_ENCRYPTED'],
    });
    expect(JSON.stringify(patch)).not.toContain('planted');
    expect(Object.keys(patch).some((key) => key.endsWith('_ENCRYPTED') || key === SESSION_SERVER_PARAMS)).toBe(false);
    expect(patch[AI_CONFIG].consent).toBe(false);
    expect(patch[PREFERRED_THEME]).toBe('dark');
  });

  it('shows which groups would change and replaces the profile of the same name with the chosen groups', () => {
    const theirs = station();
    const file = parseSettingsFile(exportOf(theirs, 'profile')).file;
    const mine = {...station(), [LOG_RULES_CONFIG]: {overrides: {}, custom: []}};
    const profiles = profilesOf(mine);

    const summary = summarizeImport(file, profiles, mine);
    expect(summary.profiles[0]).toMatchObject({name: 'Мій проєкт', existingId: profiles.activeId});
    expect(summary.profiles[0].groups.filter((group) => group.changed).map((group) => group.id)).toEqual(['logs']);

    const {patch, profiles: next} = applyImport(file, profiles, mine, {
      profiles: [{index: 0, mode: 'replace', groups: ['logs']}],
    });
    expect(next.list).toHaveLength(1);
    expect(patch[LOG_RULES_CONFIG].custom).toEqual([{id: 'pay'}]);
  });

  it('reads apps of old files as plain ids, and an app of a platform in the file replaces the one here', () => {
    const data = JSON.parse(exportOf(station(), 'profile'));
    data.profiles[0].apps = ['ua.acme.old', {id: 'ua.acme.bank2', platform: 'android'}];
    const file = parseSettingsFile(JSON.stringify(data)).file;
    expect(file.profiles[0].apps).toEqual([
      {id: 'ua.acme.bank2', platform: 'android'},
      {id: 'ua.acme.old', platform: null},
    ]);
    data.profiles[0].apps = [{platform: 'ios'}];
    expect(parseSettingsFile(JSON.stringify(data))).toMatchObject({ok: false, error: 'shape', detail: 'apps'});

    const mine = station();
    const here = profilesOf(mine);
    const withApps = setProfileApps(here, here.activeId, [
      {id: 'ua.acme.bank', platform: 'android'},
      {id: 'ua.pb.acme', platform: 'ios'},
    ]);
    const {profiles} = applyImport(file, withApps, mine, {profiles: [{index: 0, mode: 'replace', groups: []}]});
    expect(profiles.list[0].apps).toEqual([
      {id: 'ua.acme.bank2', platform: 'android'},
      {id: 'ua.pb.acme', platform: 'ios'},
      {id: 'ua.acme.old', platform: null},
    ]);
  });

  it('adds a profile as new without touching the one that is on', () => {
    const file = parseSettingsFile(exportOf(station(), 'profile')).file;
    const mine = {[PREFERRED_THEME]: 'light'};
    const {patch, profiles} = applyImport(file, profilesOf(mine), mine, {
      profiles: [{index: 0, mode: 'new', groups: ['logs']}],
    });
    expect(profiles.list.map((profile) => profile.name)).toEqual(['Мій проєкт', 'Мій проєкт (2)']);
    expect(profiles.list[1].groups).toEqual({logs: {overrides: {}, custom: [{id: 'pay'}]}});
    expect(patch).toEqual({});
  });
});

describe('the station settings and their backups', () => {
  let dir;
  let clock;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'station-settings-'));
    clock = new Date('2026-10-26T08:00:00Z');
  });
  afterEach(async () => {
    await rm(dir, {recursive: true, force: true});
  });

  const make = (values = station()) => {
    const store = memoryStore(values);
    const settings = createStationSettings({
      store,
      backupDir: path.join(dir, 'backups'),
      product: 'Station#1',
      firstProfileName: 'Мій проєкт',
      now: () => clock,
    });
    return {store, settings};
  };

  it('keeps a copy before an import and puts the settings back from it', async () => {
    const {store, settings} = make();
    const text = JSON.stringify({
      format: SETTINGS_FORMAT,
      version: 1,
      kind: 'profile',
      profiles: [{name: 'Мій проєкт', groups: {logs: {overrides: {}, custom: []}}}],
    });
    const preview = await settings.previewImport(text);
    expect(preview.summary.profiles[0].groups).toEqual([{id: 'logs', changed: true}]);

    const result = await settings.applyImport(text, {profiles: [{index: 0, mode: 'replace', groups: ['logs']}]});
    expect(result.changedKeys).toContain(LOG_RULES_CONFIG);
    expect(store.map.get(LOG_RULES_CONFIG).custom).toEqual([]);

    const [copy] = await settings.listBackups();
    expect(copy.reason).toBe('before-import');
    const saved = await readFile(path.join(dir, 'backups', copy.file), 'utf8');
    expect(saved).not.toContain('sauce-key');
    expect(saved).not.toContain('_ENCRYPTED');

    clock = new Date('2026-10-26T09:00:00Z');
    expect((await settings.restore(copy.file)).ok).toBe(true);
    expect(store.map.get(LOG_RULES_CONFIG).custom).toEqual([{id: 'pay'}]);
    expect(store.map.get('JIRA_TOKEN_ENCRYPTED')).toBe(SECRETS.JIRA_TOKEN_ENCRYPTED);
    expect((await settings.listBackups()).map((backup) => backup.reason)).toEqual(['before-restore', 'before-import']);
    await expect(settings.restore('../settings.json')).rejects.toThrow('Not a backup');
  });

  it('refuses a broken import and keeps the settings as they were', async () => {
    const {store, settings} = make();
    const before = JSON.stringify([...store.map]);
    expect(await settings.applyImport('{"format":"charles"}', {profiles: []})).toMatchObject({ok: false});
    expect(JSON.stringify([...store.map])).toBe(before);
  });

  it('makes one daily copy a day and keeps the last ten of each kind', async () => {
    const {settings} = make();
    for (let day = 1; day <= 12; day++) {
      clock = new Date(`2026-10-${String(day).padStart(2, '0')}T08:00:00Z`);
      expect(await settings.dailyBackup()).toMatch(/daily\.json$/);
      expect(await settings.dailyBackup()).toBeNull();
      await settings.backup('before-import');
    }
    const backups = await settings.listBackups();
    expect(backups.filter((backup) => backup.reason === 'daily')).toHaveLength(10);
    expect(backups.filter((backup) => backup.reason === 'before-import')).toHaveLength(10);
    expect(backups.at(-1).day).toBe('2026-10-03');
    await writeFile(path.join(dir, 'backups', 'notes.txt'), 'mine');
    expect(await readdir(path.join(dir, 'backups'))).toContain('notes.txt');
  });

  it('keeps the folders of the repositories apart: a copy shares them, a removed repository or profile drops them', async () => {
    const {store, settings} = make();
    const first = await settings.profiles();
    const id = first.activeId;
    await settings.setProfileSource(id, {
      repos: [
        {id: 'r-app', name: 'app'},
        {id: 'r-ui', name: 'ui'},
      ],
    });
    await settings.setSourcePath(id, 'r-app', {path: '/code/app'});
    await settings.setSourcePath(id, 'r-ui', {path: '/code/ui'});
    await settings.setSourcePath(id, 'r-app', {previousBranch: 'develop'});
    expect(await settings.sourcePaths(id)).toEqual({
      'r-app': {path: '/code/app', previousBranch: 'develop'},
      'r-ui': {path: '/code/ui'},
    });
    expect((await settings.profiles()).list[0].source.repos.map((repo) => repo.id)).toEqual(['r-app', 'r-ui']);

    const copy = await settings.addProfile('Копія', {copy: true});
    expect(await settings.sourcePaths(copy.id)).toEqual(await settings.sourcePaths(id));
    expect((await settings.profiles()).list[1].source.repos).toHaveLength(2);

    await settings.setProfileSource(id, {repos: [{id: 'r-app', name: 'app'}]});
    expect(Object.keys(await settings.sourcePaths(id))).toEqual(['r-app']);
    await settings.setSourcePath(id, 'r-app', {path: null});
    expect(await settings.sourcePaths(id)).toEqual({});

    await settings.removeProfile(copy.id);
    expect(store.map.get(SOURCE_PATHS)[copy.id]).toBeUndefined();
    const text = await settings.exportText({kind: 'all'});
    expect(text).not.toContain('/code/');
  });

  it('makes the first profile once and switches profiles through the store', async () => {
    const {store, settings} = make();
    const first = await settings.profiles();
    expect(first.list.map((profile) => profile.name)).toEqual(['Мій проєкт']);
    const added = await settings.addProfile('Інший', {copy: false});
    const switched = await settings.switchProfile(added.id);
    expect(switched.profiles.activeId).toBe(added.id);
    expect(switched.changedKeys).toContain(LOG_RULES_CONFIG);
    expect(store.map.get(LOG_RULES_CONFIG).custom).toEqual([]);
    expect(store.map.get(PROFILES).list).toHaveLength(2);
    await settings.switchProfile(first.activeId);
    expect(store.map.get(LOG_RULES_CONFIG).custom).toEqual([{id: 'pay'}]);
  });
});
