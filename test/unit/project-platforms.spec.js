import {describe, expect, it} from 'vitest';

import {
  appOfProject,
  cleanPlatforms,
  makeMulti,
  migrateProfile,
  platformKey,
  platformOfDevice,
  projectAdvice,
  projectAppsOf,
  rulePlatform,
  setPlatforms,
  splitMulti,
} from '../../app/common/shared/settings/platforms.js';
import {addProfile, ensureProfiles, setProfilePlatforms} from '../../app/common/shared/settings/profiles.js';

const old = (apps, repos, branches = {}) => ({id: 'p1', name: 'Bank', apps, source: {...branches, repos}});

describe('the platforms of a project', () => {
  it('are Android and iOS in this order, or «multi» alone, never none', () => {
    expect(cleanPlatforms(['ios', 'android', 'tv'])).toEqual(['android', 'ios']);
    expect(cleanPlatforms(['multi', 'android'])).toEqual(['multi']);
    expect(cleanPlatforms([], 'ios')).toEqual(['ios']);
    expect(cleanPlatforms(undefined)).toEqual(['android']);
  });

  it('start a new project with the platform asked for, Android without one', () => {
    const {profiles} = ensureProfiles(null, {}, 'A');
    expect(profiles.list[0].platforms).toEqual(['android']);
    const added = addProfile(profiles, 'B', {platforms: ['ios']});
    expect(added.profile.platforms).toEqual(['ios']);
    expect(added.profile.source.branches).toEqual({ios: {dev: 'develop', release: 'main'}});
  });

  it('tell the device platform the station names', () => {
    expect(platformOfDevice({platformName: 'Android'})).toBe('android');
    expect(platformOfDevice({platformName: 'iOS'})).toBe('ios');
    expect(platformOfDevice(null)).toBe(null);
  });
});

describe('a profile of the time before the platforms', () => {
  it('goes to the one platform of its app, with the app repository and the branches', () => {
    const moved = migrateProfile(
      old([{id: 'ua.bank', platform: 'android'}], [{id: 'r1', name: 'ap24v6', role: 'app'}], {
        devBranch: 'dev',
        releaseBranch: 'main',
      }),
    );
    expect(moved.platforms).toEqual(['android']);
    expect(moved.source).toEqual({
      branches: {android: {dev: 'dev', release: 'main'}},
      repos: [{id: 'r1', name: 'ap24v6', platform: 'android'}],
    });
  });

  it('puts Android and iOS repositories in theirs and a backend in the shared code', () => {
    const moved = migrateProfile(
      old(
        [],
        [
          {id: 'a', role: 'android'},
          {id: 'i', role: 'ios'},
          {id: 'b', role: 'backend'},
          {id: 'o', role: 'other'},
        ],
      ),
    );
    expect(moved.platforms).toEqual(['android', 'ios']);
    expect(moved.source.repos.map((repo) => [repo.id, repo.platform])).toEqual([
      ['a', 'android'],
      ['i', 'ios'],
      ['b', 'shared'],
      ['o', 'shared'],
    ]);
  });

  it('becomes «multi» with both apps and one app repository', () => {
    const moved = migrateProfile(
      old(
        [
          {id: 'ua.bank', platform: 'android'},
          {id: 'ua.bank.ios', platform: 'ios'},
        ],
        [{id: 'r1', role: 'app'}],
      ),
    );
    expect(moved.platforms).toEqual(['multi']);
    expect(moved.source.repos).toEqual([{id: 'r1', name: 'r1', platform: 'multi'}]);
    expect(projectAppsOf(moved)).toHaveLength(2);
  });

  it('puts an app repository it cannot place in Android, marked for the person to check', () => {
    const none = migrateProfile(old([], [{id: 'r1', name: 'ap24v6', role: 'app'}]));
    expect(none.platforms).toEqual(['android']);
    expect(none.source.repos).toEqual([{id: 'r1', name: 'ap24v6', platform: 'android', guessed: true}]);
    const both = migrateProfile(
      old(
        [{id: 'x', platform: 'ios'}],
        [
          {id: 'r1', role: 'app'},
          {id: 'r2', role: 'ios'},
        ],
      ),
    );
    expect(both.platforms).toEqual(['ios']);
    expect(both.source.repos[0]).toEqual({id: 'r1', name: 'r1', platform: 'ios'});
  });

  it('gives an id without a platform to the one platform there is', () => {
    const moved = migrateProfile(old(['ua.bank'], [{id: 'r1', role: 'android'}]));
    expect(moved.apps).toEqual([{id: 'ua.bank', platform: 'android'}]);
  });

  it('is moved once when the profiles are read, and said so to be saved', () => {
    const {profiles, migrated} = ensureProfiles({activeId: 'p1', list: [old([], [])]}, {}, 'x');
    expect(migrated).toBe(true);
    expect(profiles.list[0].platforms).toEqual(['android']);
    expect(ensureProfiles(profiles, {}, 'x').migrated).toBe(false);
  });
});

describe('the platform the station works with', () => {
  const native = migrateProfile({
    id: 'n',
    name: 'Native',
    platforms: ['android'],
    apps: [{id: 'ua.bank', platform: 'android'}],
  });
  const multi = migrateProfile({
    id: 'm',
    name: 'Flutter',
    platforms: ['multi'],
    apps: [{id: 'ua.app', platform: 'android'}],
  });
  const iosOne = migrateProfile({
    id: 'i',
    name: 'Bank iOS',
    platforms: ['ios'],
    apps: [{id: 'ua.ios', platform: 'ios'}],
  });

  it('is the device platform when the project has it, «multi» for one code', () => {
    expect(platformKey(native, 'android')).toBe('android');
    expect(platformKey(native, 'ios')).toBe(null);
    expect(platformKey(multi, 'ios')).toBe('multi');
    expect(appOfProject(multi, 'android')).toEqual({id: 'ua.app', platform: 'android'});
  });

  it('says the project is not for the device, and which profile is', () => {
    expect(projectAdvice({profile: native, profiles: [native, multi, iosOne], devicePlatform: 'ios'})).toEqual({
      kind: 'noPlatform',
      platform: 'ios',
      project: 'Native',
      only: 'android',
      other: {id: 'i', name: 'Bank iOS'},
    });
  });

  it('names the app that is missing, in its section', () => {
    expect(projectAdvice({profile: multi, profiles: [multi], devicePlatform: 'ios'})).toEqual({
      kind: 'noApp',
      platform: 'ios',
      section: 'multi',
      project: 'Flutter',
    });
    expect(projectAdvice({profile: native, devicePlatform: 'android'})).toBe(null);
    expect(projectAdvice({profile: native, devicePlatform: null})).toBe(null);
  });
});

describe('changing the platforms', () => {
  const both = migrateProfile({
    id: 'p',
    name: 'Bank',
    platforms: ['android', 'ios'],
    apps: [
      {id: 'ua.a', platform: 'android'},
      {id: 'ua.i', platform: 'ios'},
    ],
    source: {
      branches: {android: {dev: 'dev'}, ios: {dev: 'develop'}},
      repos: [
        {id: 'a', platform: 'android'},
        {id: 'i', platform: 'ios'},
        {id: 's', platform: 'shared'},
      ],
    },
  });

  it('takes a platform out with its app and repositories, never the last one', () => {
    const android = setPlatforms(both, ['android']);
    expect(android.platforms).toEqual(['android']);
    expect(android.apps).toEqual([{id: 'ua.a', platform: 'android'}]);
    expect(android.source.repos.map((repo) => repo.id)).toEqual(['a', 's']);
    expect(setPlatforms(android, []).platforms).toEqual(['android']);
  });

  it('makes Android and iOS one code and splits it back', () => {
    const multi = makeMulti(both);
    expect(multi.platforms).toEqual(['multi']);
    expect(multi.apps).toHaveLength(2);
    expect(multi.source.branches).toEqual({multi: {dev: 'dev', release: 'main'}});
    expect(multi.source.repos.map((repo) => repo.platform)).toEqual(['multi', 'multi', 'shared']);
    const split = splitMulti(multi);
    expect(split.platforms).toEqual(['android', 'ios']);
    expect(split.source.repos.map((repo) => repo.platform)).toEqual(['android', 'android', 'shared']);
  });

  it('goes through the profiles', () => {
    const profiles = {activeId: 'p', list: [both]};
    expect(setProfilePlatforms(profiles, 'p', 'multi').list[0].platforms).toEqual(['multi']);
    expect(setProfilePlatforms(profiles, 'p', ['ios']).list[0].platforms).toEqual(['ios']);
  });
});

describe('the build sources of a platform', () => {
  it('belong to their own platform, the one platform, or the one their GitLab path names', () => {
    expect(rulePlatform({project: 'mob/app', platform: 'ios'}, ['android', 'ios'])).toBe('ios');
    expect(rulePlatform({project: 'mob/app'}, ['ios'])).toBe('ios');
    expect(rulePlatform({project: 'p24-front-end-mob/ios/ap24'}, ['android', 'ios'])).toBe('ios');
    expect(rulePlatform({project: 'p24-front-end-mob/android/ap24v6'}, ['android', 'ios'])).toBe('android');
    expect(rulePlatform({project: 'mob/bios-tools'}, ['android', 'ios'])).toBe('android');
    expect(rulePlatform({project: 'x', platform: 'android'}, ['multi'])).toBe('multi');
  });
});
