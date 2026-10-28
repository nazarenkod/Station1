import os from 'node:os';

import {BrowserWindow, dialog, ipcMain} from 'electron';

import {
  changesToDiscard,
  fetchRepo,
  inspectRepo,
  listBranches,
  pullRepo,
  repoRoot,
  switchBranch,
} from '../../../common/node/source/repo.js';
import {branchToRemember, shortPath, sourceOfRepo} from '../../../common/shared/settings/source.js';

/**
 * The repositories of the project profiles on this Mac: their folders, what
 * state they are in, fetch, switching a branch and pulling. The folders are
 * kept by the station settings, apart from the profiles.
 */
export function setupSourceIPC(station) {
  const profileSource = async (profileId) =>
    (await station.profiles()).list.find((profile) => profile.id === profileId)?.source ?? null;

  // the root of a repository of a profile, or why there is none
  const resolve = async (profileId, repoId) => {
    const folder = (await station.sourcePaths(profileId))[repoId]?.path;
    if (!folder) {
      return {error: 'noFolder'};
    }
    const root = await repoRoot(folder);
    return root ? {root} : {error: 'notRepo'};
  };
  const withRoot =
    (action) =>
    async (_evt, profileId, repoId, ...args) => {
      const found = await resolve(profileId, repoId);
      return found.root ? await action(found.root, profileId, repoId, ...args) : {ok: false, error: found.error};
    };

  ipcMain.handle('source:pickFolder', async (evt) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(evt.sender), {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('source:setPath', (_evt, profileId, repoId, folder) =>
    station.setSourcePath(profileId, repoId, {path: folder || null, previousBranch: null}),
  );

  // a submodule taken from a folder of its own (a separate clone) instead of the copy inside the repository
  ipcMain.handle('source:setModulePath', async (_evt, profileId, repoId, modulePath, folder) => {
    const known = (await station.sourcePaths(profileId))[repoId] ?? {};
    const modules = {...known.modules};
    if (folder) {
      modules[modulePath] = folder;
    } else {
      delete modules[modulePath];
    }
    return await station.setSourcePath(profileId, repoId, {modules});
  });

  ipcMain.handle('source:inspect', async (_evt, profileId) => {
    const source = await profileSource(profileId);
    if (!source) {
      return [];
    }
    const paths = await station.sourcePaths(profileId);
    return await Promise.all(
      source.repos.map(async (repo) => {
        const known = paths[repo.id] ?? {};
        return {
          repoId: repo.id,
          path: known.path ?? null,
          // the folder as the person reads it, with ~ for the home folder
          shown: shortPath(known.path, os.homedir()),
          previousBranch: known.previousBranch ?? null,
          modules: known.modules ?? {},
          // each repository against the branches of its platform
          state: known.path ? await inspectRepo(known.path, sourceOfRepo(source, repo)) : null,
        };
      }),
    );
  });

  ipcMain.handle(
    'source:branches',
    withRoot(async (root) => ({ok: true, branches: await listBranches(root)})),
  );
  ipcMain.handle(
    'source:preview',
    withRoot(async (root) => ({ok: true, changes: await changesToDiscard(root)})),
  );
  ipcMain.handle('source:fetch', withRoot(fetchRepo));
  ipcMain.handle('source:pull', withRoot(pullRepo));

  const switchAndKeep = async (root, profileId, repoId, branch, {restoring = false} = {}) => {
    const result = await switchBranch(root, branch);
    if (result.ok) {
      const known = (await station.sourcePaths(profileId))[repoId] ?? {};
      const previousBranch = branchToRemember(known.previousBranch, result.previous, branch, {restoring});
      await station.setSourcePath(profileId, repoId, {previousBranch});
    }
    return result;
  };
  ipcMain.handle('source:switch', withRoot(switchAndKeep));
  ipcMain.handle(
    'source:restoreBranch',
    withRoot(async (root, profileId, repoId) => {
      const previous = (await station.sourcePaths(profileId))[repoId]?.previousBranch;
      return previous
        ? await switchAndKeep(root, profileId, repoId, previous, {restoring: true})
        : {ok: false, error: 'noPrevious'};
    }),
  );
}
