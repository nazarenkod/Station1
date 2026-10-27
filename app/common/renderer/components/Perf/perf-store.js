import {useSyncExternalStore} from 'react';

import {addSample} from '../../../shared/perf/series.js';
import {backend} from '../../polyfills.js';
import {screenHistory, subscribeScreenHistory} from '../A11yTool/screen-history.js';

/**
 * The measurement of the app as the screens see it: a sample a second for as
 * long as it runs, markers of its processes and of the screens the session
 * went through. Samples arrive every second, so they live here rather than in
 * Redux: the list grows in place and `version` tells components to look again.
 */
let state = {
  version: 0,
  running: false,
  deviceId: null,
  appId: null,
  startedAt: null,
  android: false,
  samples: [],
  markers: [],
  status: {state: 'idle'},
};
const listeners = new Set();
let unsubscribe = null;
let unsubscribeScreens = null;
let lastScreenId = null;

function publish(patch = {}) {
  state = {...state, ...patch, version: state.version + 1};
  for (const listener of listeners) {
    listener();
  }
}

function applyBatch(batch) {
  if (!state.running) {
    return;
  }
  for (const sample of batch.samples) {
    addSample(state.samples, sample);
  }
  state.markers.push(...batch.markers);
  publish({status: batch.status});
}

// the same screen in a new session is a new arrival
const screenId = (history) => `${history.sessionId}|${history.currentKey}`;

/**
 * The screen the session is on, as a marker, when it is another than the
 * last one marked. The moment is the step of the path that brought it.
 */
export function screenMarker(history, lastId, now = Date.now()) {
  const key = history.currentKey;
  if (!key || screenId(history) === lastId) {
    return null;
  }
  const screen = history.screens.find((item) => item.key === key);
  const step = history.path.at(-1);
  return {
    at: step?.key === key ? step.at : now,
    kind: 'screen',
    key,
    title: screen?.named ? screen.title : null,
  };
}

function noteScreen() {
  const history = screenHistory();
  const marker = screenMarker(history, lastScreenId);
  if (!marker || !state.running) {
    return;
  }
  lastScreenId = screenId(history);
  // a screen read before the measurement started is on from its start
  state.markers.push({...marker, at: Math.max(marker.at, state.startedAt)});
  publish();
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const usePerf = () => useSyncExternalStore(subscribe, () => state);
export const perfState = () => state;

function listen() {
  unsubscribe ??= backend.perf.onBatch(applyBatch);
  unsubscribeScreens ??= subscribeScreenHistory(noteScreen);
}

/**
 * Starts measuring the app on the device from now on. `markScreen` marks the
 * screen a running session is on; a session about to start brings its own.
 */
export async function startPerf(device, appId, {markScreen = true} = {}) {
  if (!backend.perf || !device) {
    return;
  }
  listen();
  state.samples.length = 0;
  state.markers.length = 0;
  lastScreenId = null;
  publish({
    running: true,
    deviceId: device.id,
    appId,
    android: /android/i.test(device.platformName ?? ''),
    startedAt: Date.now(),
    status: {state: 'starting'},
  });
  if (markScreen) {
    noteScreen();
  } else {
    lastScreenId = screenId(screenHistory());
  }
  const status = await backend.perf.start(device, appId);
  if (state.running) {
    publish({status});
  }
}

export async function stopPerf() {
  if (!state.running) {
    return;
  }
  publish({running: false, status: {...state.status, state: 'stopped'}});
  await backend.perf?.stop();
}

/**
 * Picks up a measurement the main process still runs, after the window
 * reloaded.
 */
export async function attachPerf() {
  if (!backend.perf || state.running) {
    return;
  }
  const snapshot = await backend.perf.snapshot();
  if (!snapshot || snapshot.status.state === 'stopped') {
    return;
  }
  listen();
  state.samples.length = 0;
  state.samples.push(...snapshot.samples);
  state.markers.length = 0;
  state.markers.push(...snapshot.markers);
  publish({
    running: true,
    deviceId: snapshot.deviceId,
    appId: snapshot.appId,
    android: snapshot.android,
    startedAt: snapshot.startedAt,
    status: snapshot.status,
  });
}

/**
 * The device or app in the title bar changed: what was measured is another
 * app now, so the measurement stops.
 */
export function followSelection(deviceId, appId) {
  if (state.running && (state.deviceId !== deviceId || state.appId !== appId)) {
    stopPerf();
  }
}
