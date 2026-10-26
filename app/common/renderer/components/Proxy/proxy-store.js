import {useSyncExternalStore} from 'react';

import {PROXY_CONFIG} from '../../../shared/setting-defs.js';
import {backend, getSetting, setSetting} from '../../polyfills.js';

const MAX_EXCHANGES = 3000;

export const DEFAULT_PROXY_CONFIG = {
  port: 8890,
  mockRules: [],
  trafficRules: {},
  mocksEnabled: true,
  breakpointsEnabled: true,
};

/**
 * The proxy's traffic as the screens see it. Exchanges are updated in place
 * as their responses arrive, so they are kept by id with the order apart;
 * every batch makes a new snapshot with a higher `version`.
 */
let state = {
  version: 0,
  started: false,
  starting: false,
  error: null,
  status: {running: false},
  order: [],
  byId: new Map(),
  findings: new Map(),
  pauses: [],
  config: DEFAULT_PROXY_CONFIG,
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
    state.byId = new Map(batch.exchanges.map((x) => [x.id, x]));
    state.order = batch.exchanges.map((x) => x.id);
    publish({
      findings: new Map(batch.findings.map((f) => [f.id, f])),
      status: batch.status,
      pauses: batch.pauses,
    });
    return;
  }
  for (const exchange of batch.exchanges) {
    if (!state.byId.has(exchange.id)) {
      state.order.push(exchange.id);
    }
    state.byId.set(exchange.id, exchange);
  }
  if (state.order.length > MAX_EXCHANGES) {
    for (const id of state.order.splice(0, state.order.length - MAX_EXCHANGES)) {
      state.byId.delete(id);
    }
  }
  const findings = batch.findings.length ? new Map(state.findings) : state.findings;
  for (const finding of batch.findings) {
    findings.set(finding.id, finding);
  }
  publish({findings, status: batch.status, pauses: batch.pauses});
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useProxy = () => useSyncExternalStore(subscribe, () => state);

export const proxyState = () => state;

async function pushConfig(config) {
  await backend.proxy.setMockRules(config.mockRules);
  await backend.proxy.setModes({mocksEnabled: config.mocksEnabled, breakpointsEnabled: config.breakpointsEnabled});
  await backend.proxy.setTrafficRules(config.trafficRules);
}

/**
 * Starts the proxy with the saved settings, or picks up the one the main
 * process already runs.
 */
export async function startProxy() {
  if (!backend.proxy || state.started || state.starting) {
    return;
  }
  if (!unsubscribe) {
    unsubscribe = backend.proxy.onBatch(applyBatch);
  }
  const config = {...DEFAULT_PROXY_CONFIG, ...((await getSetting(PROXY_CONFIG)) ?? {})};
  publish({starting: true, config, error: null});
  const result = await backend.proxy.start({port: config.port});
  if (!result.ok) {
    publish({starting: false, error: result.error});
    return;
  }
  await pushConfig(config);
  const snapshot = await backend.proxy.snapshot();
  applyBatch({reset: true, ...snapshot});
  publish({started: true, starting: false, status: result.status});
}

export async function stopProxy() {
  const status = await backend.proxy?.stop();
  publish({started: false, status});
}

export async function saveProxyConfig(patch) {
  const config = {...state.config, ...patch};
  await setSetting(PROXY_CONFIG, config);
  publish({config});
  await pushConfig(config);
}

export const resumePause = (pauseId, decision) => backend.proxy.resume(pauseId, decision);
export const clearTraffic = () => backend.proxy.clear();
