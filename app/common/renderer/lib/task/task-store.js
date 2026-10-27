import {useSyncExternalStore} from 'react';

import {backend} from '../../polyfills.js';
import {profilesState} from '../settings/profiles-store.js';

// The task of the profile that is on, as the window sees it: its key, the
// recent ones, and its context, impact analysis and ticks. The main process
// keeps them; this store follows the profile and what the agent saves.

let state = {profileId: null, current: null, recent: [], data: null, loading: false, error: null};
const listeners = new Set();
let started = false;

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

export const useTask = () => useSyncExternalStore(subscribe, () => state);
export const currentTaskKey = () => state.current;

async function loadData() {
  publish({data: state.current ? await backend.task.load(state.profileId, state.current) : null});
}

/** Reads the tasks of the profile that is on. Called when the profile changes. */
export async function followTaskProfile() {
  const profileId = profilesState().activeId;
  if (!backend?.task || !profileId) {
    return;
  }
  const tasks = await backend.task.list(profileId);
  publish({profileId, current: tasks.current, recent: tasks.recent, error: null});
  await loadData();
}

export function startTasks() {
  if (started || !backend?.task) {
    return;
  }
  started = true;
  backend.task.onChanged(({profileId, key}) => {
    if (profileId === state.profileId && (key === state.current || key === null)) {
      loadData();
    }
  });
}

export async function refreshTask() {
  if (!state.current) {
    return;
  }
  publish({loading: true, error: null});
  const result = await backend.task.refresh(state.profileId, state.current);
  publish(result.ok ? {loading: false, data: result.data} : {loading: false, error: result});
}

/** Picks the task to work on, by key or link; its context is gathered the first time. */
export async function chooseTask(input) {
  const result = await backend.task.setCurrent(state.profileId, input);
  if (!result.ok) {
    publish({error: {error: result.error}});
    return false;
  }
  publish({current: result.current, recent: result.recent, error: null, data: null});
  await loadData();
  if (state.current && !state.data?.context) {
    await refreshTask();
  }
  return true;
}

export async function forgetCurrentTask() {
  if (state.current) {
    await backend.task.forget(state.profileId, state.current);
    await followTaskProfile();
  }
}

export async function toggleCheck(itemId, checked) {
  publish({data: await backend.task.check(state.profileId, state.current, itemId, checked)});
}

export async function giveFeedback(itemId, kind, reason = '') {
  publish({data: await backend.task.feedback(state.profileId, state.current, itemId, kind, reason)});
}
