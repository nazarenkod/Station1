// Where the project's autotests keep what the station reads: the rules of
// screen objects and the screen objects already written, as examples. Both
// are paths inside the autotests repository, so they go with the project to
// another Mac; the repository's folder is this Mac's and lives apart.

export const DEFAULT_RULES_PATH = '.station/screen-objects.md';

/**
 * A path inside the repository as the team writes it, or null when it would
 * leave the repository: no absolute paths, no `..`.
 */
export function insidePath(value) {
  const clean = String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
  if (!clean || clean.startsWith('/') || /^[a-z]:/i.test(clean) || clean.split('/').includes('..')) {
    return null;
  }
  return clean;
}

/** The autotests settings of a project, with the defaults in place. */
export function cleanAutotestsConfig(value) {
  const config = value && typeof value === 'object' ? value : {};
  return {
    rules: insidePath(config.rules) ?? DEFAULT_RULES_PATH,
    examples: insidePath(config.examples) ?? '',
  };
}
