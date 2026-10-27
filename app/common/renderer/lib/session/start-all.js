import {startLogs} from '../../components/Logs/logs-store.js';
import {startPerf} from '../../components/Perf/perf-store.js';
import {startProxy} from '../../components/Proxy/proxy-store.js';
import {startQuickSession} from './quick-session.js';

/**
 * Everything a test needs in one press: the station's proxy (on this Mac:
 * the device is set up for it apart), the device log, the measurement of the
 * app and the Appium session on the device and app of the title bar. The
 * session goes last: the log and the measurement see the app from its start.
 * Returns what `startQuickSession` does.
 */
export async function startEverything({dispatch, device, app, appium, onStage = () => {}}) {
  onStage('tools');
  await Promise.all([
    startProxy().catch(() => null),
    startLogs(device, app?.id ?? null).catch(() => null),
    // a real iPhone has no measurement yet; without an app there is nothing to measure
    app?.id && device.kind !== 'ios-device' ? startPerf(device, app.id, {markScreen: false}).catch(() => null) : null,
  ]);
  return await startQuickSession({dispatch, device, app, appium, onStage});
}
