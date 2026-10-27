// How the session went through the app: its screens, the states of each one
// and the path between them. Pure functions over plain data, so the limits
// that keep junk out are tested without a device.

// right after the Inspector acted on the device it looks often, then calms down
const FAST_MS = 500;
const CALM_MS = 1500;
const FAST_FOR_MS = 4000;
// an action this old is not what led to the screen
const ACTION_FOR_MS = 5000;

export const MAX_SCREENS = 40;
export const MAX_UNNAMED = 10;
export const MAX_STATES = 5;
export const MAX_STEPS = 200;

export const emptyFlow = () => ({screens: [], path: [], pathDropped: 0, currentKey: null, currentStateId: null});

/**
 * How long the follower waits before the next look at the screen.
 */
export function followDelay({lastActionAt, now}) {
  return lastActionAt && now - lastActionAt < FAST_FOR_MS ? FAST_MS : CALM_MS;
}

/**
 * The action of the Inspector that led to a step: done after the last step,
 * and not long ago.
 */
export function actionForStep(action, {lastStepAt, now}) {
  if (!action || now - action.at > ACTION_FOR_MS || (lastStepAt && action.at < lastStepAt)) {
    return null;
  }
  return action.name;
}

// the state to let go when a screen has too many: the least seen, not the first one nor the one on screen
function evictState(states, keepId) {
  const [, ...rest] = states;
  const victim = rest
    .filter((state) => state.id !== keepId)
    .reduce(
      (least, state) =>
        !least || state.visits < least.visits || (state.visits === least.visits && state.lastAt < least.lastAt)
          ? state
          : least,
      null,
    );
  return states.filter((state) => state !== victim);
}

// past this many screens the oldest go; past this many unnamed ones, the oldest unnamed
function limitScreens(screens) {
  let kept = screens;
  const unnamed = kept.filter((screen) => !screen.named);
  if (unnamed.length > MAX_UNNAMED) {
    const gone = new Set(unnamed.slice(0, unnamed.length - MAX_UNNAMED));
    kept = kept.filter((screen) => !gone.has(screen));
  }
  return kept.slice(-MAX_SCREENS);
}

/**
 * Notes a screen that settled, in the state it is in. The same screen is one
 * entry under its name; another set of elements on it is another state, the
 * same set updates that state. Only the state seen last keeps its full
 * screenshot, the others keep a reduced one. A screen without a name has no
 * states: what it shows now replaces what it showed.
 * @returns {{flow: object, arrived: boolean}} arrived when it is another screen or state than the last one
 */
export function addScreen(flow, {screen, state, now, data}) {
  const named = screen.source !== 'structure';
  const stateId = named ? state.id : 'only';
  const existing = flow.screens.find((entry) => entry.key === screen.key);
  const arrivedScreen = flow.currentKey !== screen.key;
  const arrived = arrivedScreen || flow.currentStateId !== stateId;

  const states = existing?.states ?? [];
  const known = states.find((entry) => entry.id === stateId);
  // states are numbered by how many were found, so a number is not given twice after one is let go
  const found = existing?.statesFound ?? 0;
  const number = known ? known.number : found + 1;
  const updated = {
    ...known,
    ...data,
    id: stateId,
    // a dialog names its state; the others are numbered in the order they were found
    title: state.title || known?.title || null,
    number,
    firstAt: known?.firstAt ?? now,
    lastAt: now,
    visits: (known?.visits ?? 0) + (arrived ? 1 : 0),
  };
  let nextStates = known ? states.map((entry) => (entry.id === stateId ? updated : entry)) : [...states, updated];
  if (nextStates.length > MAX_STATES) {
    nextStates = evictState(nextStates, stateId);
  }
  // the full screenshot is large: only the state on screen now keeps it
  nextStates = nextStates.map((entry) => (entry.id === stateId ? entry : {...entry, screenshot: null}));

  const entry = {
    ...existing,
    key: screen.key,
    title: screen.title,
    source: screen.source,
    named,
    firstAt: existing?.firstAt ?? now,
    lastAt: now,
    visits: (existing?.visits ?? 0) + (arrivedScreen ? 1 : 0),
    states: nextStates,
    statesFound: known ? found : number,
    currentStateId: stateId,
  };
  const screens = existing
    ? flow.screens.map((item) => (item.key === screen.key ? entry : item))
    : limitScreens([...flow.screens, entry]);
  return {flow: {...flow, screens, currentKey: screen.key, currentStateId: stateId}, arrived};
}

const sameSpot = (a, b) => !!a && !!b && a.key === b.key && a.stateId === b.stateId;

/**
 * Adds a step to the path of the session. Going back and forth between the
 * same two spots (A → B → A → B) does not grow the path: the step to B
 * counts one more repeat instead.
 */
export function addStep(flow, {key, stateId, at, action}) {
  const {path} = flow;
  const step = {key, stateId, at, action, repeat: 1};
  const last = path.at(-1);
  if (sameSpot(last, step)) {
    return flow;
  }
  const before = path.at(-2);
  const third = path.at(-3);
  if (sameSpot(before, step) && sameSpot(last, third)) {
    const back = {...before, at, action: action ?? before.action, repeat: before.repeat + 1};
    return {...flow, path: [...path.slice(0, -2), back]};
  }
  const next = [...path, step];
  const dropped = Math.max(0, next.length - MAX_STEPS);
  return {...flow, path: next.slice(dropped), pathDropped: flow.pathDropped + dropped};
}

// the commands of the Inspector as a tester names them
const ACTION_NAMES = {
  click: 'tap',
  tap: 'tap',
  elementClick: 'tap',
  gesture: 'gesture',
  swipe: 'gesture',
  scroll: 'gesture',
  performActions: 'gesture',
  sendKeys: 'type',
  elementSendKeys: 'type',
  setValue: 'type',
  clear: 'type',
  elementClear: 'type',
  back: 'back',
};

// mobile: commands sent as a script (mobile: tap, mobile: swipe) by what they do
const SCRIPT_KINDS = [
  [/tap|click/i, 'tap'],
  [/swipe|scroll|drag|pinch|gesture/i, 'gesture'],
  [/keys|type/i, 'type'],
  [/back/i, 'back'],
];

/** What kind of action a command of the Inspector is, for the path. */
export function actionKind(methodName, args = []) {
  if (methodName === 'executeScript' && typeof args?.[0] === 'string') {
    return SCRIPT_KINDS.find(([pattern]) => pattern.test(args[0]))?.[1] ?? 'command';
  }
  return ACTION_NAMES[methodName] ?? 'command';
}

/** Commands that only read the screen: not actions on the device. */
export const READ_ONLY_COMMANDS = new Set([
  'getPageSource',
  'takeScreenshot',
  'takeElementScreenshot',
  'getWindowSize',
  'getElementRect',
  'getContexts',
  'getSession',
  'getSettings',
  'getAppiumSessionCapabilities',
  'status',
  'findElement',
  'findElements',
  'getAttribute',
  'deleteSession',
]);
