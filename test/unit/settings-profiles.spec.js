import {describe, expect, it} from 'vitest';

import {
  BUILD_JOBS,
  GITLAB_CONFIG,
  JIRA_CONFIG,
  LOG_RULES_CONFIG,
  PREFERRED_LANGUAGE,
  PROXY_CONFIG,
  PROXY_VIEW,
} from '../../app/common/shared/setting-defs.js';
import {
  activeProfile,
  addProfile,
  ensureProfiles,
  profileForApp,
  projectApps,
  removeProfile,
  renameProfile,
  setProfileApps,
  switchProfile,
} from '../../app/common/shared/settings/profiles.js';

const projectA = {
  [PREFERRED_LANGUAGE]: 'uk',
  [PROXY_CONFIG]: {port: 9000, mockRules: [{id: 'a'}], trafficRules: {slow: {defaultMs: 900}}},
  [PROXY_VIEW]: {view: 'hosts', hiddenHosts: ['ads.io'], onlyHosts: [], expanded: []},
  [LOG_RULES_CONFIG]: {overrides: {}, custom: [{id: 'pay', pattern: 'PAY'}]},
  [BUILD_JOBS]: {'mobile/a': ['build']},
  [GITLAB_CONFIG]: {url: 'https://git.acme.io', project: 'mobile/a'},
  [JIRA_CONFIG]: {url: 'https://acme.atlassian.net', email: 'qa@acme.io', issueType: 'Bug', labels: ['a']},
};

const apply = (all, patch) => ({...all, ...patch});

describe('project profiles', () => {
  it('makes the first profile from what the station has, and keeps an existing one', () => {
    const {profiles, created} = ensureProfiles(null, projectA, 'Мій проєкт');
    expect(created).toBe(true);
    expect(profiles.list).toHaveLength(1);
    expect(activeProfile(profiles)).toMatchObject({name: 'Мій проєкт', apps: []});
    expect(activeProfile(profiles).groups.proxy.trafficRules).toEqual({slow: {defaultMs: 900}});
    expect(activeProfile(profiles).groups.proxy.port).toBeUndefined();
    expect(ensureProfiles(profiles, projectA, 'x')).toEqual({profiles, created: false});
  });

  it('switches: keeps the current settings in their profile and brings the next one, the station stays', () => {
    let {profiles} = ensureProfiles(null, projectA, 'A');
    const added = addProfile(profiles, 'B');
    profiles = added.profiles;

    // the person changes a rule of A before switching
    const changedA = {...projectA, [LOG_RULES_CONFIG]: {overrides: {}, custom: []}};
    const toB = switchProfile(profiles, added.profile.id, changedA);
    const onB = apply(changedA, toB.patch);
    expect(toB.profiles.activeId).toBe(added.profile.id);
    // an empty profile starts from the defaults
    expect(onB[PROXY_CONFIG]).toMatchObject({mockRules: [], trafficRules: {}, port: 9000});
    expect(onB[PROXY_VIEW].hiddenHosts).toEqual([]);
    expect(onB[BUILD_JOBS]).toEqual({});
    expect(onB[GITLAB_CONFIG]).toEqual({url: 'https://git.acme.io', project: ''});
    expect(onB[JIRA_CONFIG]).toEqual({url: 'https://acme.atlassian.net', email: 'qa@acme.io'});
    expect(onB[PREFERRED_LANGUAGE]).toBe('uk');

    const firstId = toB.profiles.list[0].id;
    const backToA = switchProfile(toB.profiles, firstId, onB);
    const onA = apply(onB, backToA.patch);
    expect(onA[LOG_RULES_CONFIG]).toEqual({overrides: {}, custom: []});
    expect(onA[PROXY_CONFIG]).toMatchObject({port: 9000, mockRules: [{id: 'a'}]});
    expect(onA[PROXY_VIEW].hiddenHosts).toEqual(['ads.io']);
    expect(onA[JIRA_CONFIG]).toMatchObject({issueType: 'Bug', email: 'qa@acme.io'});
    expect(onA[GITLAB_CONFIG].project).toBe('mobile/a');
  });

  it('copies, renames with a free name, and never deletes the last profile', () => {
    let {profiles} = ensureProfiles(null, projectA, 'A');
    const copy = addProfile(profiles, 'A', {copyFrom: profiles.activeId, all: projectA});
    expect(copy.profile.name).toBe('A (2)');
    expect(copy.profile.groups.logs.custom).toEqual([{id: 'pay', pattern: 'PAY'}]);
    profiles = renameProfile(copy.profiles, copy.profile.id, 'Staging');
    expect(profiles.list.map((profile) => profile.name)).toEqual(['A', 'Staging']);

    const removed = removeProfile(profiles, profiles.activeId, projectA);
    expect(removed.profiles.list.map((profile) => profile.name)).toEqual(['Staging']);
    expect(removed.profiles.activeId).toBe(copy.profile.id);
    expect(apply(projectA, removed.patch)[LOG_RULES_CONFIG].custom).toHaveLength(1);
    expect(removeProfile(removed.profiles, removed.profiles.activeId, projectA)).toBeNull();
  });

  it('finds the profile an app belongs to; an app belongs to one profile', () => {
    let {profiles} = ensureProfiles(null, projectA, 'A');
    const b = addProfile(profiles, 'B');
    profiles = setProfileApps(b.profiles, profiles.activeId, [{id: 'ua.acme.bank', platform: 'android'}, ' ']);
    profiles = setProfileApps(profiles, b.profile.id, [
      {id: 'ua.acme.shop', platform: 'ios'},
      {id: 'ua.acme.bank', platform: 'android'},
    ]);
    expect(profiles.list[0].apps).toEqual([]);
    expect(profileForApp(profiles, 'ua.acme.bank')).toMatchObject({name: 'B'});
    expect(profileForApp(profiles, 'ua.other')).toBeNull();
    const onB = switchProfile(profiles, b.profile.id, projectA).profiles;
    expect(profileForApp(onB, 'ua.acme.shop')).toBeNull();
  });

  it('keeps one app for each platform and reads old ids as for either platform', () => {
    expect(
      projectApps([
        'ua.acme.old',
        {id: ' ua.acme.bank ', platform: 'android'},
        {id: 'ua.acme.beta', platform: 'android'},
        {id: 'ua.pb.acme', platform: 'ios'},
        {id: 'ua.acme.bank', platform: 'ios'},
        {id: '', platform: 'ios'},
      ]),
    ).toEqual([
      {id: 'ua.acme.bank', platform: 'android'},
      {id: 'ua.pb.acme', platform: 'ios'},
      {id: 'ua.acme.old', platform: null},
    ]);
    // an old id typed into a platform field takes the platform
    expect(projectApps(['ua.acme.bank', {id: 'ua.acme.bank', platform: 'android'}])).toEqual([
      {id: 'ua.acme.bank', platform: 'android'},
    ]);
  });
});
