// Why the station cannot reach an app's data, from what the device tools
// said. The reason picks the plain words and the advice in the interface;
// the tool's own text goes under them.

export const ACCESS = {
  RUN_AS: 'run-as',
  ROOT: 'root',
  SIMULATOR: 'simulator',
  DEVICECTL: 'devicectl',
};

export const NO_ACCESS = {
  NOT_INSTALLED: 'notInstalled',
  RELEASE_BUILD: 'releaseBuild',
  EMULATOR_NO_ROOT: 'emulatorNoRoot',
  NOT_DEVELOPMENT_SIGNED: 'notDevelopmentSigned',
  DEVICE_LOCKED: 'deviceLocked',
  XCODE_TOO_OLD: 'xcodeTooOld',
  NOT_RUNNING: 'notRunning',
  FAILED: 'failed',
};

const trimmed = (text) => String(text ?? '').trim();

/** What `run-as <pkg> id -u` said: ok, or why it was refused. */
export function runAsOutcome(result) {
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  if (/unknown package|package not installed|is unknown/i.test(text)) {
    return {ok: false, reason: NO_ACCESS.NOT_INSTALLED};
  }
  if (/not debuggable/i.test(text)) {
    return {ok: false, reason: NO_ACCESS.RELEASE_BUILD};
  }
  // run-as answers with the app's uid, 10000 and above
  if (result?.ok && /^\d{5,}\s*$/.test(trimmed(result.stdout))) {
    return {ok: true};
  }
  return {ok: false, reason: NO_ACCESS.FAILED, detail: trimmed(text)};
}

/** Whether `su 0 id -u` (or a root adbd) answered as root. */
export const rootOutcome = (result) => !!result?.ok && trimmed(result.stdout) === '0';

/**
 * How to reach the data of an Android app, from the probes: run-as first,
 * then root, else why neither works.
 */
export function androidAccess({runAs, root, emulator, installed = true}) {
  if (!installed) {
    return {mode: null, reason: NO_ACCESS.NOT_INSTALLED};
  }
  const asApp = runAsOutcome(runAs);
  if (asApp.ok) {
    return {mode: ACCESS.RUN_AS, reason: null};
  }
  if (rootOutcome(root)) {
    return {mode: ACCESS.ROOT, reason: null};
  }
  if (asApp.reason === NO_ACCESS.NOT_INSTALLED) {
    return {mode: null, reason: NO_ACCESS.NOT_INSTALLED};
  }
  if (asApp.reason === NO_ACCESS.RELEASE_BUILD) {
    return {mode: null, reason: emulator ? NO_ACCESS.EMULATOR_NO_ROOT : NO_ACCESS.RELEASE_BUILD};
  }
  return {mode: null, reason: NO_ACCESS.FAILED, detail: asApp.detail};
}

/** Why `simctl get_app_container` gave no folder. */
export function simulatorProblem(result) {
  const text = trimmed(`${result?.stderr ?? ''} ${result?.stdout ?? ''}`);
  if (/No such file|not installed|could not be found|No container|Invalid argument/i.test(text)) {
    return {reason: NO_ACCESS.NOT_INSTALLED, detail: text};
  }
  if (/Unable to lookup in current state: Shutdown|not booted/i.test(text)) {
    return {reason: NO_ACCESS.NOT_RUNNING, detail: text};
  }
  return {reason: NO_ACCESS.FAILED, detail: text};
}

/** Why `devicectl` could not reach the app's container, from the error in its JSON. */
export function devicectlDataProblem(json) {
  const error = json?.error;
  if (!error) {
    return null;
  }
  const text = JSON.stringify(error);
  const detail = error.userInfo?.NSLocalizedDescription?.string ?? '';
  if (/requireContainerAccess|developer disk image|DeveloperDiskImage|PersonalizedBundleMissingVariant/i.test(text)) {
    return {reason: NO_ACCESS.XCODE_TOO_OLD, detail};
  }
  if (/locked|passcode/i.test(text)) {
    return {reason: NO_ACCESS.DEVICE_LOCKED, detail};
  }
  if (/not installed|no such app|could not be found|ApplicationNotFound|unknown bundle/i.test(text)) {
    return {reason: NO_ACCESS.NOT_INSTALLED, detail};
  }
  if (/get-task-allow|not permitted|permission|not allowed|sandbox|entitlement/i.test(text)) {
    return {reason: NO_ACCESS.NOT_DEVELOPMENT_SIGNED, detail};
  }
  return {reason: NO_ACCESS.FAILED, detail: detail || text.slice(0, 300)};
}
