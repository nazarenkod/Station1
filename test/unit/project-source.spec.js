import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

import {agentWorkspace} from '../../app/common/shared/settings/dependencies.js';
import {
  branchTone,
  branchToRemember,
  changeRepo,
  moduleFolder,
  moduleTree,
  newRepo,
  parseGitmodules,
  parseStatus,
  parseSubmoduleStatus,
  projectSource,
  repoWarnings,
  safeRemote,
  shortPath,
  sinceParts,
  setBranches,
  sourceFor,
} from '../../app/common/shared/settings/source.js';

// git runs with the environment of the test, not of a login shell; local
// submodules need the file protocol, which git turns off by default
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'protocol.file.allow',
  GIT_CONFIG_VALUE_0: 'always',
};

vi.mock('../../app/common/node/doctor/exec.js', async (importOriginal) => ({
  ...(await importOriginal()),
  shellEnv: async () => GIT_ENV,
}));

const {changesToDiscard, fetchRepo, inspectRepo, listBranches, pullRepo, switchBranch} =
  await import('../../app/common/node/source/repo.js');

describe('projectSource', () => {
  it('gives develop and main to each platform of a profile without code', () => {
    expect(projectSource(undefined, ['android', 'ios'])).toEqual({
      branches: {android: {dev: 'develop', release: 'main'}, ios: {dev: 'develop', release: 'main'}},
      repos: [],
    });
  });

  it('keeps the branches the person set and drops names git would not take', () => {
    expect(projectSource({branches: {android: {dev: ' dev ', release: 'release/1.0'}}}).branches.android).toEqual({
      dev: 'dev',
      release: 'release/1.0',
    });
    expect(projectSource({branches: {android: {dev: 'bad name', release: 'a..b'}}}).branches.android).toEqual({
      dev: 'develop',
      release: 'main',
    });
  });

  it('cleans the repositories: one id once, a platform the project has, else its first one', () => {
    const source = projectSource(
      {
        repos: [
          {id: 'r1', name: 'bank-android', platform: 'android'},
          {id: 'r1', name: 'again'},
          {id: 'r2', name: ' backend ', platform: 'shared'},
          {id: 'r3', platform: 'ios'},
          {id: 'r4', platform: 'tv'},
        ],
      },
      ['android'],
    );
    expect(source.repos).toEqual([
      {id: 'r1', name: 'bank-android', platform: 'android'},
      {id: 'r2', name: 'backend', platform: 'shared'},
      {id: 'r3', name: 'r3', platform: 'android'},
      {id: 'r4', name: 'r4', platform: 'android'},
    ]);
  });

  it('names a new repository after its folder, in the platform it is added to', () => {
    expect(newRepo('/Users/qa/code/bank-ios/', 'ios')).toMatchObject({name: 'bank-ios', platform: 'ios'});
  });

  it('gives the code of one platform with its branches: its repositories first, then the shared ones', () => {
    const source = projectSource(
      {
        branches: {android: {dev: 'dev-a', release: 'main'}, ios: {dev: 'dev-i', release: 'master'}},
        repos: [
          {id: 'api', platform: 'shared'},
          {id: 'and', platform: 'android'},
          {id: 'ios', platform: 'ios'},
        ],
      },
      ['android', 'ios'],
    );
    expect(sourceFor(source, 'ios')).toMatchObject({
      devBranch: 'dev-i',
      releaseBranch: 'master',
      repos: [{id: 'ios'}, {id: 'api'}],
    });
    expect(sourceFor(source, 'android').repos.map((repo) => repo.id)).toEqual(['and', 'api']);
    expect(setBranches(source, 'ios', {dev: 'develop'}).branches.ios).toEqual({dev: 'develop', release: 'master'});
  });

  it('confirms a repository the station placed itself once it is moved or kept', () => {
    const source = {repos: [{id: 'r', name: 'r', platform: 'android', guessed: true}]};
    expect(changeRepo(source, 'r', {platform: 'ios'}).repos).toEqual([{id: 'r', name: 'r', platform: 'ios'}]);
    expect(changeRepo(source, 'r', {confirm: true}).repos).toEqual([{id: 'r', name: 'r', platform: 'android'}]);
    expect(changeRepo(source, 'r', {name: 'x'}).repos[0]).toMatchObject({name: 'x', guessed: true});
    expect(changeRepo(source, 'r', null).repos).toEqual([]);
  });
});

describe('git output', () => {
  it('reads the submodules of .gitmodules', () => {
    const text =
      '[submodule "design"]\n\tpath = libs/design\n\turl = git@gitlab.com:bank/design.git\n[submodule "x"]\n';
    expect(parseGitmodules(text)).toEqual([
      {name: 'design', path: 'libs/design', url: 'git@gitlab.com:bank/design.git'},
    ]);
  });

  it('tells a checked-out submodule from one never initialized', () => {
    const text = ' 1a2b3c libs/design (heads/main)\n-4d5e6f libs/analytics\n+7a8b9c libs/core (v1-2-g7a8b9c)\n';
    expect(parseSubmoduleStatus(text)).toEqual([
      {path: 'libs/design', commit: '1a2b3c', initialized: true},
      {path: 'libs/analytics', commit: '4d5e6f', initialized: false},
      {path: 'libs/core', commit: '7a8b9c', initialized: true},
    ]);
  });

  it('lists the changed and new files of a status, a rename once', () => {
    const text = [' M src/App.kt', '?? notes.txt', 'R  new.kt', 'old.kt', 'D  gone.kt', 'A  added.kt', ''].join('\0');
    expect(parseStatus(text)).toEqual([
      {path: 'src/App.kt', kind: 'modified'},
      {path: 'notes.txt', kind: 'untracked'},
      {path: 'new.kt', kind: 'renamed'},
      {path: 'gone.kt', kind: 'deleted'},
      {path: 'added.kt', kind: 'added'},
    ]);
  });

  it('never shows the login and token an https origin may carry', () => {
    expect(safeRemote('https://oauth2:glpat-secret@gitlab.com/bank/app.git')).toBe('https://gitlab.com/bank/app.git');
    expect(safeRemote('git@gitlab.com:bank/app.git')).toBe('git@gitlab.com:bank/app.git');
  });
});

describe('repoWarnings', () => {
  const source = sourceFor(projectSource({}), 'android');
  const state = {ok: true, branch: 'develop', detached: false, changes: [], hasDev: true, hasRelease: true};

  it('is quiet for a clean copy on the development branch', () => {
    expect(repoWarnings(state, source)).toEqual([]);
  });

  it('says what the agent would see otherwise', () => {
    expect(repoWarnings({...state, branch: 'feature/PAY-1', changes: [{}, {}], hasRelease: false}, source)).toEqual([
      {kind: 'notDev', branch: 'feature/PAY-1'},
      {kind: 'changes', count: 2},
      {kind: 'noBranch', branch: 'main'},
    ]);
    expect(repoWarnings({...state, detached: true, branch: null}, source)).toEqual([{kind: 'detached'}]);
  });
});

describe('branchToRemember', () => {
  it('remembers the branch before the first switch and forgets it on the way back', () => {
    expect(branchToRemember(null, 'develop', 'feature/PAY-1')).toBe('develop');
    expect(branchToRemember('develop', 'feature/PAY-1', 'feature/PAY-2')).toBe('develop');
    expect(branchToRemember(null, 'develop', 'develop')).toBeNull();
    expect(branchToRemember('develop', 'feature/PAY-2', 'develop', {restoring: true})).toBeNull();
  });
});

describe('agentWorkspace', () => {
  const source = sourceFor(
    projectSource(
      {
        repos: [
          {id: 'app', platform: 'android'},
          {id: 'api', platform: 'shared'},
          {id: 'lost', platform: 'android'},
        ],
      },
      ['android'],
    ),
    'android',
  );

  it('works in the main repository with the others and checked-out submodules beside it', () => {
    const paths = {app: {path: '/code/app'}, api: {path: '/code/api'}, lost: {path: '/gone'}};
    const states = {
      app: {
        ok: true,
        root: '/code/app',
        submodules: [
          {path: 'libs/design', initialized: true},
          {path: 'libs/analytics', initialized: false},
        ],
      },
      api: {ok: true, root: '/code/api', submodules: []},
      lost: {ok: false, error: 'missing'},
    };
    expect(agentWorkspace(source, paths, states)).toMatchObject({
      cwd: '/code/app',
      additionalDirectories: ['/code/app/libs/design', '/code/api'],
    });
  });

  it('has no folder when no repository is on this Mac', () => {
    expect(agentWorkspace(source, {}, {})).toMatchObject({cwd: null, additionalDirectories: []});
  });

  // ap24v6 (Android) and the iOS app both take ap24f, which has submodules of its own
  const shared = 'git@git.example:mob/ap24f.git';
  const mobile = projectSource(
    {
      repos: [
        {id: 'and', platform: 'android'},
        {id: 'ios', platform: 'ios'},
      ],
    },
    ['android', 'ios'],
  );
  const mobilePaths = {
    and: {path: '/code/and', modules: {'ap24f/submodules/core-kit': '/code/core-kit'}},
    ios: {path: '/code/ios'},
  };
  const mobileStates = {
    and: {
      ok: true,
      root: '/code/and',
      submodules: [
        {path: 'tapandpay', initialized: true, url: 'git@git.example:mob/tapandpay.git'},
        {path: 'ap24f', initialized: true, url: shared},
        {path: 'ap24f/submodules/core-kit', initialized: false, url: 'git@git.example:mob/core-kit.git'},
      ],
    },
    ios: {ok: true, root: '/code/ios', submodules: [{path: 'Shared/ap24f', initialized: true, url: shared}]},
  };

  it('opens the code of the device platform with all its submodules, not the other platform', () => {
    expect(agentWorkspace(sourceFor(mobile, 'android'), mobilePaths, mobileStates)).toMatchObject({
      cwd: '/code/and',
      additionalDirectories: ['/code/and/ap24f', '/code/core-kit', '/code/and/tapandpay'],
    });
    expect(agentWorkspace(sourceFor(mobile, 'ios'), mobilePaths, mobileStates)).toMatchObject({
      cwd: '/code/ios',
      additionalDirectories: ['/code/ios/Shared/ap24f'],
    });
  });

  it('opens every platform when no device is picked, a shared submodule once', () => {
    const all = agentWorkspace(sourceFor(mobile, null), mobilePaths, mobileStates);
    expect(all.cwd).toBe('/code/and');
    expect(all.additionalDirectories).toContain('/code/ios');
    expect(all.additionalDirectories).not.toContain('/code/ios/Shared/ap24f');
  });
});

describe('submodules as a tree', () => {
  it('puts a submodule of a submodule under it, and takes the folder from above', () => {
    const tree = moduleTree([
      {path: 'ap24f/submodules/pb_core'},
      {path: 'auth'},
      {path: 'ap24f'},
      {path: 'ap24f/submodules/core-kit'},
    ]);
    expect(tree.map(({path: p, depth, parent}) => [p, depth, parent])).toEqual([
      ['ap24f', 0, null],
      ['ap24f/submodules/core-kit', 1, 'ap24f'],
      ['ap24f/submodules/pb_core', 1, 'ap24f'],
      ['auth', 0, null],
    ]);
    expect(moduleFolder('/code', 'ap24f/submodules/pb_core', {ap24f: '/clones/ap24f'}, tree)).toBe(
      '/clones/ap24f/submodules/pb_core',
    );
  });
});

describe('a repository on disk', () => {
  let dir;
  let copy;
  const git = (cwd, ...args) => execFileSync('git', args, {cwd, env: GIT_ENV, stdio: 'pipe'}).toString();
  const commit = (cwd, file, text, message) => {
    writeFileSync(path.join(cwd, file), text);
    git(cwd, 'add', file);
    git(cwd, 'commit', '-q', '-m', message);
  };

  // old git (2.23 still ships with some Macs) has no `init -b` nor a stable `switch`
  const init = (target) => {
    git(dir, 'init', '-q', target);
    git(target, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'station-source-'));
    // the shared module the app takes as a submodule
    const lib = path.join(dir, 'lib');
    init(lib);
    commit(lib, 'lib.txt', 'one\n', 'lib');
    // the app with its branches, published to a bare origin
    const work = path.join(dir, 'work');
    init(work);
    commit(work, '.gitignore', 'build/\n', 'ignore builds');
    git(work, 'submodule', 'add', '-q', lib, 'libs/lib');
    git(work, 'commit', '-q', '-m', 'submodule');
    git(work, 'checkout', '-q', '-b', 'develop');
    commit(work, 'app.txt', 'develop\n', 'develop');
    git(work, 'checkout', '-q', '-b', 'feature/PAY-1');
    commit(work, 'app.txt', 'feature\n', 'feature');
    git(dir, 'init', '-q', '--bare', 'origin.git');
    git(work, 'remote', 'add', 'origin', path.join(dir, 'origin.git'));
    git(work, 'push', '-q', 'origin', 'main', 'develop', 'feature/PAY-1');
    // the station's own copy, on develop, with the submodule checked out
    git(dir, 'clone', '-q', '--recurse-submodules', '-b', 'develop', path.join(dir, 'origin.git'), 'copy');
    copy = path.join(dir, 'copy');
  });

  afterAll(() => rmSync(dir, {recursive: true, force: true}));

  it('reads the branch, origin, submodules and the branches of the profile', async () => {
    const state = await inspectRepo(path.join(copy, 'libs'), {devBranch: 'develop', releaseBranch: 'main'});
    expect(state).toMatchObject({
      ok: true,
      branch: 'develop',
      detached: false,
      remote: path.join(dir, 'origin.git'),
      changes: [],
      hasDev: true,
      hasRelease: true,
    });
    expect(path.basename(state.root)).toBe('copy');
    expect(state.submodules).toEqual([
      expect.objectContaining({name: 'libs/lib', path: 'libs/lib', initialized: true}),
    ]);
    expect((await inspectRepo(copy, {devBranch: 'develop', releaseBranch: 'release'})).hasRelease).toBe(false);
  });

  it('says what a folder is when it is not a repository', async () => {
    expect((await inspectRepo(path.join(dir, 'nowhere'))).error).toBe('missing');
    expect((await inspectRepo(os.tmpdir())).error).toBe('notRepo');
  });

  it('lists the branches of origin too', async () => {
    expect(await listBranches(copy)).toEqual(['develop', 'feature/PAY-1', 'main']);
  });

  it('discards changes in the copy and its submodule, keeps the ignored builds, and switches', async () => {
    writeFileSync(path.join(copy, 'app.txt'), 'edited\n');
    writeFileSync(path.join(copy, 'scratch.txt'), 'new\n');
    writeFileSync(path.join(copy, 'libs/lib/lib.txt'), 'edited\n');
    execFileSync('mkdir', ['-p', path.join(copy, 'build')]);
    writeFileSync(path.join(copy, 'build/out.apk'), 'apk');

    expect(await changesToDiscard(copy)).toEqual([
      {repo: '.', path: 'app.txt', kind: 'modified'},
      {repo: '.', path: 'scratch.txt', kind: 'untracked'},
      {repo: 'libs/lib', path: 'lib.txt', kind: 'modified'},
    ]);

    const result = await switchBranch(copy, 'feature/PAY-1');
    expect(result).toMatchObject({ok: true, previous: 'develop', warning: null});
    expect(result.discarded).toHaveLength(3);
    expect(git(copy, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/PAY-1');
    expect(existsSync(path.join(copy, 'scratch.txt'))).toBe(false);
    expect(existsSync(path.join(copy, 'build/out.apk'))).toBe(true);
    expect(await changesToDiscard(copy)).toEqual([]);
  });

  it('discards nothing for a branch that is not there', async () => {
    writeFileSync(path.join(copy, 'keep.txt'), 'mine\n');
    expect(await switchBranch(copy, 'no-such-branch')).toEqual({ok: false, error: 'noBranch'});
    expect(existsSync(path.join(copy, 'keep.txt'))).toBe(true);
    rmSync(path.join(copy, 'keep.txt'));
  });

  it('fetches and pulls fast-forward only', async () => {
    const work = path.join(dir, 'work');
    git(work, 'checkout', '-q', 'feature/PAY-1');
    commit(work, 'more.txt', 'more\n', 'more');
    git(work, 'push', '-q', 'origin', 'feature/PAY-1');

    expect(await fetchRepo(copy)).toEqual({ok: true});
    expect((await inspectRepo(copy)).lastFetch).not.toBeNull();
    expect(await pullRepo(copy)).toEqual({ok: true});
    expect(existsSync(path.join(copy, 'more.txt'))).toBe(true);

    // a local commit makes the branch diverge; the station does not merge
    commit(copy, 'local.txt', 'local\n', 'local');
    commit(work, 'other.txt', 'other\n', 'other');
    git(work, 'push', '-q', 'origin', 'feature/PAY-1');
    expect((await pullRepo(copy)).error).toBe('pull');
  });
});

describe('how a repository reads on the projects page', () => {
  const source = {devBranch: 'develop', releaseBranch: 'main'};

  it('shows the home folder as ~', () => {
    expect(shortPath('/Users/qa/Documents/git/ap24v6', '/Users/qa')).toBe('~/Documents/git/ap24v6');
    expect(shortPath('/Users/qa', '/Users/qa/')).toBe('~');
    expect(shortPath('/Users/qab/code', '/Users/qa')).toBe('/Users/qab/code');
    expect(shortPath('/opt/code', null)).toBe('/opt/code');
    expect(shortPath(null, '/Users/qa')).toBe('');
  });

  it('colours the branch by what it is to the project', () => {
    expect(branchTone({branch: 'develop'}, source)).toBe('dev');
    expect(branchTone({branch: 'main'}, source)).toBe('release');
    expect(branchTone({branch: 'pre_real'}, source)).toBe('other');
    expect(branchTone({branch: null, detached: true}, source)).toBe('detached');
  });

  it('says how long ago in the largest whole unit', () => {
    const now = Date.parse('2026-10-28T13:30:00Z');
    expect(sinceParts('2026-10-28T13:29:40Z', now)).toEqual({value: 0, unit: 'second'});
    expect(sinceParts('2026-10-28T13:22:00Z', now)).toEqual({value: -8, unit: 'minute'});
    expect(sinceParts('2026-10-28T10:00:00Z', now)).toEqual({value: -3, unit: 'hour'});
    expect(sinceParts('2026-10-25T13:30:00Z', now)).toEqual({value: -3, unit: 'day'});
  });
});
