import {useSyncExternalStore} from 'react';

// What the person has picked in a tool, for the chips of the next message
// to the agent: a request in the proxy, a line of the log. The Inspector's
// element and screen come from its own state. One pick a kind; picking
// nothing clears it.

let picks = {};
const listeners = new Set();

const publish = () => {
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A tool says what is selected in it now, or null for nothing. */
export function setPick(kind, pick) {
  if (picks[kind]?.id === pick?.id) {
    return;
  }
  picks = {...picks, [kind]: pick ?? null};
  publish();
}

export const usePicks = () => useSyncExternalStore(subscribe, () => picks);
export const currentPicks = () => picks;

// a request or a line to show, asked from elsewhere (the evidence of a goal); the tool takes it and clears it
let focus = null;
const focusListeners = new Set();

export function focusOn(kind, id) {
  focus = {kind, id, at: Date.now()};
  for (const listener of focusListeners) {
    listener();
  }
}

export const useFocus = () =>
  useSyncExternalStore(
    (listener) => {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
    () => focus,
  );

export const clearFocus = () => {
  focus = null;
};
