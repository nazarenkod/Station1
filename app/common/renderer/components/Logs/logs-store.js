import {useSyncExternalStore} from 'react';

import {LOG_RULES_CONFIG} from '../../../shared/setting-defs.js';
import {backend, getSetting, setSetting} from '../../polyfills.js';

const MAX_ENTRIES = 20000;

/**
 * The device log as the screens see it. Up to twenty thousand lines arrive
 * several times a second, so they live here rather than in Redux: the entry
 * list is appended in place, and every batch makes a new snapshot object
 * whose `version` tells components to look again.
 */
let state = {
  version: 0,
  started: false,
  deviceId: null,
  appId: null,
  entries: [],
  findings: new Map(),
  processes: [],
  status: {state: 'idle'},
  rules: {overrides: {}, custom: []},
};
const listeners = new Set();
let unsubscribe = null;

function publish(patch = {}) {
  state = {...state, ...patch, version: state.version + 1};
  for (const listener of listeners) {
    listener();
  }
}

function applyBatch(batch) {
  if (batch.reset) {
    state.entries.length = 0;
    state.entries.push(...batch.entries);
    publish({
      findings: new Map(batch.findings.map((finding) => [finding.id, finding])),
      processes: batch.processes,
      status: batch.status,
      appId: batch.appId,
    });
    return;
  }
  state.entries.push(...batch.entries);
  if (state.entries.length > MAX_ENTRIES) {
    state.entries.splice(0, state.entries.length - MAX_ENTRIES);
  }
  const findings = batch.findings.length ? new Map(state.findings) : state.findings;
  for (const finding of batch.findings) {
    findings.set(finding.id, finding);
  }
  publish({findings, processes: batch.processes, status: batch.status, appId: batch.appId});
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useLogs = () => useSyncExternalStore(subscribe, () => state);

export const logsState = () => state;

async function loadRules() {
  return {overrides: {}, custom: [], ...((await getSetting(LOG_RULES_CONFIG)) ?? {})};
}

/**
 * Starts the log of a device, or follows the new app when the device is the
 * same. Picks up a stream the main process already runs (after a reload).
 */
export async function startLogs(device, appId, {restart = false} = {}) {
  if (!backend.logs || !device) {
    return;
  }
  if (!unsubscribe) {
    unsubscribe = backend.logs.onBatch(applyBatch);
  }
  if (!restart && state.started && state.deviceId === device.id) {
    if (state.appId !== appId) {
      publish({appId});
      await backend.logs.setApp(appId);
    }
    return;
  }
  const rules = await loadRules();
  state.entries.length = 0;
  publish({
    started: true,
    deviceId: device.id,
    appId,
    findings: new Map(),
    processes: [],
    rules,
    status: {state: 'starting'},
  });
  const status = await backend.logs.start(device, appId, rules);
  publish({status});
}

export async function stopLogs() {
  await backend.logs?.stop();
  publish({started: false, status: {state: 'stopped'}});
}

export async function clearLogs() {
  await backend.logs?.clear();
}

export async function saveRules(rules) {
  await setSetting(LOG_RULES_CONFIG, rules);
  publish({rules});
  await backend.logs?.setRules(rules);
}

export async function loadSavedRules() {
  const rules = await loadRules();
  publish({rules});
  // a running log follows the rules of the profile just turned on
  if (state.started) {
    await backend.logs?.setRules(rules);
  }
}
