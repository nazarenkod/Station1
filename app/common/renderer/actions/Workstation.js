import {WORKSTATION} from '../../shared/setting-defs.js';
import {backend, getSetting, setSetting} from '../polyfills.js';
import {log} from '../utils/logger.js';

export const SET_WORKSTATION_DEVICES = 'SET_WORKSTATION_DEVICES';
export const SET_WORKSTATION_DEVICES_LOADING = 'SET_WORKSTATION_DEVICES_LOADING';
export const SET_WORKSTATION_DEVICE = 'SET_WORKSTATION_DEVICE';
export const SET_WORKSTATION_APPS = 'SET_WORKSTATION_APPS';
export const SET_WORKSTATION_APP = 'SET_WORKSTATION_APP';
export const SET_WORKSTATION_APPIUM = 'SET_WORKSTATION_APPIUM';
export const SET_WORKSTATION_MY_BUGS = 'SET_WORKSTATION_MY_BUGS';
export const RESTORE_WORKSTATION = 'RESTORE_WORKSTATION';

const MAX_RECENT_APPS = 8;

/**
 * A device the tools can work with right now: connected and booted.
 */
export const isDeviceRunning = (device) => device?.state === 'running';

export const activeDevice = (workstation) =>
  workstation.devices.find((device) => device.id === workstation.deviceId) ?? null;

async function persist(getState) {
  const {deviceId, app, recentApps} = getState().workstation;
  await setSetting(WORKSTATION, {deviceId, app, recentApps});
}

/**
 * Restores the device and app chosen last time, then looks at what is
 * connected and whether our Appium server runs. Called once by the shell.
 */
export function initWorkstation() {
  return async (dispatch) => {
    const saved = (await getSetting(WORKSTATION)) ?? {};
    dispatch({
      type: RESTORE_WORKSTATION,
      deviceId: saved.deviceId ?? null,
      app: saved.app ?? null,
      recentApps: saved.recentApps ?? [],
    });
    if (!backend.doctor) {
      return;
    }
    const appium = await backend.doctor.getServer();
    dispatch({type: SET_WORKSTATION_APPIUM, appium: appium.state});
    backend.doctor.onServerState((state) => dispatch({type: SET_WORKSTATION_APPIUM, appium: state}));
    // Appium comes up on its own in the background; devices do not wait for it
    dispatch(ensureAppium());
    await dispatch(refreshDevices());
    dispatch(watchDevices());
  };
}

export const APPIUM_PORT = 4723;

/**
 * Makes sure an Appium server runs on this machine: one already running (the
 * person's own, from a terminal) is used as it is; otherwise the app starts
 * its own. Its state then arrives through the doctor's server events.
 */
export function ensureAppium() {
  return async (dispatch, getState) => {
    const doctor = backend.doctor;
    if (!doctor?.managedServer) {
      return;
    }
    if (['running', 'starting', 'installing'].includes(getState().workstation.appium?.status)) {
      return;
    }
    const servers = await doctor.servers().catch(() => []);
    const running = servers.find((server) => server.port === APPIUM_PORT) ?? servers[0];
    if (running) {
      dispatch({
        type: SET_WORKSTATION_APPIUM,
        appium: {status: 'running', port: running.port, version: running.version, external: true},
      });
      return;
    }
    await doctor.startServer({port: APPIUM_PORT});
  };
}

export function refreshDevices({quiet = false} = {}) {
  return async (dispatch, getState) => {
    if (!backend.doctor || getState().workstation.devicesLoading) {
      return;
    }
    const before = activeDevice(getState().workstation);
    dispatch({type: SET_WORKSTATION_DEVICES_LOADING, loading: true, quiet});
    try {
      const {devices} = await backend.doctor.devices();
      dispatch({type: SET_WORKSTATION_DEVICES, devices});
      const {deviceId} = getState().workstation;
      // the doctor lists what can be used now first, real phones before emulators
      const running = devices.filter(isDeviceRunning);
      // keep the chosen device while it is connected, otherwise take the first one that runs
      if (!running.some((device) => device.id === deviceId) && running.length) {
        await dispatch(selectDevice(running[0].id));
      } else if (!quiet || (!isDeviceRunning(before) && isDeviceRunning(activeDevice(getState().workstation)))) {
        // a quiet poll reads the apps again only when the device has just come up
        await dispatch(refreshApps());
      }
    } catch (error) {
      log.error(error);
      dispatch({type: SET_WORKSTATION_DEVICES_LOADING, loading: false});
    }
  };
}

const DEVICE_POLL_MS = 10000;
let devicePoll = null;

/**
 * Looks for plugged and unplugged devices in the background while the window
 * is in front, so a phone on the cable shows up without a click.
 */
export function watchDevices() {
  return (dispatch) => {
    if (devicePoll || !backend.doctor) {
      return;
    }
    devicePoll = setInterval(() => {
      if (!document.hidden) {
        dispatch(refreshDevices({quiet: true}));
      }
    }, DEVICE_POLL_MS);
  };
}

export function selectDevice(deviceId) {
  return async (dispatch, getState) => {
    dispatch({type: SET_WORKSTATION_DEVICE, deviceId});
    await persist(getState);
    await dispatch(refreshApps());
  };
}

/**
 * The apps installed on the active device. When no app is chosen yet, the one
 * on screen becomes the active app.
 */
export function refreshApps() {
  return async (dispatch, getState) => {
    const device = activeDevice(getState().workstation);
    if (!backend.device || !isDeviceRunning(device)) {
      dispatch({type: SET_WORKSTATION_APPS, apps: [], loading: false, error: null});
      return;
    }
    dispatch({
      type: SET_WORKSTATION_APPS,
      apps: getState().workstation.apps,
      loading: true,
      error: getState().workstation.appsError,
    });
    const [listed, onScreen] = await Promise.all([
      backend.device.apps(device).catch((error) => ({apps: [], error: {reason: 'failed', message: error.message}})),
      getState().workstation.app ? null : backend.device.foreground(device).catch(() => null),
    ]);
    dispatch({type: SET_WORKSTATION_APPS, apps: listed.apps, loading: false, error: listed.error});
    if (onScreen && !getState().workstation.app) {
      await dispatch(selectApp(onScreen));
    } else {
      await dispatch(refreshAppVersion());
    }
  };
}

export function selectApp(appId, known = null) {
  return async (dispatch, getState) => {
    const id = appId?.trim();
    if (!id) {
      dispatch({type: SET_WORKSTATION_APP, app: null, recentApps: getState().workstation.recentApps});
      await persist(getState);
      return;
    }
    const {apps, recentApps} = getState().workstation;
    const listed = known ?? apps.find((app) => app.id === id);
    const app = {id, name: listed?.name ?? id, version: listed?.version ?? '', build: listed?.build ?? ''};
    const recent = [app, ...recentApps.filter((entry) => entry.id !== id)].slice(0, MAX_RECENT_APPS);
    dispatch({type: SET_WORKSTATION_APP, app, recentApps: recent});
    await persist(getState);
    await dispatch(refreshAppVersion());
  };
}

/**
 * Reads which version of the active app the device has; empty when it is not
 * installed there.
 */
export function refreshAppVersion() {
  return async (dispatch, getState) => {
    const {app, recentApps} = getState().workstation;
    const device = activeDevice(getState().workstation);
    if (!app || !backend.device || !isDeviceRunning(device)) {
      return;
    }
    const installed = await backend.device.appVersion(device, app.id).catch(() => null);
    // some devices do not report a version (simulators for some bundles): keep the one we know
    const updated = installed
      ? {...app, installed: true, version: installed.version || app.version, build: installed.build || app.build}
      : {...app, installed: false, version: '', build: ''};
    dispatch({type: SET_WORKSTATION_APP, app: updated, recentApps});
  };
}

/**
 * The latest bugs the Jira account reported; quiet when Jira is not set up.
 */
export function loadMyBugs() {
  return async (dispatch) => {
    if (!backend.jira) {
      dispatch({type: SET_WORKSTATION_MY_BUGS, myBugs: {status: 'unavailable', issues: []}});
      return;
    }
    if (!(await backend.jira.hasToken())) {
      dispatch({type: SET_WORKSTATION_MY_BUGS, myBugs: {status: 'off', issues: []}});
      return;
    }
    dispatch({type: SET_WORKSTATION_MY_BUGS, myBugs: {status: 'loading', issues: []}});
    const result = await backend.jira.mine();
    dispatch({
      type: SET_WORKSTATION_MY_BUGS,
      myBugs: result.ok ? {status: 'ok', issues: result.issues} : {status: 'error', issues: [], error: result.error},
    });
  };
}
