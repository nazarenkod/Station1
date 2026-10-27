// What stands in the way of «Start session», before it is pressed: the
// title bar lights up the device or the project picker, and the button says
// what to set up. An error stops the start; a warning lets it go (a session
// with no app opens on the screen the device shows).

const NOT_READY = ['warn', 'error'];

const isIos = (device) => /ios/i.test(device?.platformName ?? '');

// the driver Appium needs for the device's platform
const driverFor = (device) => (isIos(device) ? 'xcuitest' : 'uiautomator2');

/**
 * @param {object} input
 * @param {object | null} input.device the active device
 * @param {boolean} input.running whether it is connected or booted
 * @param {object | null} input.app the app of the project for the device
 * @param {object | null} [input.appsError] why the apps of the device could not be read
 * @param {object | null} [input.report] the doctor's report
 * @param {boolean} [input.serverRunning] an Appium server already runs: its own drivers count, not the doctor's
 * @param {object | null} [input.advice] what is wrong with the project for this device (project.platforms)
 * @param {object | null} [input.fix] where the settings open to fix the advice
 * @returns {{key: string, severity: 'error' | 'warn', target: 'device' | 'app' | 'station', params?: object}[]}
 */
export function startProblems({
  device,
  running,
  app,
  appsError = null,
  report = null,
  serverRunning = false,
  advice = null,
  fix = null,
}) {
  if (!device) {
    return [{key: 'noDevice', severity: 'error', target: 'device'}];
  }
  const problems = [];
  if (!running) {
    problems.push({key: 'deviceOff', severity: 'error', target: 'device', params: {device: device.name}});
  }
  if (appsError) {
    problems.push({key: 'appsError', severity: 'warn', target: 'device'});
  }
  // the same advice as every tool gives, with the way straight to its field
  if (advice?.kind === 'noPlatform') {
    problems.push({key: 'noPlatform', severity: 'warn', target: 'app', params: advice, fix});
  } else if (advice?.kind === 'noApp') {
    problems.push({key: 'noAppFor', severity: 'warn', target: 'app', params: advice, fix});
  } else if (!app) {
    problems.push({key: 'noApp', severity: 'warn', target: 'app'});
  } else if (app.installed === false) {
    problems.push({key: 'appMissing', severity: 'error', target: 'app', params: {app: app.id}});
  }
  const checks = report?.checks ?? [];
  if (!serverRunning && checks.some((check) => check.id === 'appiumMissing')) {
    problems.push({key: 'appiumMissing', severity: 'error', target: 'station'});
  }
  const driver = checks.find((check) => check.id === 'driver' && check.params?.driver === driverFor(device));
  if (!serverRunning && driver && NOT_READY.includes(driver.status)) {
    problems.push({key: 'driver', severity: 'error', target: 'station', params: {driver: driverFor(device)}});
  }
  const tool = checks.find((check) => check.id === (isIos(device) ? 'xcode' : 'adb'));
  if (tool?.status === 'error') {
    problems.push({key: isIos(device) ? 'xcode' : 'adb', severity: 'error', target: 'station'});
  }
  return problems;
}

/** Whether the start can go: no error among the problems. */
export const canStart = (problems) => !problems.some((problem) => problem.severity === 'error');
