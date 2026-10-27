// The code of a project: the repositories of the app on this Mac, their
// submodules and the branches the team develops and releases from. The
// profile keeps what the team shares (branches, names and roles of the
// repositories); the folders are this Mac's and live apart, in SOURCE_PATHS.

export const REPO_ROLES = ['app', 'android', 'ios', 'backend', 'shared', 'other'];

// the platforms of a submodule: one shared by the Android and iOS apps is «all»
export const MODULE_PLATFORMS = ['all', 'android', 'ios'];

// a repository of one platform is left out of the operator's folders while the device is of the other
const ROLE_PLATFORM = {android: 'android', ios: 'ios'};

export const DEFAULT_DEV_BRANCH = 'develop';
export const DEFAULT_RELEASE_BRANCH = 'main';

const newRepoId = () => `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// a branch name git would take; anything else falls back to the default
const branchName = (value, fallback) => {
  const name = String(value ?? '').trim();
  return name && !/[\s~^:?*[\\]|\.\.|@\{|^-|\/$|\.lock$/.test(name) ? name : fallback;
};

/**
 * The code of a profile, cleaned up: the branches, and the repositories with
 * an id, a name and a role, no id twice. The first repository is the main one.
 */
export function projectSource(source) {
  const ids = new Set();
  const repos = [];
  for (const repo of Array.isArray(source?.repos) ? source.repos : []) {
    const id = String(repo?.id ?? '').trim() || newRepoId();
    if (ids.has(id)) {
      continue;
    }
    ids.add(id);
    repos.push({
      id,
      name: String(repo?.name ?? '').trim() || id,
      role: REPO_ROLES.includes(repo?.role) ? repo.role : repos.length ? 'other' : 'app',
    });
  }
  return {
    devBranch: branchName(source?.devBranch, DEFAULT_DEV_BRANCH),
    releaseBranch: branchName(source?.releaseBranch, DEFAULT_RELEASE_BRANCH),
    repos,
    modules: cleanModules(source?.modules, ids),
  };
}

/**
 * The platform of each submodule, by repository and the submodule's path in
 * it; «all» is the default and is not kept.
 * @returns {Record<string, Record<string, {platform: string}>>}
 */
function cleanModules(modules, repoIds) {
  const clean = {};
  for (const [repoId, byPath] of Object.entries(modules && typeof modules === 'object' ? modules : {})) {
    if (!repoIds.has(repoId) || !byPath || typeof byPath !== 'object') {
      continue;
    }
    for (const [modulePath, value] of Object.entries(byPath)) {
      const platform = value?.platform;
      if (modulePath && MODULE_PLATFORMS.includes(platform) && platform !== 'all') {
        clean[repoId] = {...clean[repoId], [modulePath]: {platform}};
      }
    }
  }
  return clean;
}

/** The profile's code with one submodule's platform set (`all` takes the setting off). */
export function setModulePlatform(source, repoId, modulePath, platform) {
  const byPath = {...source.modules?.[repoId], [modulePath]: {platform}};
  return projectSource({...source, modules: {...source.modules, [repoId]: byPath}});
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
 * The platform a submodule is for: its own setting, else that of the
 * submodule it is in, else «all».
 */
export function modulePlatform(source, repoId, modulePath, tree) {
  for (let current = modulePath; current; current = tree.find((one) => one.path === current)?.parent ?? null) {
    const platform = source.modules?.[repoId]?.[current]?.platform;
    if (platform) {
      return platform;
    }
  }
  return 'all';
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

/** A new repository for the profile, named after its folder. */
export function newRepo(source, folder) {
  const name =
    String(folder ?? '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || 'repo';
  return {id: newRepoId(), name, role: source.repos.length ? 'other' : 'app'};
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
    .map(([, mark, , path]) => ({path, initialized: mark !== '-'}));
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
 * The folders an operator conversation opens: the repositories and their
 * checked-out submodules (or the folders set for them). While the device is
 * Android or iOS, the repositories and submodules of the other platform are
 * left out, and the repository of the device's platform is where it works.
 * A submodule two repositories share (the same address) comes once. A
 * repository without a folder or not found is left out.
 * @param {object} source the profile's code
 * @param {Record<string, {path: string, modules?: Record<string, string>}>} paths the folders of this profile
 * @param {Record<string, object>} states the state of each repository by id
 * @param {string | null} [platform] `android`, `ios`, or null for all
 * @returns {{cwd: string | null, additionalDirectories: string[]}}
 */
export function agentWorkspace(source, paths = {}, states = {}, platform = null) {
  const fits = (wanted) => !platform || !wanted || wanted === 'all' || wanted === platform;
  const ownPlatform = (repo) => Number(!!platform && ROLE_PLATFORM[repo.role] === platform);
  const repos = [...source.repos].sort((a, b) => ownPlatform(b) - ownPlatform(a));
  const folders = [];
  const seen = new Set();
  for (const repo of repos) {
    const state = states[repo.id];
    const root = state?.ok ? state.root : null;
    if (!root || !paths[repo.id]?.path || !fits(ROLE_PLATFORM[repo.role])) {
      continue;
    }
    folders.push(root);
    const own = paths[repo.id]?.modules ?? {};
    const tree = moduleTree(state.submodules ?? []);
    for (const module of tree) {
      if (!(module.initialized || own[module.path]) || !fits(modulePlatform(source, repo.id, module.path, tree))) {
        continue;
      }
      const same = module.url || `${repo.id}:${module.path}`;
      if (seen.has(same)) {
        continue;
      }
      seen.add(same);
      folders.push(moduleFolder(root, module.path, own, tree));
    }
  }
  const unique = [...new Set(folders)];
  return {cwd: unique[0] ?? null, additionalDirectories: unique.slice(1)};
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
