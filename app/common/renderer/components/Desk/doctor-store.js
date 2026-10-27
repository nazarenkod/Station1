import {useSyncExternalStore} from 'react';

import {backend} from '../../polyfills.js';

// The environment report of the doctor, read once a run of the app and again
// on request: the «Station» tab shows it, and the tab's badge counts its
// problems even before the tab is opened.

let state = {report: null, loading: false};
const listeners = new Set();

const publish = (patch) => {
  state = {...state, ...patch};
  for (const listener of listeners) {
    listener();
  }
};

export const useDoctor = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );

/** Runs the checks; the shell commands behind them take a while, so it is done once unless asked. */
export async function loadDoctor({again = false} = {}) {
  if (!backend.doctor || state.loading || (state.report && !again)) {
    return;
  }
  publish({loading: true});
  try {
    const [environment, jira, gitlab] = await Promise.all([
      backend.doctor.environment(),
      backend.jira?.hasToken().catch(() => false) ?? false,
      backend.gitlab?.hasToken().catch(() => false) ?? false,
    ]);
    publish({report: {...environment, integrations: {jira, gitlab}}, loading: false});
  } catch (error) {
    // a failed check shows as a row, not as a list that never loads
    publish({
      report: {checks: [{id: 'doctorFailed', status: 'error', params: {detail: error?.message ?? String(error)}}]},
      loading: false,
    });
  }
}

/** How the Appium server stands, as a row of the doctor: running or starting is fine. */
export const serverStatusOf = (appium) =>
  appium?.status === 'running' || appium?.status === 'starting' ? 'ok' : appium?.status === 'failed' ? 'error' : 'warn';

/** How many rows want attention, as the doctor counts them: warnings and errors, the server included. */
export const doctorProblems = (report, appium) =>
  (report?.checks ?? []).filter((check) => check.status === 'warn' || check.status === 'error').length +
  (serverStatusOf(appium) === 'ok' ? 0 : 1);
