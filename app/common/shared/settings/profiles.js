import {PROFILE_GROUPS, readGroups, writeGroups} from './groups.js';

// The settings of the profile that is on live in the setting keys, where the
// tools read them. The other profiles keep theirs in PROFILES; switching
// keeps the current one there and writes the next one into the keys.

const newId = () => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const now = () => new Date().toISOString();

/**
 * The profiles, made the first time: what the station has now becomes the
 * first profile, so nothing is lost.
 * @returns {{profiles: object, created: boolean}}
 */
export function ensureProfiles(profiles, all, firstName) {
  if (profiles?.list?.length && profiles.list.some((profile) => profile.id === profiles.activeId)) {
    return {profiles, created: false};
  }
  if (profiles?.list?.length) {
    return {profiles: {...profiles, activeId: profiles.list[0].id}, created: false};
  }
  const first = {id: newId(), name: firstName, apps: [], updatedAt: now(), groups: readGroups(all, PROFILE_GROUPS)};
  return {profiles: {activeId: first.id, list: [first]}, created: true};
}

export const activeProfile = (profiles) => profiles?.list.find((profile) => profile.id === profiles.activeId) ?? null;

/** The profiles with the one that is on holding what the keys hold now. */
export function keepActive(profiles, all) {
  return {
    ...profiles,
    list: profiles.list.map((profile) =>
      profile.id === profiles.activeId
        ? {...profile, groups: readGroups(all, PROFILE_GROUPS), updatedAt: now()}
        : profile,
    ),
  };
}

/**
 * Turns another profile on.
 * @returns {{profiles: object, patch: object}} the profiles to save and the setting keys to write
 */
export function switchProfile(profiles, targetId, all) {
  const target = profiles.list.find((profile) => profile.id === targetId);
  if (!target || targetId === profiles.activeId) {
    return {profiles, patch: {}};
  }
  const kept = keepActive(profiles, all);
  return {profiles: {...kept, activeId: targetId}, patch: profilePatch(target, all)};
}

/** The setting keys that hold a profile's settings, with the station's parts kept. */
export function profilePatch(profile, all) {
  return writeGroups(all, Object.fromEntries(PROFILE_GROUPS.map((id) => [id, profile.groups?.[id]])));
}

/**
 * A new profile, empty or a copy of the one that is on. It is not turned on.
 */
export function addProfile(profiles, name, {copyFrom = null, all = {}, groups = null, apps = []} = {}) {
  const source = copyFrom ? keepActive(profiles, all).list.find((profile) => profile.id === copyFrom) : null;
  const profile = {
    id: newId(),
    name: uniqueName(profiles, name),
    apps: source ? [] : apps,
    updatedAt: now(),
    groups: structuredClone(groups ?? source?.groups ?? {}),
  };
  return {profiles: {...profiles, list: [...profiles.list, profile]}, profile};
}

export function uniqueName(profiles, name) {
  const taken = new Set(profiles.list.map((profile) => profile.name));
  const base = String(name ?? '').trim() || 'Profile';
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) {
    candidate = `${base} (${n})`;
  }
  return candidate;
}

export function renameProfile(profiles, id, name) {
  const others = {...profiles, list: profiles.list.filter((profile) => profile.id !== id)};
  return {
    ...profiles,
    list: profiles.list.map((profile) =>
      profile.id === id ? {...profile, name: uniqueName(others, name), updatedAt: now()} : profile,
    ),
  };
}

/** Which apps (bundle ids, packages) a profile is for; an app belongs to one profile. */
export function setProfileApps(profiles, id, apps) {
  const wanted = [...new Set(apps.map((app) => app.trim()).filter(Boolean))];
  return {
    ...profiles,
    list: profiles.list.map((profile) =>
      profile.id === id
        ? {...profile, apps: wanted, updatedAt: now()}
        : {...profile, apps: (profile.apps ?? []).filter((app) => !wanted.includes(app))},
    ),
  };
}

/**
 * Deletes a profile; the last one stays. Deleting the one that is on turns
 * the first other one on.
 * @returns {{profiles: object, patch: object} | null} null when it cannot be deleted
 */
export function removeProfile(profiles, id, all) {
  if (profiles.list.length < 2 || !profiles.list.some((profile) => profile.id === id)) {
    return null;
  }
  const list = profiles.list.filter((profile) => profile.id !== id);
  if (id !== profiles.activeId) {
    return {profiles: {...profiles, list}, patch: {}};
  }
  const next = list[0];
  return {profiles: {activeId: next.id, list}, patch: profilePatch(next, all)};
}

/** The profile an app belongs to, if it is not the one that is on. */
export function profileForApp(profiles, appId) {
  if (!profiles || !appId) {
    return null;
  }
  const owner = profiles.list.find((profile) => (profile.apps ?? []).includes(appId));
  return owner && owner.id !== profiles.activeId ? owner : null;
}
