import {DEFAULT_SETTINGS, TEST_START} from '../../../shared/setting-defs.js';
import {startLogs} from '../../components/Logs/logs-store.js';
import {startPerf} from '../../components/Perf/perf-store.js';
import {startProxy} from '../../components/Proxy/proxy-store.js';
import {getSetting} from '../../polyfills.js';
import {startQuickSession} from './quick-session.js';

/**
 * A test in one press: the Appium session on the device and app of the
 * title bar and, as the person chose, the station's proxy (on this Mac: the
 * device is set up for it apart), the device log and the measurement of the
 * app. The session goes last: the log and the measurement see the app from
 * its start. Returns what `startQuickSession` does.
 */
export async function startEverything({dispatch, device, app, appium, decide, onStage = () => {}}) {
  const tools = {...DEFAULT_SETTINGS[TEST_START], ...((await getSetting(TEST_START)) ?? {})};
  onStage('tools');
  await Promise.all([
    tools.proxy ? startProxy().catch(() => null) : null,
    tools.logs ? startLogs(device, app?.id ?? null).catch(() => null) : null,
    // a real iPhone has no measurement yet; without an app there is nothing to measure
    tools.perf && app?.id && device.kind !== 'ios-device'
      ? startPerf(device, app.id, {markScreen: false}).catch(() => null)
      : null,
  ]);
  return await startQuickSession({dispatch, device, app, appium, decide, onStage});
}
