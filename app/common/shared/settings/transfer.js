import {GROUPS, PROFILE_GROUPS, readGroups, STATION_GROUPS, withoutSecrets, writeGroups} from './groups.js';
import {activeProfile, addProfile, keepActive, profilePatch, setProfileApps} from './profiles.js';

// The file the settings travel in between Macs and people. It holds groups
// of settings only (see groups.js), never tokens or keys.

export const SETTINGS_FORMAT = 'station-settings';
export const SETTINGS_VERSION = 1;

// the same value whatever order its keys come in
const stable = (value) =>
  JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.keys(inner)
            .sort()
            .map((key) => [key, inner[key]]),
        )
      : inner,
  );

const sameValue = (a, b) => stable(a ?? null) === stable(b ?? null);

/**
 * The export file: one profile to share with the team, or every profile and
 * the station's settings to move to another Mac.
 * @param {object} options
 * @param {'profile' | 'all'} options.kind
 * @param {string} [options.profileId] the profile, for a profile file
 * @param {string[]} [options.groups] the groups to put in; all of them when left out
 */
export function buildExport({profiles, all, kind, profileId, groups, product, now = new Date()}) {
  const kept = keepActive(profiles, all);
  const wanted = (ids) => ids.filter((id) => !groups || groups.includes(id));
  const profileEntry = (profile) => ({
    name: profile.name,
    apps: profile.apps ?? [],
    groups: Object.fromEntries(
      wanted(PROFILE_GROUPS)
        .filter((id) => profile.groups?.[id] !== undefined)
        .map((id) => [id, profile.groups[id]]),
    ),
  });
  const file = {
    format: SETTINGS_FORMAT,
    version: SETTINGS_VERSION,
    product,
    exportedAt: now.toISOString(),
    kind,
  };
  if (kind === 'profile') {
    const profile = kept.list.find((candidate) => candidate.id === (profileId ?? kept.activeId));
    return {...file, profiles: profile ? [profileEntry(profile)] : []};
  }
  return {
    ...file,
    activeProfile: activeProfile(kept)?.name ?? null,
    station: readGroups(all, wanted(STATION_GROUPS)),
    profiles: kept.list.map(profileEntry),
  };
}

const fail = (error, detail = '') => ({ok: false, error, detail});

// the known groups of a scope, checked; unknown ones are dropped, a bad one fails the file
function readFileGroups(groups, scope) {
  if (groups === undefined) {
    return {ok: true, groups: {}};
  }
  if (groups === null || typeof groups !== 'object' || Array.isArray(groups)) {
    return fail('shape', scope);
  }
  const known = {};
  for (const [id, value] of Object.entries(groups)) {
    if (GROUPS[id]?.scope !== scope) {
      continue;
    }
    if (!GROUPS[id].valid(value)) {
      return fail('shape', id);
    }
    known[id] = scope === 'station' ? withoutSecrets(value) : value;
  }
  return {ok: true, groups: known};
}

/**
 * Reads an export file and checks it. Anything wrong gives a reason and
 * changes nothing: `json`, `format`, `version` (made by a newer station) or
 * `shape` (a value of the wrong type), with the group in `detail`.
 */
export function parseSettingsFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return fail('json', error.message);
  }
  if (!data || typeof data !== 'object' || data.format !== SETTINGS_FORMAT) {
    return fail('format');
  }
  if (!Number.isInteger(data.version) || data.version < 1) {
    return fail('format');
  }
  if (data.version > SETTINGS_VERSION) {
    return fail('version', String(data.version));
  }
  if (data.profiles !== undefined && !Array.isArray(data.profiles)) {
    return fail('shape', 'profiles');
  }
  const profiles = [];
  for (const entry of data.profiles ?? []) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name.trim()) {
      return fail('shape', 'profiles');
    }
    if (
      entry.apps !== undefined &&
      !(Array.isArray(entry.apps) && entry.apps.every((app) => typeof app === 'string'))
    ) {
      return fail('shape', 'apps');
    }
    const read = readFileGroups(entry.groups, 'profile');
    if (!read.ok) {
      return read;
    }
    profiles.push({name: entry.name.trim(), apps: entry.apps ?? [], groups: read.groups});
  }
  const station = readFileGroups(data.station, 'station');
  if (!station.ok) {
    return station;
  }
  if (!profiles.length && !Object.keys(station.groups).length) {
    return fail('empty');
  }
  return {
    ok: true,
    file: {
      kind: data.kind === 'profile' ? 'profile' : 'all',
      product: typeof data.product === 'string' ? data.product : '',
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
      activeProfile: typeof data.activeProfile === 'string' ? data.activeProfile : null,
      profiles,
      station: station.groups,
    },
  };
}

/**
 * What the file holds and what it would change here: for every profile the
 * profile of the same name it would replace, and for every group whether it
 * differs from what is here now.
 */
export function summarizeImport(file, profiles, all) {
  const kept = keepActive(profiles, all);
  return {
    profiles: file.profiles.map((entry, index) => {
      const existing = kept.list.find((profile) => profile.name === entry.name) ?? null;
      return {
        index,
        name: entry.name,
        apps: entry.apps,
        existingId: existing?.id ?? null,
        groups: Object.keys(entry.groups).map((id) => ({
          id,
          changed: !existing || !sameValue(entry.groups[id], existing.groups?.[id]),
        })),
      };
    }),
    station: Object.keys(file.station).map((id) => ({
      id,
      changed: !sameValue(GROUPS[id].read(writeGroups(all, {[id]: file.station[id]})), GROUPS[id].read(all)),
    })),
  };
}

/**
 * Applies what the person chose from the file.
 * @param {object} choice
 * @param {{index: number, mode: 'new' | 'replace' | 'skip', groups: string[]}[]} choice.profiles
 *   a new profile, or the groups put in place of the ones of the profile with the same name
 * @param {string[]} choice.station the station groups to take
 * @returns {{profiles: object, patch: object}} the profiles to save and the setting keys to write
 */
export function applyImport(file, profiles, all, choice) {
  let next = keepActive(profiles, all);
  let current = {...all};
  let patch = {};
  const write = (values) => {
    const written = writeGroups(current, values);
    patch = {...patch, ...written};
    current = {...current, ...written};
  };

  for (const {index, mode, groups = []} of choice.profiles ?? []) {
    const entry = file.profiles[index];
    if (!entry || mode === 'skip') {
      continue;
    }
    const chosen = Object.fromEntries(groups.filter((id) => id in entry.groups).map((id) => [id, entry.groups[id]]));
    const existing = next.list.find((profile) => profile.name === entry.name);
    if (mode === 'replace' && existing) {
      next = {
        ...next,
        list: next.list.map((profile) =>
          profile.id === existing.id
            ? {...profile, groups: {...profile.groups, ...structuredClone(chosen)}, updatedAt: new Date().toISOString()}
            : profile,
        ),
      };
      next = setProfileApps(next, existing.id, [...new Set([...(existing.apps ?? []), ...entry.apps])]);
      if (existing.id === next.activeId) {
        write(chosen);
      }
    } else {
      const added = addProfile(next, entry.name, {groups: chosen});
      next = setProfileApps(added.profiles, added.profile.id, entry.apps);
    }
  }

  const station = Object.fromEntries(
    (choice.station ?? []).filter((id) => id in file.station).map((id) => [id, file.station[id]]),
  );
  if (Object.keys(station).length) {
    write(station);
  }
  return {profiles: next, patch};
}

/**
 * A backup copy: every profile as it is, with its id, and the station's
 * settings, read through the groups like an export, so without secrets.
 */
export function buildBackup({profiles, all, reason, product, now = new Date()}) {
  return {
    format: SETTINGS_FORMAT,
    version: SETTINGS_VERSION,
    product,
    kind: 'backup',
    reason,
    createdAt: now.toISOString(),
    station: readGroups(all, STATION_GROUPS),
    state: keepActive(profiles, all),
  };
}

/**
 * Puts the settings back the way a backup holds them.
 * @returns {{ok: true, profiles: object, patch: object} | {ok: false, error: string}}
 */
export function restoreBackup(text, all) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return fail('json', error.message);
  }
  if (data?.format !== SETTINGS_FORMAT || data.kind !== 'backup') {
    return fail('format');
  }
  if (data.version > SETTINGS_VERSION) {
    return fail('version', String(data.version));
  }
  const state = data.state;
  if (!state || !Array.isArray(state.list) || !state.list.length || !state.list.some((p) => p.id === state.activeId)) {
    return fail('shape', 'profiles');
  }
  for (const profile of state.list) {
    const read = readFileGroups(profile.groups ?? {}, 'profile');
    if (!read.ok) {
      return read;
    }
  }
  const station = readFileGroups(data.station, 'station');
  if (!station.ok) {
    return station;
  }
  const withStation = writeGroups(all, station.groups);
  const active = state.list.find((profile) => profile.id === state.activeId);
  const patch = {...withStation, ...profilePatch(active, {...all, ...withStation})};
  return {ok: true, profiles: state, patch};
}
