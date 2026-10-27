import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {PROFILES, SOURCE_PATHS} from '../../shared/setting-defs.js';
import {GROUP_KEYS} from '../../shared/settings/groups.js';
import {
  addProfile,
  ensureProfiles,
  profileForApp,
  projectApps,
  removeProfile,
  renameProfile,
  setProfileApps,
  setProfilePlatforms,
  setProfileSource,
  switchProfile,
} from '../../shared/settings/profiles.js';
import {projectSource} from '../../shared/settings/source.js';
import {
  applyImport,
  buildBackup,
  buildExport,
  parseSettingsFile,
  restoreBackup,
  summarizeImport,
} from '../../shared/settings/transfer.js';

export const BACKUPS_KEPT = 10;

// 2026-10-26T21-03-11-512Z-daily.json
const BACKUP_FILE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-([a-z-]+)\.json$/;

/**
 * The station's settings as a whole: the project profiles, export and
 * import, and the backup copies kept next to the settings. `store` is where
 * the settings live (electron-settings in the app, a map in the tests).
 *
 * @param {object} options
 * @param {{get: (key: string) => Promise<any>, set: (key: string, value: any) => Promise<void>}} options.store
 * @param {string} options.backupDir
 * @param {string} options.product
 * @param {string | (() => string)} [options.firstProfileName] the name of the profile made from what the station has
 * @param {() => Date} [options.now]
 */
export function createStationSettings({
  store,
  backupDir,
  product,
  firstProfileName = 'My project',
  now = () => new Date(),
}) {
  const readAll = async () => {
    const values = await Promise.all(GROUP_KEYS.map(async (key) => [key, await store.get(key)]));
    return Object.fromEntries(values.filter(([, value]) => value !== undefined && value !== null));
  };

  const writePatch = async (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      await store.set(key, value);
    }
  };

  const load = async () => {
    const all = await readAll();
    const name = typeof firstProfileName === 'function' ? firstProfileName() : firstProfileName;
    const {profiles, created, migrated} = ensureProfiles(await store.get(PROFILES), all, name);
    if (created || migrated) {
      await store.set(PROFILES, profiles);
    }
    return {profiles, all};
  };

  // what the screens need: no settings inside, only names, apps and which one is on
  const outline = (profiles) => ({
    activeId: profiles.activeId,
    list: profiles.list.map(({id, name, apps, platforms, source, updatedAt}) => ({
      id,
      name,
      platforms,
      apps: projectApps(apps),
      source: projectSource(source, platforms),
      updatedAt,
    })),
  });

  const save = async (profiles, patch = {}) => {
    await writePatch(patch);
    await store.set(PROFILES, profiles);
    return {profiles: outline(profiles), changedKeys: Object.keys(patch)};
  };

  // a repository taken out of the profile (or with its platform) leaves its folder behind
  const keepFolders = async (id, next) => {
    const kept = new Set(next.list.find((profile) => profile.id === id)?.source.repos.map((repo) => repo.id) ?? []);
    await writePaths((paths) => {
      paths[id] = Object.fromEntries(Object.entries(paths[id] ?? {}).filter(([repoId]) => kept.has(repoId)));
    });
    return await save(next);
  };

  // the folders of the repositories, this Mac's only: by profile, then by repository
  const readPaths = async () => (await store.get(SOURCE_PATHS)) ?? {};
  const writePaths = async (change) => {
    const paths = {...(await readPaths())};
    change(paths);
    await store.set(SOURCE_PATHS, paths);
    return paths;
  };

  // ---- backups

  const listBackups = async () => {
    let names;
    try {
      names = await readdir(backupDir);
    } catch {
      return [];
    }
    return names
      .map((file) => {
        const match = file.match(BACKUP_FILE);
        if (!match) {
          return null;
        }
        const [, day, hours, minutes, seconds, ms, reason] = match;
        return {file, day, reason, createdAt: `${day}T${hours}:${minutes}:${seconds}.${ms}Z`};
      })
      .filter(Boolean)
      .sort((a, b) => b.file.localeCompare(a.file));
  };

  // the last ten daily copies and the last ten made before a change
  const prune = async () => {
    const backups = await listBackups();
    const daily = backups.filter((backup) => backup.reason === 'daily').slice(BACKUPS_KEPT);
    const others = backups.filter((backup) => backup.reason !== 'daily').slice(BACKUPS_KEPT);
    await Promise.all([...daily, ...others].map((backup) => rm(path.join(backupDir, backup.file), {force: true})));
  };

  const backup = async (reason) => {
    const {profiles, all} = await load();
    const time = now();
    const file = `${time.toISOString().replace(/[:.]/g, '-')}-${reason}.json`;
    await mkdir(backupDir, {recursive: true});
    await writeFile(
      path.join(backupDir, file),
      `${JSON.stringify(buildBackup({profiles, all, reason, product, now: time}), null, 2)}\n`,
    );
    await prune();
    return file;
  };

  // only a backup file of this folder can be read back
  const backupPath = (file) => {
    if (!BACKUP_FILE.test(file) || path.basename(file) !== file) {
      throw new Error(`Not a backup: ${file}`);
    }
    return path.join(backupDir, file);
  };

  return {
    load,

    async profiles() {
      return outline((await load()).profiles);
    },

    async switchProfile(id) {
      const {profiles, all} = await load();
      const result = switchProfile(profiles, id, all);
      return await save(result.profiles, result.patch);
    },

    async addProfile(name, {copy = false, platforms = null} = {}) {
      const {profiles, all} = await load();
      const {profiles: next, profile} = addProfile(profiles, name, {
        copyFrom: copy ? profiles.activeId : null,
        all,
        platforms,
      });
      if (copy) {
        // the copy works on the same folders
        await writePaths((paths) => {
          paths[profile.id] = structuredClone(paths[profiles.activeId] ?? {});
        });
      }
      return {...(await save(next)), id: profile.id};
    },

    async renameProfile(id, name) {
      const {profiles} = await load();
      return await save(renameProfile(profiles, id, name));
    },

    async setProfileApps(id, apps) {
      const {profiles} = await load();
      return await save(setProfileApps(profiles, id, apps));
    },

    async setProfilePlatforms(id, change) {
      const {profiles} = await load();
      return await keepFolders(id, setProfilePlatforms(profiles, id, change));
    },

    async setProfileSource(id, source) {
      const {profiles} = await load();
      return await keepFolders(id, setProfileSource(profiles, id, source));
    },

    async sourcePaths(profileId) {
      return (await readPaths())[profileId] ?? {};
    },

    /** Sets what is known of a repository folder here: its path, the branch before a switch. */
    async setSourcePath(profileId, repoId, value) {
      const paths = await writePaths((all) => {
        const next = {...all[profileId]?.[repoId], ...value};
        const folders = {...all[profileId]};
        if (next.path) {
          folders[repoId] = next;
        } else {
          delete folders[repoId];
        }
        all[profileId] = folders;
      });
      return paths[profileId] ?? {};
    },

    async removeProfile(id) {
      const {profiles, all} = await load();
      const result = removeProfile(profiles, id, all);
      if (!result) {
        return null;
      }
      await backup('before-delete');
      await writePaths((paths) => {
        delete paths[id];
      });
      return await save(result.profiles, result.patch);
    },

    async profileForApp(appId) {
      const {profiles} = await load();
      const owner = profileForApp(profiles, appId);
      return owner && {id: owner.id, name: owner.name};
    },

    async exportText({kind, profileId, groups}) {
      const {profiles, all} = await load();
      return `${JSON.stringify(buildExport({profiles, all, kind, profileId, groups, product, now: now()}), null, 2)}\n`;
    },

    /** Reads an import file: what it holds and what it would change, or why it cannot be used. */
    async previewImport(text) {
      const parsed = parseSettingsFile(text);
      if (!parsed.ok) {
        return parsed;
      }
      const {profiles, all} = await load();
      return {ok: true, file: parsed.file, summary: summarizeImport(parsed.file, profiles, all)};
    },

    async applyImport(text, choice) {
      const parsed = parseSettingsFile(text);
      if (!parsed.ok) {
        return parsed;
      }
      await backup('before-import');
      const {profiles, all} = await load();
      const result = applyImport(parsed.file, profiles, all, choice);
      return {ok: true, ...(await save(result.profiles, result.patch))};
    },

    listBackups,
    backup,

    /** A copy for today, unless there is one. */
    async dailyBackup() {
      const today = now().toISOString().slice(0, 10);
      const backups = await listBackups();
      if (backups.some((entry) => entry.reason === 'daily' && entry.day === today)) {
        return null;
      }
      return await backup('daily');
    },

    async restore(file) {
      const text = await readFile(backupPath(file), 'utf8');
      const {all} = await load();
      const result = restoreBackup(text, all);
      if (!result.ok) {
        return result;
      }
      await backup('before-restore');
      return {ok: true, ...(await save(result.profiles, result.patch))};
    },
  };
}
