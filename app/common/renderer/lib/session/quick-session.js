import {pickSigningTeam, wdaSigningCapabilities} from '../../../shared/ios/signing.js';
import {IOS_SIGNING} from '../../../shared/setting-defs.js';
import {backend, getSetting} from '../../polyfills.js';
import {getRandomId} from '../../utils/other.js';

export const DEFAULT_PORT = 4723;

const isIos = (device) => /ios/i.test(device?.platformName ?? '');

/**
 * How WebDriverAgent gets signed for a real iPhone, or why it cannot be:
 * the team chosen in the settings, else the only one this Mac has.
 */
async function iosSigning() {
  const saved = (await getSetting(IOS_SIGNING)) ?? {};
  const teams = (await backend.device?.signingTeams?.().catch(() => [])) ?? [];
  const team = pickSigningTeam(teams, saved.teamId);
  if (!team) {
    return {problem: teams.length ? 'quickSigningPickTeam' : 'quickSigningNoTeam', count: teams.length};
  }
  return {caps: wdaSigningCapabilities({teamId: team.teamId, bundleId: saved.bundleId})};
}

/**
 * Ends the sessions our own Appium server still holds on this device: left by
 * a window closed or reloaded mid-session, they keep WebDriverAgent or
 * UiAutomator2 busy and the new session hangs on it.
 */
export async function endSessionsOnDevice(port, udid) {
  const base = `http://127.0.0.1:${port}`;
  try {
    const listed = await (await fetch(`${base}/appium/sessions`, {signal: AbortSignal.timeout(5000)})).json();
    const stale = (listed.value ?? []).filter((session) => session.capabilities?.udid === udid);
    await Promise.all(
      stale.map((session) =>
        fetch(`${base}/session/${session.id}`, {method: 'DELETE', signal: AbortSignal.timeout(30000)}).catch(
          () => null,
        ),
      ),
    );
    return stale.length;
  } catch {
    // an older server without the list, or one that does not answer: start as before
    return 0;
  }
}

/**
 * Capabilities for the device and app picked in the title bar.
 */
export function quickCapabilities(device, app, {keepData, signing = null}) {
  // what the device's own capabilities say about signing wins over what was found
  const caps = {...signing, ...device.capabilities};
  if (app?.id) {
    caps[isIos(device) ? 'appium:bundleId' : 'appium:appPackage'] = app.id;
    // apps that launch through an activity alias (a switchable icon) open another activity than
    // the one Appium resolves, which it would wait for in vain: any activity of the app will do
    if (!isIos(device) && !caps['appium:appWaitActivity']) {
      caps['appium:appWaitActivity'] = '*';
    }
  }
  caps['appium:noReset'] = keepData;
  return caps;
}

export const toCapList = (caps) =>
  Object.entries(caps).map(([name, value]) => ({
    id: getRandomId(),
    type: typeof value === 'boolean' ? 'boolean' : 'text',
    enabled: true,
    name,
    value,
  }));

/**
 * A session in one press: the device and app from the title bar, our own
 * Appium server (started if it is not running), capabilities written for
 * you. `open` starts the session from the capability list (the Session
 * Builder also goes to the Inspector); `onStage` says what is going on.
 * Returns `{error}` with a text key and its values when it could not start;
 * a session that Appium refused is shown by `newSession` itself.
 */
export async function startQuickSession({
  dispatch,
  device,
  app,
  appium,
  keepData = true,
  open = null,
  onStage = () => {},
}) {
  // the session actions pull in the whole builder: loaded only when a session starts
  const {applyLocalServer, newSession} = await import('../../actions/SessionBuilder.js');
  open ??= async (caps) => await dispatch(newSession(caps));
  // Appium would only fail to find the app's activity or bundle: say what is wrong instead
  if (app?.installed === false) {
    return {error: {key: 'quickAppMissing', params: {app: app.id, device: device.name}}};
  }
  let signing = null;
  if (device.kind === 'ios-device') {
    const found = await iosSigning();
    if (found.problem) {
      return {error: {key: found.problem, params: {count: found.count}, settings: true}};
    }
    signing = found.caps;
  }
  let port = appium?.status === 'running' ? appium.port : null;
  if (!port) {
    onStage('server');
    const result = await backend.doctor.startServer({port: DEFAULT_PORT});
    if (result.status !== 'running') {
      const [reason, detail] = (result.error ?? 'failed').split(':');
      return {
        error: {
          key: `doctorServerError_${reason}`,
          params: {port: DEFAULT_PORT, detail, defaultValue: result.error ?? reason},
        },
      };
    }
    port = DEFAULT_PORT;
  }
  await dispatch(applyLocalServer({hostname: '127.0.0.1', port, path: ''}));
  onStage('session');
  // only on our own server: one we found running may be in the middle of someone's test run
  const udid = device.capabilities?.['appium:udid'];
  if (udid && !appium?.external) {
    await endSessionsOnDevice(port, udid);
  }
  const started = await open(toCapList(quickCapabilities(device, app, {keepData, signing})));
  return started === false ? {error: null, refused: true} : {};
}
