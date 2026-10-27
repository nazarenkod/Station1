import {useSyncExternalStore} from 'react';

import {backend} from '../../polyfills.js';
import {screenHistory, subscribeScreenHistory} from '../A11yTool/screen-history.js';

/**
 * The app's data as the main process last read it: the snapshot, the change
 * feed, the edits that can go back. The main process reads and watches; this
 * store only shows what it sends and asks it to do things.
 */
let state = {
  snapshot: null,
  changes: [],
  edits: [],
  marks: {},
  busy: false,
  watching: false,
  search: {query: '', result: null, busy: false},
};
const listeners = new Set();
let attached = false;
let lastScreen;

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

export const useAppData = () => useSyncExternalStore(subscribe, () => state);
export const appDataState = () => state;

// the title of the screen the session is on, for the change feed
function currentScreenTitle() {
  const history = screenHistory();
  const screen = history.screens?.find((one) => one.key === history.currentKey);
  return screen?.title ?? null;
}

function noteScreen() {
  const title = currentScreenTitle();
  if (title !== lastScreen) {
    lastScreen = title;
    backend.appData?.screen(title);
  }
}

/** Follows what the main process sends and the screen of the session; once. */
export async function attachAppData() {
  if (attached || !backend.appData) {
    return;
  }
  attached = true;
  backend.appData.onUpdate((update) => publish(update));
  subscribeScreenHistory(noteScreen);
  noteScreen();
  publish(await backend.appData.state());
}

let lastTarget = null;
/** The device and app chosen in the title bar; nothing is read until asked. */
export async function selectTarget(device, appId) {
  if (!backend.appData) {
    return;
  }
  const target = device && appId ? `${device.id}|${appId}` : null;
  const next = await backend.appData.select(device ?? null, appId ?? null);
  // a search belongs to the data it searched
  publish(target === lastTarget ? next : {...next, search: {query: '', result: null, busy: false}});
  lastTarget = target;
}

export const refresh = async () => await backend.appData.refresh();
export const setWatching = async (on) => await backend.appData.watch(on);

let searchSeq = 0;
/** One search over all the data; a newer search wins over an older one still running. */
export async function search(query) {
  const text = String(query ?? '').trim();
  const seq = ++searchSeq;
  if (!text) {
    publish({search: {query: '', result: null, busy: false}});
    return;
  }
  publish({search: {query: text, result: state.search.result, busy: true}});
  const result = await backend.appData.search(text).catch(() => null);
  if (seq === searchSeq) {
    publish({search: {query: text, result, busy: false}});
  }
}

export const readTable = async (file, table, options) => await backend.appData.table(file, table, options);
export const runQuery = async (file, sql, options) => await backend.appData.query(file, sql, options);
export const readFileContent = async (file) => await backend.appData.file(file);
export const setPref = async (file, key, value, type, options) =>
  await backend.appData.setPref(file, key, value, type, options);
export const removePref = async (file, key, options) => await backend.appData.removePref(file, key, options);
export const putFile = async (file, localFile, options) => await backend.appData.put(file, localFile, options);
export const removeFile = async (file, options) => await backend.appData.removeFile(file, options);
export const revert = async (editId) => await backend.appData.revert(editId);
export const clearData = async () => await backend.appData.clear();
export const clearBackups = async () => await backend.appData.clearBackups();
export const saveToMac = async (file, isFolder) => await backend.appData.save(file, isFolder);
export const pathForFile = (file) => backend.appData.pathForFile(file);
