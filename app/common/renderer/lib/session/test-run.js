import {useSyncExternalStore} from 'react';
import {useSelector} from 'react-redux';

import {startProblems} from '../../../shared/start-problems.js';
import {activeDevice, isDeviceRunning} from '../../actions/Workstation.js';
import {useDoctor} from '../../components/Desk/doctor-store.js';
import {backend} from '../../polyfills.js';
import {adviceFocus, useProjectAdvice} from '../settings/project-advice.js';

// The test the title bar runs: whether its recording is paused. A paused test
// lets the traffic through and the app run, but the proxy, the log and the
// measurement keep nothing until it goes on.

let state = {paused: false};
const listeners = new Set();

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTestRun = () => useSyncExternalStore(subscribe, () => state);

export async function setTestPaused(paused) {
  state = {...state, paused};
  for (const listener of listeners) {
    listener();
  }
  await Promise.all([
    backend.proxy?.setPaused?.(paused),
    backend.logs?.setPaused?.(paused),
    backend.perf?.setPaused?.(paused),
  ]);
}

/** What stands in the way of «Start session» now; nothing while a session runs. */
export function useStartProblems() {
  const workstation = useSelector((one) => one.workstation);
  const hasSession = useSelector((one) => !!one.inspector.driver);
  const {report} = useDoctor();
  const advice = useProjectAdvice();
  if (hasSession || !backend.doctor) {
    return [];
  }
  const device = activeDevice(workstation);
  return startProblems({
    device,
    running: isDeviceRunning(device),
    app: workstation.app,
    appsError: workstation.appsError,
    report,
    serverRunning: workstation.appium?.status === 'running',
    advice,
    fix: advice ? adviceFocus(advice) : null,
  });
}

/** The worst problem pointing at a part of the title bar, for its outline. */
export const problemFor = (problems, target) =>
  problems.find((one) => one.target === target && one.severity === 'error') ??
  problems.find((one) => one.target === target) ??
  null;
