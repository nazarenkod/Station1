import {stat} from 'node:fs/promises';
import path from 'node:path';

import {parseStatus, parseSubmoduleStatus, safeRemote} from '../../shared/settings/source.js';
import {run, shellEnv} from '../doctor/exec.js';

// Git on the repositories of a project. The station reads them and, when the
// person or the agent asks, fetches, switches a branch and pulls fast-forward
// only. The copy belongs to the station: a switch discards local changes,
// tracked and new files, but never the ignored builds and caches.

const QUICK_MS = 15000;
const NETWORK_MS = 180000;

async function git(cwd, args, timeout = QUICK_MS) {
  // a fetch must never wait for a password nobody can type
  const env = {...(await shellEnv()), GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo'};
  return await run('git', args, {cwd, env, timeout});
}

const firstLine = (text) =>
  String(text ?? '')
    .trim()
    .split(/\r?\n/)[0] ?? '';

// what git said, for the person to read under the explanation
const failure = (error, result) => ({
  ok: false,
  error,
  detail: (result?.stderr || result?.stdout || '').trim().slice(0, 2000),
});

async function branchExists(cwd, branch) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    if ((await git(cwd, ['rev-parse', '--verify', '--quiet', ref])).ok) {
      return true;
    }
  }
  return false;
}

async function submodules(root) {
  const status = await git(root, ['submodule', 'status', '--recursive']);
  if (!status.ok) {
    return [];
  }
  const names = await git(root, ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.(path|url)$']);
  const declared = {};
  for (const line of String(names.stdout ?? '').split(/\r?\n/)) {
    const match = /^submodule\.(.+)\.(path|url)\s+(.*)$/.exec(line.trim());
    if (match) {
      declared[match[1]] = {...declared[match[1]], [match[2]]: match[3]};
    }
  }
  const byPath = Object.fromEntries(Object.entries(declared).map(([name, value]) => [value.path, {name, ...value}]));
  return parseSubmoduleStatus(status.stdout).map((module) => ({
    name: byPath[module.path]?.name ?? path.basename(module.path),
    path: module.path,
    url: safeRemote(byPath[module.path]?.url ?? ''),
    initialized: module.initialized,
  }));
}

/** The top folder of the repository a folder is in, or null. */
export async function repoRoot(folder) {
  const top = await git(folder, ['rev-parse', '--show-toplevel']);
  return top.ok ? firstLine(top.stdout) : null;
}

/**
 * The changes a switch would discard: in the repository and in every
 * checked-out submodule. A submodule itself is not listed as a change of the
 * repository; its files are.
 * @returns {Promise<{repo: string, path: string, kind: string}[]>}
 */
export async function changesToDiscard(root, modules) {
  const list = modules ?? (await submodules(root));
  const moduleRoots = new Set(list.map((module) => module.path));
  const changes = [];
  const collect = async (dir, repo) => {
    const result = await git(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    for (const change of result.ok ? parseStatus(result.stdout) : []) {
      if (!(repo === '.' && moduleRoots.has(change.path))) {
        changes.push({repo, ...change});
      }
    }
  };
  await collect(root, '.');
  for (const module of list.filter((candidate) => candidate.initialized)) {
    await collect(path.join(root, module.path), module.path);
  }
  return changes;
}

/**
 * What a repository folder is now: its root, branch, origin, the last fetch,
 * changes, submodules, and whether the profile's branches exist there.
 */
export async function inspectRepo(folder, {devBranch, releaseBranch} = {}) {
  try {
    if (!(await stat(folder)).isDirectory()) {
      return {ok: false, error: 'missing'};
    }
  } catch {
    return {ok: false, error: 'missing'};
  }
  const top = await git(folder, ['rev-parse', '--show-toplevel']);
  if (top.missing) {
    return {ok: false, error: 'gitMissing'};
  }
  if (!top.ok) {
    return failure('notRepo', top);
  }
  const root = firstLine(top.stdout);
  const [branch, remote, gitDir] = await Promise.all([
    git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    git(root, ['remote', 'get-url', 'origin']),
    git(root, ['rev-parse', '--absolute-git-dir']),
  ]);
  let lastFetch = null;
  try {
    lastFetch = (await stat(path.join(firstLine(gitDir.stdout), 'FETCH_HEAD'))).mtime.toISOString();
  } catch {
    // never fetched
  }
  const modules = await submodules(root);
  const [changes, hasDev, hasRelease] = await Promise.all([
    changesToDiscard(root, modules),
    devBranch ? branchExists(root, devBranch) : true,
    releaseBranch ? branchExists(root, releaseBranch) : true,
  ]);
  return {
    ok: true,
    root,
    branch: branch.ok ? firstLine(branch.stdout) : null,
    detached: !branch.ok,
    remote: remote.ok ? safeRemote(firstLine(remote.stdout)) : null,
    lastFetch,
    changes,
    submodules: modules,
    hasDev,
    hasRelease,
  };
}

/** The local branches and those of origin, by name, each once. */
export async function listBranches(root) {
  const result = await git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin']);
  if (!result.ok) {
    return [];
  }
  const names = String(result.stdout)
    .split(/\r?\n/)
    .map((ref) =>
      ref
        .trim()
        .replace(/^refs\/heads\//, '')
        .replace(/^refs\/remotes\/origin\//, ''),
    )
    .filter((name) => name && name !== 'HEAD');
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** `git fetch` of origin, the submodules too. */
export async function fetchRepo(root) {
  const result = await git(root, ['fetch', '--prune', '--recurse-submodules=on-demand', 'origin'], NETWORK_MS);
  return result.ok ? {ok: true} : failure(result.timedOut ? 'timeout' : 'fetch', result);
}

async function discard(root, modules) {
  const steps = [
    [root, ['reset', '--hard', '--quiet']],
    [root, ['clean', '-fd', '--quiet']],
    ...modules
      .filter((module) => module.initialized)
      .flatMap((module) => [
        [path.join(root, module.path), ['reset', '--hard', '--quiet']],
        [path.join(root, module.path), ['clean', '-fd', '--quiet']],
      ]),
  ];
  for (const [dir, args] of steps) {
    const result = await git(dir, args);
    if (!result.ok) {
      return failure('discard', result);
    }
  }
  return {ok: true};
}

/**
 * Switches the repository to a branch. Local changes are discarded first, in
 * the submodules too, then the submodules follow the branch.
 * @returns {Promise<{ok: true, previous: string | null, discarded: object[], warning: object | null} | {ok: false, error: string, detail?: string}>}
 */
export async function switchBranch(root, branch) {
  const current = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const previous = current.ok ? firstLine(current.stdout) : null;
  // nothing is discarded for a branch that is not there
  if (!(await branchExists(root, branch))) {
    return {ok: false, error: 'noBranch'};
  }
  const modules = await submodules(root);
  const discarded = await changesToDiscard(root, modules);
  if (discarded.length) {
    const cleaned = await discard(root, modules);
    if (!cleaned.ok) {
      return cleaned;
    }
  }
  // checkout rather than switch: old git has no stable switch; a branch only in origin is tracked from there
  const switched = await git(root, ['checkout', '--quiet', branch]);
  if (!switched.ok) {
    return failure('switch', switched);
  }
  // the branch is switched even when a submodule could not follow; the person sees why
  const updated = await git(root, ['submodule', 'update', '--init', '--recursive'], NETWORK_MS);
  return {ok: true, previous, discarded, warning: updated.ok ? null : failure('submodules', updated)};
}

/** `git pull --ff-only` of the branch that is on, then the submodules follow. */
export async function pullRepo(root) {
  const pulled = await git(root, ['pull', '--ff-only', '--quiet'], NETWORK_MS);
  if (!pulled.ok) {
    return failure(pulled.timedOut ? 'timeout' : 'pull', pulled);
  }
  const updated = await git(root, ['submodule', 'update', '--init', '--recursive'], NETWORK_MS);
  return updated.ok ? {ok: true} : failure('submodules', updated);
}
