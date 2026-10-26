import {useSyncExternalStore} from 'react';

import {
  A11Y_CONFIG,
  A11Y_ISSUE_STATES,
  BUILD_JOBS,
  LOG_RULES_CONFIG,
  LOGS_VIEW,
  PREFERRED_LANGUAGE,
  PROXY_CONFIG,
  PROXY_VIEW,
} from '../../../shared/setting-defs.js';
import {loadA11ySettings} from '../../actions/A11y.js';
import {loadBuildSources} from '../../components/Builds/pipeline-watch.js';
import {loadSavedRules} from '../../components/Logs/logs-store.js';
import {reloadProxyConfig} from '../../components/Proxy/proxy-store.js';
import i18n from '../../i18next.js';
import {backend, getSetting, updateLanguage} from '../../polyfills.js';
import {logsView, proxyView} from './views.js';

/**
 * The project profiles as the screens see them: names, apps and which one is
 * on. The settings themselves are switched by the main process; this store
 * makes every tool read its settings again when they change.
 */
let state = {loaded: false, activeId: null, list: []};
const listeners = new Set();
let started = false;

const publish = (patch) => {
  state = {...state, ...patch};
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useProfiles = () => useSyncExternalStore(subscribe, () => state);

export const profilesState = () => state;

// what each tool reads again when one of its keys changed
async function reloadTools(keys, reduxStore) {
  const has = (...wanted) => wanted.some((key) => keys.includes(key));
  const work = [];
  if (has(PROXY_CONFIG)) {
    work.push(reloadProxyConfig());
  }
  if (has(LOG_RULES_CONFIG)) {
    work.push(loadSavedRules());
  }
  if (has(A11Y_CONFIG, A11Y_ISSUE_STATES)) {
    work.push(reduxStore?.dispatch(loadA11ySettings()));
  }
  if (has(BUILD_JOBS)) {
    work.push(loadBuildSources());
  }
  if (has(PROXY_VIEW)) {
    work.push(proxyView.reload());
  }
  if (has(LOGS_VIEW)) {
    work.push(logsView.reload());
  }
  if (has(PREFERRED_LANGUAGE)) {
    const language = await getSetting(PREFERRED_LANGUAGE);
    if (language && language !== i18n.language) {
      await i18n.changeLanguage(language);
      updateLanguage(language);
    }
  }
  await Promise.all(work);
}

/**
 * Loads the profiles and follows their changes. Called once by the shell.
 */
export async function startProfiles(reduxStore) {
  if (!backend.settings || started) {
    return;
  }
  started = true;
  backend.settings.onChanged(({profiles, keys}) => {
    publish(profiles);
    reloadTools(keys, reduxStore);
  });
  publish({loaded: true, ...(await backend.settings.profiles())});
}

// a filter changed a moment ago is written before the main process reads the settings
const flushViews = () => Promise.all([proxyView.flush(), logsView.flush()]);

export async function switchProfile(id) {
  if (id === state.activeId) {
    return;
  }
  await flushViews();
  await backend.settings.switchProfile(id);
}

export async function addProfile(name, {copy = false, open = true} = {}) {
  await flushViews();
  const result = await backend.settings.addProfile(name, {copy});
  if (open && result?.id) {
    await backend.settings.switchProfile(result.id);
  }
  return result;
}

export const renameProfile = (id, name) => backend.settings.renameProfile(id, name);
export const setProfileApps = (id, apps) => backend.settings.setProfileApps(id, apps);

export async function removeProfile(id) {
  await flushViews();
  return await backend.settings.removeProfile(id);
}

export async function exportSettings(options) {
  await flushViews();
  return await backend.settings.exportFile(options);
}

export async function pickImport() {
  await flushViews();
  return await backend.settings.pickImport();
}

export const applyImport = (choice) => backend.settings.applyImport(choice);
export const listBackups = () => backend.settings.backups();
export const restoreBackup = (file) => backend.settings.restore(file);

/** The profile an app belongs to, when it is not the one that is on. */
export const profileForApp = (appId) => backend.settings?.profileForApp(appId) ?? null;
