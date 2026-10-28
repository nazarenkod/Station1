// The code of a project: the repositories of the app on this Mac, their
// submodules and the branches the team develops and releases from, for each
// platform of the project apart (project.platforms). The profile keeps what
// the team shares (branches, names and platforms of the repositories); the
// folders are this Mac's and live apart, in SOURCE_PATHS.

// where a repository belongs: a platform of the project, or «shared» (a backend, a library)
export const REPO_PLATFORMS = ['android', 'ios', 'multi', 'shared'];

// the platforms a project can have: Android and iOS apart, or one code for both
export const PROJECT_PLATFORMS = ['android', 'ios', 'multi'];

// the roles of the profiles before the platforms, and where their repositories go now
const LEGACY_ROLE = {android: 'android', ios: 'ios', backend: 'shared', shared: 'shared', other: 'shared'};

export const DEFAULT_DEV_BRANCH = 'develop';
export const DEFAULT_RELEASE_BRANCH = 'main';

const newRepoId = () => `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// a branch name git would take; anything else falls back to the default
const branchName = (value, fallback) => {
  const name = String(value ?? '').trim();
  return name && !/[\s~^:?*[\\]|\.\.|@\{|^-|\/$|\.lock$/.test(name) ? name : fallback;
};

/** The platform an old repository role stands for, or null for «app», which the profile decides. */
export const legacyRolePlatform = (role) => LEGACY_ROLE[role] ?? null;

/**
 * The code of a profile, cleaned up: the branches of each platform and the
 * repositories with an id, a name and a platform, no id twice. A repository
 * of a platform the project has not, or of none, goes to its first platform.
 * `guessed` marks one the station placed itself when the profile was moved
 * to platforms, until the person moves or confirms it.
 */
export function projectSource(source, platforms = ['android']) {
  const own = platforms.filter((one) => PROJECT_PLATFORMS.includes(one));
  const first = own[0] ?? 'android';
  const ids = new Set();
  const repos = [];
  for (const repo of Array.isArray(source?.repos) ? source.repos : []) {
    const id = String(repo?.id ?? '').trim() || newRepoId();
    if (ids.has(id)) {
      continue;
    }
    ids.add(id);
    const wanted = REPO_PLATFORMS.includes(repo?.platform) ? repo.platform : legacyRolePlatform(repo?.role);
    const platform = wanted === 'shared' || own.includes(wanted) ? wanted : first;
    repos.push({
      id,
      name: String(repo?.name ?? '').trim() || id,
      platform,
      ...(repo?.guessed && platform !== 'shared' ? {guessed: true} : {}),
    });
  }
  const branches = {};
  for (const platform of own.length ? own : [first]) {
    const set = source?.branches?.[platform];
    branches[platform] = {
      dev: branchName(set?.dev ?? source?.devBranch, DEFAULT_DEV_BRANCH),
      release: branchName(set?.release ?? source?.releaseBranch, DEFAULT_RELEASE_BRANCH),
    };
  }
  return {branches, repos};
}

/**
 * The code of one platform as one source with its branches: its own
 * repositories first (the first is the main one), then the shared ones. A
 * shared repository on its own takes the branches of the first platform.
 * Without a platform, every repository, with the first platform's branches.
 */
export function sourceFor(source, platform = null) {
  const branches = source?.branches ?? {};
  const own = platform && branches[platform] ? branches[platform] : Object.values(branches)[0];
  const repos = source?.repos ?? [];
  const mine = platform
    ? repos.filter((repo) => repo.platform === platform)
    : repos.filter((repo) => repo.platform !== 'shared');
  return {
    platform,
    devBranch: own?.dev ?? DEFAULT_DEV_BRANCH,
    releaseBranch: own?.release ?? DEFAULT_RELEASE_BRANCH,
    repos: [...mine, ...repos.filter((repo) => repo.platform === 'shared')],
  };
}

/** The branches a repository is checked against: its platform's, or the first platform's for a shared one. */
export const sourceOfRepo = (source, repo) =>
  sourceFor(source, repo?.platform && repo.platform !== 'shared' ? repo.platform : null);

/** The code with one platform's branches set. */
export function setBranches(source, platform, branches) {
  return {
    ...source,
    branches: {...source.branches, [platform]: {...source.branches?.[platform], ...branches}},
  };
}

/** The code with one repository changed, or taken out when the change is null; moving it confirms where it is. */
export function changeRepo(source, repoId, change) {
  return {
    ...source,
    repos: change
      ? source.repos.map((repo) => {
          if (repo.id !== repoId) {
            return repo;
          }
          const {confirm, ...patch} = change;
          const {guessed: _guessed, ...placed} = repo;
          return confirm || patch.platform ? {...placed, ...patch} : {...repo, ...patch};
        })
      : source.repos.filter((repo) => repo.id !== repoId),
  };
}

/**
 * The submodules as a tree: each with its depth and the path of the
 * submodule it is in (`ap24f/submodules/core-kit` is in `ap24f`), in the
 * order of their paths, so a parent comes before what is in it.
 * @param {{path: string}[]} modules
 * @returns {{path: string, depth: number, parent: string | null}[]}
 */
export function moduleTree(modules) {
  const paths = (modules ?? []).map((module) => module.path);
  const parentOf = (modulePath) =>
    paths
      .filter((other) => other !== modulePath && modulePath.startsWith(`${other}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null;
  const depthOf = (modulePath) => {
    let depth = 0;
    for (let parent = parentOf(modulePath); parent; parent = parentOf(parent)) {
      depth++;
    }
    return depth;
  };
  return [...(modules ?? [])]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((module) => ({...module, depth: depthOf(module.path), parent: parentOf(module.path)}));
}

/**
 * Where a submodule is on this Mac: its own folder when one is set (a clone
 * of its own), or under the folder of the submodule it is in, else inside
 * the repository.
 */
export function moduleFolder(root, modulePath, own = {}, tree = []) {
  if (own[modulePath]) {
    return own[modulePath];
  }
  const parent = tree.find((one) => one.path === modulePath)?.parent;
  if (parent) {
    return `${moduleFolder(root, parent, own, tree)}/${modulePath.slice(parent.length + 1)}`;
  }
  return `${root}/${modulePath}`;
}

/** A new repository of a platform (or «shared»), named after its folder. */
export function newRepo(folder, platform) {
  const name =
    String(folder ?? '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || 'repo';
  return {id: newRepoId(), name, platform};
}

/**
 * The submodules a `.gitmodules` file declares.
 * @returns {{name: string, path: string, url: string}[]}
 */
export function parseGitmodules(text) {
  const modules = [];
  let current = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[submodule\s+"(.+)"\]$/.exec(line);
    if (head) {
      current = {name: head[1], path: '', url: ''};
      modules.push(current);
      continue;
    }
    const pair = /^(\w+)\s*=\s*(.*)$/.exec(line);
    if (current && pair && (pair[1] === 'path' || pair[1] === 'url')) {
      current[pair[1]] = pair[2].trim();
    }
  }
  return modules.filter((module) => module.path);
}

/**
 * `git submodule status --recursive`: which submodules are checked out. A
 * leading `-` means it was never initialized.
 * @returns {{path: string, initialized: boolean}[]}
 */
export function parseSubmoduleStatus(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => /^([ +\-U])([0-9a-f]+)\s+(\S+)/.exec(line))
    .filter(Boolean)
    .map(([, mark, commit, path]) => ({path, commit, initialized: mark !== '-'}));
}

const STATUS_KINDS = {M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'added', U: 'conflict', T: 'modified'};

/**
 * `git status --porcelain=v1 -z`: the changed and new files, each once. A
 * submodule shows up as a changed path too; its own files are listed apart.
 * @returns {{path: string, kind: string}[]}
 */
export function parseStatus(text) {
  const entries = String(text ?? '').split('\0');
  const changes = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.length < 4) {
      continue;
    }
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code[0] === 'R' || code[0] === 'C') {
      // the old name follows the new one
      index++;
    }
    if (code === '!!') {
      continue;
    }
    const letter = code === '??' ? '?' : (code.trim()[0] ?? 'M');
    changes.push({path, kind: letter === '?' ? 'untracked' : (STATUS_KINDS[letter] ?? 'modified')});
  }
  return changes;
}

/** The address of a remote without the login and token an https address may carry. */
export function safeRemote(url) {
  const text = String(url ?? '').trim();
  return text.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1');
}

/** A folder as the person reads it: the home folder as `~`. */
export function shortPath(folder, home) {
  if (!folder) {
    return '';
  }
  const root = String(home ?? '').replace(/\/+$/, '');
  if (root && (folder === root || folder.startsWith(`${root}/`))) {
    return `~${folder.slice(root.length)}`;
  }
  return folder;
}

/**
 * The colour of the branch a repository is on: the development branch is
 * where it should be, the release branch is fine to look at, anything else
 * (or no branch) is worth noticing.
 * @returns {'dev' | 'release' | 'other' | 'detached'}
 */
export function branchTone(state, source) {
  if (!state?.branch || state.detached) {
    return 'detached';
  }
  if (state.branch === source.devBranch) {
    return 'dev';
  }
  return state.branch === source.releaseBranch ? 'release' : 'other';
}

const SINCE_UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/**
 * How long ago something happened, in the largest whole unit, for
 * Intl.RelativeTimeFormat: under a minute is «now».
 * @returns {{value: number, unit: 'day' | 'hour' | 'minute' | 'second'}}
 */
export function sinceParts(time, now = Date.now()) {
  const passed = Math.max(0, now - new Date(time).getTime());
  for (const [unit, size] of SINCE_UNITS) {
    if (passed >= size) {
      return {value: -Math.floor(passed / size), unit};
    }
  }
  return {value: 0, unit: 'second'};
}

/**
 * What the person should know about a repository before the agent works in
 * it: it is not on the development branch, it has changes that a switch would
 * discard, a branch of the profile does not exist there.
 */
export function repoWarnings(state, source) {
  if (!state?.ok) {
    return [];
  }
  const warnings = [];
  if (state.detached) {
    warnings.push({kind: 'detached'});
  } else if (state.branch && state.branch !== source.devBranch) {
    warnings.push({kind: 'notDev', branch: state.branch});
  }
  if (state.changes.length) {
    warnings.push({kind: 'changes', count: state.changes.length});
  }
  if (!state.hasDev) {
    warnings.push({kind: 'noBranch', branch: source.devBranch});
  }
  if (!state.hasRelease) {
    warnings.push({kind: 'noBranch', branch: source.releaseBranch});
  }
  return warnings;
}

/**
 * The branch "Back to" returns to after a switch: the one before the first
 * switch, so several switches in a row still go back to where the copy was.
 * Going back forgets it.
 */
export function branchToRemember(remembered, previous, branch, {restoring = false} = {}) {
  if (restoring) {
    return null;
  }
  return remembered ?? (previous && previous !== branch ? previous : null);
}
