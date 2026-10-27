import {useSyncExternalStore} from 'react';

import {JOURNAL_LIMIT, mergeEntries} from '../../../shared/journal.js';
import {backend} from '../../polyfills.js';

/**
 * The journal as the window sees it: the summary and the records of this
 * run, kept up to date by the batches the main process sends.
 */
let state = {summary: null, entries: [], loaded: false};
const listeners = new Set();
let unsubscribe = null;

const set = (patch) => {
  state = {...state, ...patch};
  for (const listener of listeners) {
    listener();
  }
};

async function load() {
  const {summary, entries} = await backend.journal.list();
  set({summary, entries, loaded: true});
}

function follow() {
  if (unsubscribe || !backend.journal) {
    return;
  }
  unsubscribe = backend.journal.onChanged(({entries, cleared, summary}) => {
    if (cleared) {
      // a clear keeps the records still running: read the list again
      load();
      return;
    }
    set({summary, entries: mergeEntries(state.entries, entries).slice(-JOURNAL_LIMIT)});
  });
  load();
}

const subscribe = (listener) => {
  follow();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useJournal = () => useSyncExternalStore(subscribe, () => state);

export const reloadJournal = () => load();

export async function clearJournal() {
  await backend.journal.clear();
  await load();
}
