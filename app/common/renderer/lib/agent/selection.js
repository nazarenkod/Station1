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
