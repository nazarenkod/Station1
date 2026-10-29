import {useSyncExternalStore} from 'react';

import {screenHistory} from '../../components/A11yTool/screen-history.js';

// «Summary for autotests»: the screens of a session as they were when it
// ended (or when the person opened the summary), kept apart from the screen
// history, which a new session starts over. Outside Redux: the states carry
// their trees and screenshots.

let state = {open: false, flow: null, context: null};
// the flow already offered when a session ended, so the same one is not offered twice
let offered = null;
const listeners = new Set();

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

export const useAutotestsSummary = () => useSyncExternalStore(subscribe, () => state);

const hasNamed = (flow) => flow.screens.some((screen) => screen.named && screen.states.length);

/**
 * Opens the summary on the screens the session went through. `context` is
 * what the package keeps of where they came from: platform, device, app.
 */
export function openSummary(context) {
  const {screens, path} = screenHistory();
  const flow = {screens, path};
  offered = screens;
  publish({open: true, flow, context});
}

/** The session ended: the summary opens by itself, once for the same screens. */
export function offerSummary(context) {
  const {screens} = screenHistory();
  if (screens === offered || !hasNamed({screens})) {
    return;
  }
  openSummary(context);
}

export function closeSummary() {
  publish({open: false, flow: null});
}

/** Where the screens come from, from the station's state: platform, device, app. */
export function summaryContext(store) {
  const {workstation, inspector} = store;
  const device = workstation?.devices?.find((one) => one.id === workstation.deviceId) ?? null;
  const automation = String(inspector?.sessionCaps?.automationName ?? inspector?.sessionCaps?.platformName ?? '');
  const platform = device?.platformName?.toLowerCase() ?? (/xcuitest|ios/i.test(automation) ? 'ios' : 'android');
  return {
    platform: platform === 'ios' ? 'ios' : 'android',
    device: device ? {name: device.name ?? device.id} : null,
    app: workstation?.app ? {id: workstation.app.id, version: workstation.app.version || null} : null,
  };
}
