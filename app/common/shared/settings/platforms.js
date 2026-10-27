import {legacyRolePlatform, PROJECT_PLATFORMS, projectSource} from './source.js';

// A project is made of platforms (project.platforms): Android and iOS apart,
// each with its app, branches and repositories, or one «multi» platform when
// one code makes both apps (Flutter, KMP). The device on the title bar says
// which platform the station works with.

const NATIVE = ['android', 'ios'];

/** The platforms of a project, cleaned up: «multi» alone, or Android and iOS in this order; never none. */
export function cleanPlatforms(platforms, fallback = 'android') {
  const list = Array.isArray(platforms) ? platforms.filter((one) => PROJECT_PLATFORMS.includes(one)) : [];
  if (list.includes('multi')) {
    return ['multi'];
  }
  const native = NATIVE.filter((one) => list.includes(one));
  return native.length ? native : [PROJECT_PLATFORMS.includes(fallback) ? fallback : 'android'];
}

/** The device's platform as the station names it: android, ios, or null. */
export const platformOfDevice = (device) =>
  /ios/i.test(device?.platformName ?? device?.platform ?? '')
    ? 'ios'
    : /android/i.test(device?.platformName ?? device?.platform ?? '')
      ? 'android'
      : null;

/**
 * A profile saved before the platforms, moved to them: its apps tell the
 * platforms, Android and iOS repositories go to theirs, a backend and the
 * rest to the shared code. The «app» repository goes to the project's one
 * platform; with both apps and that repository alone the project is «multi»;
 * otherwise it goes to Android, marked as placed by the station.
 */
export function migrateProfile(profile, fallback = 'android') {
  if (Array.isArray(profile?.platforms) && profile.platforms.length) {
    const platforms = cleanPlatforms(profile.platforms, fallback);
    return {...profile, platforms, source: projectSource(profile.source, platforms)};
  }
  const apps = (profile?.apps ?? []).map((app) => (typeof app === 'string' ? {id: app, platform: null} : app));
  const appPlatforms = NATIVE.filter((one) => apps.some((app) => app?.platform === one));
  const repos = Array.isArray(profile?.source?.repos) ? profile.source.repos : [];
  const placed = repos.map((repo) => legacyRolePlatform(repo?.role));
  const nativeRepos = NATIVE.filter((one) => placed.includes(one));
  const appRepos = placed.filter((one) => one === null).length;

  let platforms;
  let appRepoPlatform;
  let guessed = false;
  if (appPlatforms.length === 2 && appRepos === 1 && !nativeRepos.length) {
    platforms = ['multi'];
    appRepoPlatform = 'multi';
  } else {
    platforms = cleanPlatforms([...appPlatforms, ...nativeRepos], appPlatforms[0] ?? nativeRepos[0] ?? fallback);
    if (appPlatforms.length === 1) {
      appRepoPlatform = appPlatforms[0];
    } else {
      appRepoPlatform = 'android';
      guessed = appRepos > 0;
      if (appRepos && !platforms.includes('android')) {
        platforms = cleanPlatforms(['android', ...platforms]);
      }
    }
  }
  const single = platforms.length === 1 && platforms[0] !== 'multi' ? platforms[0] : null;
  return {
    ...profile,
    platforms,
    // an id saved before the apps had platforms belongs to the one platform there is
    apps: apps.map((app) => (app?.platform ? app : {...app, platform: single})),
    source: projectSource(
      {
        ...profile?.source,
        repos: repos.map((repo, index) =>
          placed[index] === null ? {...repo, platform: appRepoPlatform, guessed} : {...repo, platform: placed[index]},
        ),
      },
      platforms,
    ),
  };
}

/** The platform key of a profile for a device: its own platform, «multi», or null when the project has not it. */
export function platformKey(profile, devicePlatform) {
  const platforms = cleanPlatforms(profile?.platforms);
  if (platforms.includes('multi')) {
    return 'multi';
  }
  if (!devicePlatform) {
    return platforms[0];
  }
  return platforms.includes(devicePlatform) ? devicePlatform : null;
}

/** The apps the station may take for the project: those of the platforms it has («multi» has both). */
export function projectAppsOf(profile) {
  const platforms = cleanPlatforms(profile?.platforms);
  const wanted = platforms.includes('multi') ? NATIVE : platforms;
  return (profile?.apps ?? []).filter((app) => !app.platform || wanted.includes(app.platform));
}

/** The app of the project for a device platform, or null. */
export const appOfProject = (profile, devicePlatform) =>
  projectAppsOf(profile).find((app) => app.platform === devicePlatform) ??
  projectAppsOf(profile).find((app) => !app.platform) ??
  null;

/**
 * The project with another set of platforms. A platform taken out takes its
 * app and repositories with it; «multi» and the native ones swap with
 * makeMulti and splitMulti instead.
 */
export function setPlatforms(profile, platforms) {
  const next = cleanPlatforms(platforms, profile.platforms?.[0]);
  const native = next.includes('multi') ? NATIVE : next;
  return {
    ...profile,
    platforms: next,
    apps: (profile.apps ?? []).filter((app) => !app.platform || native.includes(app.platform)),
    source: projectSource(
      {
        ...profile.source,
        repos: (profile.source?.repos ?? []).filter(
          (repo) => repo.platform === 'shared' || next.includes(repo.platform),
        ),
      },
      next,
    ),
  };
}

/** Android and iOS made one «multi» platform: the apps stay, the repositories and the first branches go with it. */
export function makeMulti(profile) {
  const first = cleanPlatforms(profile.platforms)[0];
  const branches = profile.source?.branches?.[first];
  return {
    ...profile,
    platforms: ['multi'],
    source: projectSource(
      {
        branches: {multi: branches},
        repos: (profile.source?.repos ?? []).map(({guessed: _guessed, ...repo}) =>
          repo.platform === 'shared' ? repo : {...repo, platform: 'multi'},
        ),
      },
      ['multi'],
    ),
  };
}

/** One «multi» platform split into Android and iOS: its repositories go to Android, the branches to both. */
export function splitMulti(profile) {
  const branches = profile.source?.branches?.multi;
  return {
    ...profile,
    platforms: ['android', 'ios'],
    source: projectSource(
      {
        branches: {android: branches, ios: branches},
        repos: (profile.source?.repos ?? []).map((repo) =>
          repo.platform === 'multi' ? {...repo, platform: 'android'} : repo,
        ),
      },
      ['android', 'ios'],
    ),
  };
}

/**
 * What the person is told about the project and the device, the same
 * everywhere (project.platforms, criteria 5 and 6), or null when all is set:
 * - noPlatform: the project has not the device's platform; `other` is a profile that has it
 * - noApp: the platform's section has no app
 * @param {object} input
 * @param {object | null} input.profile the profile that is on
 * @param {object[]} [input.profiles] all profiles, for one that has the platform
 * @param {string | null} input.devicePlatform android, ios, or null
 */
export function projectAdvice({profile, profiles = [], devicePlatform}) {
  if (!profile || !devicePlatform) {
    return null;
  }
  const key = platformKey(profile, devicePlatform);
  if (!key) {
    const other = profiles.find(
      (one) => one.id !== profile.id && platformKey(one, devicePlatform) && appOfProject(one, devicePlatform),
    );
    return {
      kind: 'noPlatform',
      platform: devicePlatform,
      project: profile.name,
      only: cleanPlatforms(profile.platforms)[0],
      other: other ? {id: other.id, name: other.name} : null,
    };
  }
  if (!appOfProject(profile, devicePlatform)) {
    return {kind: 'noApp', platform: devicePlatform, section: key, project: profile.name};
  }
  return null;
}

/**
 * The platform a build source of GitLab belongs to: its own, the project's
 * one platform, or, for a rule of the time before the platforms in a project
 * with two, the one its GitLab path names (android, ios), else Android.
 */
export function rulePlatform(rule, platforms) {
  const list = cleanPlatforms(platforms);
  if (rule?.platform && list.includes(rule.platform)) {
    return rule.platform;
  }
  if (list.length === 1) {
    return list[0];
  }
  const path = String(rule?.project ?? '').toLowerCase();
  const named = (word) => new RegExp(`(^|[/_.*-])${word}([/_.*-]|$)`).test(path);
  if (named('ios')) {
    return 'ios';
  }
  return named('android') ? 'android' : list[0];
}
