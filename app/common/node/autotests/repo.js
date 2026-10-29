import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';

import {cleanAutotestsConfig} from '../../shared/autotests/config.js';
import {inspectRepo} from '../source/repo.js';

// The autotests repository of a project as the station sees it: a git
// repository, its branch, and whether the rules and the examples are where
// the project says. The station only reads it.

const RULES_MAX = 64 * 1024;

const kind = async (file) => {
  try {
    const info = await stat(file);
    return info.isDirectory() ? 'dir' : info.isFile() ? 'file' : null;
  } catch {
    return null;
  }
};

// how many Kotlin files a folder of examples has, a few levels deep
async function countKotlin(folder, depth = 4) {
  let count = 0;
  let entries;
  try {
    entries = await readdir(folder, {withFileTypes: true});
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isFile() && /\.kts?$/.test(entry.name)) {
      count += 1;
    } else if (entry.isDirectory() && depth > 0 && !entry.name.startsWith('.')) {
      count += await countKotlin(path.join(folder, entry.name), depth - 1);
    }
  }
  return count;
}

/**
 * The state of the autotests repository: whether it is one, its branch, and
 * what the generation needs. `missing` lists what is not there.
 */
export async function inspectAutotests(folder, value) {
  const config = cleanAutotestsConfig(value);
  if (!folder) {
    return {ok: false, error: 'noFolder', config, missing: ['folder']};
  }
  const repo = await inspectRepo(folder);
  if (!repo.ok) {
    return {ok: false, error: repo.error, config, missing: ['folder']};
  }
  const rulesKind = await kind(path.join(repo.root, config.rules));
  const examplesKind = config.examples ? await kind(path.join(repo.root, config.examples)) : null;
  const examples = examplesKind === 'dir' ? await countKotlin(path.join(repo.root, config.examples)) : 0;
  const missing = [];
  if (rulesKind !== 'file') {
    missing.push('rules');
  }
  if (config.examples && examplesKind !== 'dir') {
    missing.push('examples');
  }
  return {
    ok: true,
    root: repo.root,
    branch: repo.branch,
    detached: repo.detached,
    remote: repo.remote,
    config,
    rules: rulesKind === 'file',
    examples: config.examples ? {found: examplesKind === 'dir', files: examples} : null,
    missing,
  };
}

/** The rules of the team, as the model gets them. */
export async function readRules(root, value) {
  const {rules} = cleanAutotestsConfig(value);
  const text = await readFile(path.join(root, rules), 'utf8');
  return text.length > RULES_MAX ? `${text.slice(0, RULES_MAX)}\n…` : text;
}
