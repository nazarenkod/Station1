import {useSyncExternalStore} from 'react';

import {actionForStep, actionKind, addScreen, addStep, emptyFlow, READ_ONLY_COMMANDS} from './screen-flow.js';

const THUMB_WIDTH = 96;
// enough to see a past state again, a part of the size of a full screenshot
const REDUCED_WIDTH = 720;

/**
 * The screens the session went through: each screen once under its name,
 * with its states, and the path between them (see screen-flow.js). Kept for
 * the session only, outside Redux, since the screenshots are large.
 */
let state = {
  sessionId: null,
  ...emptyFlow(),
  // the state being looked back at, while the device may show another one
  viewingKey: null,
  viewingStateId: null,
  // the last action of the Inspector on the device
  lastAction: null,
};
const listeners = new Set();

function publish(patch) {
  state = {...state, ...patch};
  for (const listener of listeners) {
    listener();
  }
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useScreenHistory = () => useSyncExternalStore(subscribe, () => state);
export const screenHistory = () => state;
// the Performance tab marks its graphs with the screens as they change
export const subscribeScreenHistory = subscribe;

/**
 * A command the Inspector sent to the device: the follower looks more often
 * for a while, and the next step of the path says what led to it.
 */
export function noteAction(methodName, args = [], now = Date.now()) {
  if (!methodName || READ_ONLY_COMMANDS.has(methodName)) {
    return;
  }
  publish({lastAction: {name: actionKind(methodName, args), at: now}});
}

/** An action of the agent on the device: the next step of the path is the Operator's. */
export function noteAgentAction(now = Date.now()) {
  publish({lastAction: {name: 'agent', at: now}});
}

/** Starts the screens and the path over: a new test on the same session. */
export function clearScreenHistory() {
  publish({...emptyFlow(), viewingKey: null, viewingStateId: null, lastAction: null});
}

/**
 * A smaller JPEG of the screenshot: a thumbnail for the strip, or a reduced
 * copy to show a past state again.
 */
async function shrink(screenshot, width, quality) {
  if (!screenshot) {
    return null;
  }
  try {
    const blob = await (await fetch(`data:image/png;base64,${screenshot}`)).blob();
    const image = await createImageBitmap(blob);
    const scale = Math.min(1, width / image.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}

/**
 * Notes the screen just checked, in its state. Another screen or state than
 * the last one is a step of the path; the same one checked again only
 * updates what is kept of it.
 */
export async function recordScreen({sessionId, screen, sourceXML, screenshot, score, counts, now = Date.now()}) {
  if (!sessionId || !screen?.key) {
    return;
  }
  // a new session starts a new history
  if (state.sessionId !== sessionId) {
    publish({sessionId, ...emptyFlow(), viewingKey: null, viewingStateId: null, lastAction: null});
  }
  // a past screen shown again is not a visit
  if (state.viewingKey) {
    return;
  }
  const [thumb, reduced] = await Promise.all([
    shrink(screenshot, THUMB_WIDTH, 0.7),
    shrink(screenshot, REDUCED_WIDTH, 0.8),
  ]);
  const data = {sourceXML, screenshot, score, counts};
  // a picture that could not be made keeps the one from before
  if (thumb) {
    data.thumb = thumb;
  }
  if (reduced) {
    data.reduced = reduced.replace(/^data:image\/jpeg;base64,/, '');
  }
  const added = addScreen(state, {screen, state: screen.state ?? {id: 'only', title: null}, now, data});
  let flow = added.flow;
  if (added.arrived) {
    const action = actionForStep(state.lastAction, {lastStepAt: state.path.at(-1)?.at ?? null, now});
    flow = addStep(flow, {key: flow.currentKey, stateId: flow.currentStateId, at: now, action});
  }
  publish(flow);
}

export function viewScreen(key, stateId = null) {
  publish({viewingKey: key, viewingStateId: stateId});
}

export function stopViewing() {
  publish({viewingKey: null, viewingStateId: null});
}
