// The model every conversation of the dispatcher runs on. Kiro picks one by
// itself («auto») unless told; the station pins the one in its settings, and
// when the account does not offer it, the newest model of the same family
// (Sonnet 4.5 while Sonnet 5.5 is not there yet).

export const DEFAULT_MODEL = 'claude-sonnet-5.5';

// claude-sonnet-4.5 → {family: 'claude-sonnet', version: [4, 5]}
function parse(id) {
  const match = /^(.*?)-(\d+(?:\.\d+)*)$/.exec(id ?? '');
  return match ? {family: match[1], version: match[2].split('.').map(Number)} : {family: id, version: []};
}

const compareVersions = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) {
      return diff;
    }
  }
  return 0;
};

/**
 * The model to set, from the values Kiro offers: the wanted one, else the
 * newest of its family, else none (Kiro keeps its own choice).
 * @param {string[]} offered
 * @param {string} [wanted]
 * @returns {string | null}
 */
export function pickModel(offered, wanted = DEFAULT_MODEL) {
  if (!wanted || !offered?.length) {
    return null;
  }
  if (offered.includes(wanted)) {
    return wanted;
  }
  const {family} = parse(wanted);
  const same = offered.filter((id) => parse(id).family === family);
  return same.sort((a, b) => compareVersions(parse(b).version, parse(a).version))[0] ?? null;
}

/** The model option of a session, as Kiro sends it in `configOptions`. */
export const modelOption = (options) => options?.find((option) => option.id === 'model') ?? null;

/** The model a session runs on, by its name in Kiro's list. */
export function modelName(option) {
  const value = option?.currentValue;
  return option?.options?.find((one) => one.value === value)?.name ?? value ?? null;
}
