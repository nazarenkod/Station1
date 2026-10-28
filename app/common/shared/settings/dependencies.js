import {moduleFolder, moduleTree, safeRemote} from './source.js';

// The dependencies of a repository that bring code the team writes: git
// submodules, Swift packages, CocoaPods and Gradle modules outside the
// repository. The files are read by the Node side; here they are parsed, joined
// and judged, so the station page and the agent see the same thing.

export const DEPENDENCY_KINDS = ['submodule', 'spm', 'pod', 'gradle'];

const baseName = (value) =>
  String(value ?? '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .split(/[\\/:]/)
    .filter(Boolean)
    .pop() ?? '';

/** A path joined the way a dependency file means it: relative to the folder of that file. */
export function joinPath(dir, relative) {
  const text = String(relative ?? '');
  const parts = text.startsWith('/') ? [] : String(dir ?? '').split('/');
  for (const part of text.split('/')) {
    if (part === '..') {
      parts.pop();
    } else if (part && part !== '.') {
      parts.push(part);
    }
  }
  const joined = parts.join('/');
  return text.startsWith('/') || String(dir ?? '').startsWith('/') ? `/${joined.replace(/^\/+/, '')}` : joined;
}

/**
 * The host of a git address (`git@host:path`, `ssh://…`, `https://…`), or
 * null for a relative or local one, which is the team's own by where it lives.
 */
export function hostOf(url) {
  const text = String(url ?? '').trim();
  const scp = /^[^@/\s]+@([^:/\s]+):/.exec(text);
  if (scp) {
    return scp[1].toLowerCase();
  }
  const full = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^:/\s]+)/i.exec(text);
  if (full && !/^file:/i.test(text)) {
    return full[1].toLowerCase();
  }
  return null;
}

/** One address of a repository however it is written: the same package from two files meets here. */
export function sameUrl(url) {
  const text = String(url ?? '')
    .trim()
    .toLowerCase();
  const host = hostOf(text);
  if (!host) {
    return text.replace(/\.git$/, '').replace(/\/+$/, '');
  }
  const rest = text.replace(/^[^@/\s]+@[^:/\s]+:/, '').replace(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?[^/]+\//, '');
  return `${host}/${rest.replace(/\.git$/, '').replace(/\/+$/, '')}`;
}

const shortRevision = (revision) => (revision ? String(revision).slice(0, 7) : null);

/**
 * `Package.resolved` of Swift Package Manager, versions 1 to 3: each pinned
 * package with its address and version (or branch, or commit).
 * @returns {{name: string, url: string, version: string | null}[]}
 */
export function parsePackageResolved(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const pins = data?.pins ?? data?.object?.pins ?? [];
  return pins
    .map((pin) => {
      const url = pin.location ?? pin.repositoryURL ?? '';
      const state = pin.state ?? {};
      return {
        name: pin.identity ?? pin.package ?? baseName(url),
        url,
        version: state.version ?? state.branch ?? shortRevision(state.revision),
      };
    })
    .filter((pin) => pin.url);
}

/**
 * The Swift packages of an Xcode project (`project.pbxproj`): remote ones
 * with their address and the version asked for, local ones with their path
 * relative to the folder of the `.xcodeproj`.
 */
export function parsePbxPackages(text) {
  const source = String(text ?? '');
  const remote = [];
  const local = [];
  const blocks = source.match(/\{\s*isa = XC(?:Remote|Local)SwiftPackageReference;[\s\S]*?\n\t\t\};/g) ?? [];
  for (const block of blocks) {
    const value = (key) => {
      const match = new RegExp(`\\b${key} = ("(?:[^"\\\\]|\\\\.)*"|[^;\\s]+);`).exec(block);
      return match ? match[1].replace(/^"|"$/g, '') : null;
    };
    if (block.includes('XCRemoteSwiftPackageReference')) {
      const url = value('repositoryURL');
      if (url) {
        remote.push({
          url,
          version: value('minimumVersion') ?? value('version') ?? value('branch') ?? shortRevision(value('revision')),
        });
      }
    } else {
      const path = value('relativePath') ?? value('path');
      if (path) {
        local.push({path});
      }
    }
  }
  return {remote, local};
}

/** The dependencies declared in a `Package.swift`: `.package(url: …)` and `.package(path: …)`. */
export function parsePackageSwift(text) {
  const source = String(text ?? '');
  const remote = [];
  const local = [];
  for (const match of source.matchAll(/\.package\(\s*(?:name:\s*"[^"]*"\s*,\s*)?(url|path):\s*"([^"]+)"([^)]*)\)/g)) {
    if (match[1] === 'path') {
      local.push({path: match[2]});
    } else {
      const version =
        /(?:from|exact|branch|revision):\s*"([^"]+)"/.exec(match[3])?.[1] ?? /"([^"]+)"\s*\.\.[.<]/.exec(match[3])?.[1];
      remote.push({url: match[2], version: version ?? null});
    }
  }
  return {remote, local};
}

/** The entries of a top-level section of `Podfile.lock`, as lines without their indent. */
const lockSection = (text, name) => {
  const lines = String(text ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${name}:`);
  if (start < 0) {
    return [];
  }
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) {
      break;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    body.push(line);
  }
  return body;
};

const lockValue = (line) =>
  line
    .replace(/^\s*-?\s*/, '')
    .replace(/:$/, '')
    .replace(/^"|"$/g, '');

/**
 * The pods of a `Podfile.lock` the app asks for itself: those from git or a
 * local path (`EXTERNAL SOURCES`), and those from spec repositories, with the
 * repository they come from. Versions come from `PODS`, commits and tags from
 * `CHECKOUT OPTIONS`.
 * @returns {{name: string, url: string | null, path: string | null, specRepo: string | null, version: string | null}[]}
 */
export function parsePodfileLock(text) {
  const versions = {};
  for (const line of lockSection(text, 'PODS')) {
    const match = /^ {2}- "?([^\s/"(]+)(?:\/[^\s"(]+)?"? \(([^)]+)\)/.exec(line);
    if (match && !versions[match[1]]) {
      versions[match[1]] = match[2];
    }
  }
  const sourcesOf = (section) => {
    const result = {};
    let current = null;
    for (const line of lockSection(text, section)) {
      if (/^ {2}\S/.test(line)) {
        current = lockValue(line);
        result[current] = {};
      } else if (current) {
        const match = /^\s+:(\w+):\s*"?([^"]*)"?$/.exec(line);
        if (match) {
          result[current][match[1]] = match[2];
        }
      }
    }
    return result;
  };
  const external = sourcesOf('EXTERNAL SOURCES');
  const checkout = sourcesOf('CHECKOUT OPTIONS');
  const pods = [];
  for (const [name, from] of Object.entries(external)) {
    const pinned = checkout[name] ?? {};
    pods.push({
      name,
      url: from.git ?? null,
      path: from.path ?? null,
      specRepo: null,
      version:
        pinned.tag ?? from.tag ?? from.branch ?? shortRevision(pinned.commit ?? from.commit) ?? versions[name] ?? null,
    });
  }
  let repo = null;
  for (const line of lockSection(text, 'SPEC REPOS')) {
    if (/^ {2}\S/.test(line)) {
      repo = lockValue(line);
    } else if (repo) {
      const name = lockValue(line);
      if (!external[name]) {
        pods.push({name, url: null, path: null, specRepo: repo, version: versions[name] ?? null});
      }
    }
  }
  return pods;
}

/**
 * The modules a Gradle settings file takes from outside the usual place:
 * `includeBuild("…")` and `project(':x').projectDir = file("…")`.
 * @returns {{name: string, path: string}[]}
 */
export function parseGradleSettings(text) {
  const source = String(text ?? '').replace(/\/\/[^\n]*/g, '');
  const modules = [];
  for (const match of source.matchAll(/includeBuild\s*\(?\s*["']([^"']+)["']/g)) {
    modules.push({name: baseName(match[1]), path: match[1]});
  }
  const dirs =
    /project\(\s*["']:?([^"']+)["']\s*\)\.projectDir\s*=\s*(?:new\s+)?(?:file|File)\s*\(\s*(?:(?:settingsDir|rootDir|rootProject\.projectDir)\s*,\s*)?["']([^"']+)["']/g;
  for (const match of source.matchAll(dirs)) {
    modules.push({name: match[1].split(':').pop(), path: match[2]});
  }
  return modules;
}

/** The key a dependency's own folder is kept under: a submodule by its path, as before. */
export const dependencyKey = (kind, name, path = null) =>
  kind === 'submodule' ? path : `${kind}:${String(name).toLowerCase()}`;

/**
 * Each dependency once: the same package named in `Package.resolved` and in
 * the Xcode project is one, the version from the first that has it.
 */
export function mergeDependencies(list) {
  const seen = new Map();
  for (const dep of list ?? []) {
    const id =
      dep.kind === 'submodule' ? `submodule:${dep.path}` : dep.url ? `${dep.kind}:${sameUrl(dep.url)}` : dep.key;
    const known = seen.get(id);
    if (!known) {
      seen.set(id, {...dep});
    } else {
      known.version ??= dep.version;
      known.present ||= dep.present;
      known.folder ??= dep.folder;
    }
  }
  return [...seen.values()];
}

/**
 * The team's own code or a library of others: a submodule or package from
 * the host of the repository's origin, a relative address or a local path is
 * the team's; anything from another host (or the CocoaPods trunk) is not. A
 * repository without a remote origin keeps all of them.
 */
export function isOwnDependency(dep, origin) {
  if (dep.local) {
    return true;
  }
  const address = dep.url ?? dep.specRepo;
  if (!address || /^trunk$/i.test(address)) {
    return dep.kind === 'submodule';
  }
  const host = hostOf(address);
  // without an origin (or a local one) there is nothing to tell the team's host by
  if (!host || !hostOf(origin)) {
    return true;
  }
  return host === hostOf(origin);
}

/**
 * Where the code of a dependency is on this Mac and what that means: a folder
 * the person set (`own`), found where the project expects it (`found`), or
 * none. A submodule of a submodule follows the folder of its parent.
 * @returns {{status: 'own' | 'found' | 'none', folder: string | null}}
 */
export function dependencyCode(dep, {root, own = {}, tree = []}) {
  if (own[dep.key]) {
    return {status: 'own', folder: own[dep.key]};
  }
  if (dep.kind === 'submodule') {
    const parentOwn = tree.some((one) => one.path !== dep.path && dep.path.startsWith(`${one.path}/`) && own[one.path]);
    return dep.initialized || parentOwn
      ? {status: 'found', folder: moduleFolder(root, dep.path, own, tree)}
      : {status: 'none', folder: null};
  }
  return dep.present && dep.folder ? {status: 'found', folder: dep.folder} : {status: 'none', folder: null};
}

/**
 * The dependencies of a repository as the page shows them: each with its
 * code and whether it is the team's, submodules as a tree; the team's first,
 * by kind, then by name.
 */
export function describeDependencies(state, own = {}) {
  const deps = state?.dependencies ?? [];
  const tree = moduleTree(deps.filter((dep) => dep.kind === 'submodule'));
  const placed = new Map(tree.map((module) => [module.path, module]));
  const order = (dep) => DEPENDENCY_KINDS.indexOf(dep.kind);
  return deps
    .map((dep) => {
      const node = dep.kind === 'submodule' ? placed.get(dep.path) : null;
      return {
        ...dep,
        depth: node?.depth ?? 0,
        parent: node?.parent ?? null,
        own: isOwnDependency(dep, state?.remote),
        code: dependencyCode(dep, {root: state.root, own, tree}),
      };
    })
    .sort(
      (a, b) =>
        Number(b.own) - Number(a.own) ||
        order(a) - order(b) ||
        (a.kind === 'submodule' ? a.path.localeCompare(b.path) : a.name.localeCompare(b.name)),
    );
}

/**
 * The folders an operator conversation opens and a map of them for its
 * instructions: the repositories of the code it is given (one platform's,
 * from sourceFor) and the team's own dependencies whose code is on this Mac.
 * Libraries of others never go, even with a folder: they would flood every
 * search. A dependency two repositories share (the same address) comes once.
 * @param {{repos: object[]}} source the code of a platform
 * @param {Record<string, {path: string, modules?: Record<string, string>}>} paths the folders of this profile
 * @param {Record<string, object>} states the state of each repository by id
 * @returns {{cwd: string | null, additionalDirectories: string[], map: {repo: string, name: string, kind: string, folder: string}[]}}
 */
export function agentWorkspace(source, paths = {}, states = {}) {
  const folders = [];
  const map = [];
  const seen = new Set();
  for (const repo of source.repos ?? []) {
    const state = states[repo.id];
    const root = state?.ok ? state.root : null;
    if (!root || !paths[repo.id]?.path) {
      continue;
    }
    folders.push(root);
    map.push({repo: repo.name, name: repo.name, kind: 'repo', folder: root});
    // a state from before the dependencies knew only the submodules
    const known = state.dependencies ?? (state.submodules ?? []).map((module) => submoduleDependency(module));
    for (const dep of describeDependencies({...state, dependencies: known}, paths[repo.id]?.modules ?? {})) {
      if (!dep.own || dep.code.status === 'none') {
        continue;
      }
      const same = dep.url ? `${dep.kind}:${sameUrl(dep.url)}` : `${repo.id}:${dep.key}`;
      if (seen.has(same)) {
        continue;
      }
      seen.add(same);
      folders.push(dep.code.folder);
      map.push({
        repo: repo.name,
        name: dep.kind === 'submodule' ? dep.path : dep.name,
        kind: dep.kind,
        folder: dep.code.folder,
      });
    }
  }
  const unique = [...new Set(folders)];
  return {cwd: unique[0] ?? null, additionalDirectories: unique.slice(1), map};
}

const MAP_KIND = {
  repo: 'repository',
  submodule: 'git submodule',
  spm: 'Swift package',
  pod: 'CocoaPod',
  gradle: 'Gradle module',
};

/**
 * The map of the code for the agent's instructions: a line per repository
 * and dependency with its folder, so it goes straight to the module it needs.
 */
export function codeMap(map = []) {
  return map.map((entry) => `- ${entry.name} (${MAP_KIND[entry.kind] ?? entry.kind}): ${entry.folder}`).join('\n');
}

/** A submodule as a dependency, from what `git submodule status` and `.gitmodules` say. */
export function submoduleDependency(module) {
  return {
    kind: 'submodule',
    key: dependencyKey('submodule', module.name, module.path),
    name: module.name ?? baseName(module.path),
    path: module.path,
    url: module.url ? safeRemote(module.url) : null,
    version: module.commit ? shortRevision(module.commit) : null,
    initialized: !!module.initialized,
    local: false,
  };
}
