import {objectName} from './screen-objects.js';

// What the person picks after a session: units, each one a future screen
// object made of states of one screen. At first every state of a named
// screen is a unit of its own; states of the same screen can be merged into
// one unit and split again. A screen without a name gives no unit.

const unitKey = (screenKey, stateIds) => `${screenKey}#${stateIds.join('+')}`;

/**
 * @param {{key: string, title: string, named: boolean, states: {id: string, title: string}[]}[]} screens
 *   the states with the title shown for them
 */
export function initialUnits(screens) {
  return screens
    .filter((screen) => screen.named && screen.states.length)
    .flatMap((screen) =>
      screen.states.map((state) => ({
        key: unitKey(screen.key, [state.id]),
        screenKey: screen.key,
        stateIds: [state.id],
        name: objectName(screen.title, screen.states.length > 1 ? state.title : null),
        chosen: false,
      })),
    );
}

/** Units chosen or not; a name typed by the person. */
export const setUnit = (units, key, patch) => units.map((unit) => (unit.key === key ? {...unit, ...patch} : unit));

/**
 * Merges units of one screen into the first of them; units of another
 * screen are left as they are. The merged unit is chosen.
 */
export function mergeUnits(units, keys, screenTitle = '') {
  const picked = units.filter((unit) => keys.includes(unit.key));
  const screenKey = picked[0]?.screenKey;
  const same = picked.filter((unit) => unit.screenKey === screenKey);
  if (same.length < 2) {
    return units;
  }
  const stateIds = same.flatMap((unit) => unit.stateIds);
  const merged = {
    key: unitKey(screenKey, stateIds),
    screenKey,
    stateIds,
    name: objectName(screenTitle),
    chosen: true,
  };
  const gone = new Set(same.map((unit) => unit.key));
  const at = units.findIndex((unit) => gone.has(unit.key));
  const rest = units.filter((unit) => !gone.has(unit.key));
  return [...rest.slice(0, at), merged, ...rest.slice(at)];
}

/** A merged unit back into one unit for each of its states, all chosen. */
export function splitUnit(units, key, screen) {
  const unit = units.find((one) => one.key === key);
  if (!unit || unit.stateIds.length < 2) {
    return units;
  }
  const titles = new Map(screen.states.map((state) => [state.id, state.title]));
  const parts = unit.stateIds.map((stateId) => ({
    key: unitKey(unit.screenKey, [stateId]),
    screenKey: unit.screenKey,
    stateIds: [stateId],
    name: objectName(screen.title, titles.get(stateId) ?? null),
    chosen: true,
  }));
  const at = units.indexOf(unit);
  return [...units.slice(0, at), ...parts, ...units.slice(at + 1)];
}

/** The names of the chosen units, each once: a name taken twice gets a number. */
export function uniqueNames(units) {
  const seen = new Map();
  return units.map((unit) => {
    if (!unit.chosen) {
      return unit;
    }
    const base = unit.name.trim() || 'Screen';
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return {...unit, name: count > 1 ? `${base}${count}` : base};
  });
}
