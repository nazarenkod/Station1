import {bootDevice, listDevices} from './doctor/devices.js';
import {checkEnvironment, runDriverDoctor} from './doctor/environment.js';
import {DEFAULT_SCAN_PORTS, deleteSession, scanServers} from './doctor/servers.js';
import {applyStress, restoreStress} from './doctor/stress.js';

const API_ROOT = '/inspector/api';

const handle = (run) => async (req, res) => {
  try {
    res.json(await run(req));
  } catch (error) {
    res.status(500).json({error: error.message});
  }
};

/**
 * The doctor on the Appium server's own machine, where the devices are, for
 * the Inspector served by the plugin. No own Appium here: this one is running.
 * Jira and AI stay in the desktop app, which keeps credentials in the keychain.
 */
export function registerRoutes(expressApp, {port} = {}) {
  // the server the plugin runs in is listed too, whatever its port
  const ports = [...new Set([...(port ? [Number(port)] : []), ...DEFAULT_SCAN_PORTS])];
  expressApp.get(`${API_ROOT}/capabilities`, (_req, res) =>
    res.json({doctor: true, stress: true, managedServer: false, jira: false, ai: false}),
  );
  expressApp.get(
    `${API_ROOT}/doctor/servers`,
    handle(() => scanServers({ports})),
  );
  expressApp.post(
    `${API_ROOT}/doctor/delete-session`,
    handle((req) => deleteSession(req.body.server, req.body.sessionId)),
  );
  expressApp.get(
    `${API_ROOT}/doctor/devices`,
    handle(() => listDevices()),
  );
  expressApp.post(
    `${API_ROOT}/doctor/boot`,
    handle((req) => bootDevice(req.body.device)),
  );
  expressApp.get(
    `${API_ROOT}/doctor/environment`,
    handle(() => checkEnvironment()),
  );
  expressApp.get(
    `${API_ROOT}/doctor/driver-doctor/:driver`,
    handle((req) => runDriverDoctor(req.params.driver)),
  );
  expressApp.post(
    `${API_ROOT}/doctor/stress`,
    handle((req) => applyStress(req.body.device, req.body.mode)),
  );
  expressApp.post(
    `${API_ROOT}/doctor/stress/restore`,
    handle((req) => restoreStress(req.body.device, req.body.mode, req.body.previous)),
  );
}
