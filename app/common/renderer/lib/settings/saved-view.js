import {useSyncExternalStore} from 'react';

import {DEFAULT_SETTINGS} from '../../../shared/setting-defs.js';
import {getSetting, setSetting} from '../../polyfills.js';

const SAVE_DELAY_MS = 400;

/**
 * How a tool was left (its filters), kept in a setting of the profile, so it
 * is the same after a restart. Reads once, writes a moment after the last
 * change, and reads again when another profile is turned on.
 */
export function createSavedView(settingKey) {
  const defaults = DEFAULT_SETTINGS[settingKey];
  let view = defaults;
  let loaded = null;
  let timer = null;
  const listeners = new Set();

  const publish = (next) => {
    view = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const reload = async () => {
    clearTimeout(timer);
    timer = null;
    publish({...defaults, ...((await getSetting(settingKey)) ?? {})});
  };

  const load = () => {
    loaded ??= reload();
    return loaded;
  };

  // writes a change still waiting, before the profile is switched or exported
  const flush = async () => {
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    timer = null;
    await setSetting(settingKey, view);
  };

  const update = (patch) => {
    publish({...view, ...(typeof patch === 'function' ? patch(view) : patch)});
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    load();
    return () => listeners.delete(listener);
  };

  return {
    get: () => view,
    load,
    reload,
    flush,
    update,
    use: () => useSyncExternalStore(subscribe, () => view),
  };
}
