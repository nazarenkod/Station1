import {useSyncExternalStore} from 'react';

// One goal form for the whole window: opened from a goal card in the chat,
// the goals panel, a request, a log line or a checklist item, with what is
// known filled in.

let state = {open: false, initial: null, onSave: null};
const listeners = new Set();

const publish = (patch) => {
  state = {...state, ...patch};
  for (const listener of listeners) {
    listener();
  }
};

export const useGoalForm = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );

/** Opens the form; `onSave` gets the goal, or the goal is added to the task. */
export const openGoalForm = (initial = {}, onSave = null) => publish({open: true, initial, onSave});
export const closeGoalForm = () => publish({open: false, initial: null, onSave: null});
