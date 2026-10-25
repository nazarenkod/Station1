import {A11Y_CONFIG, A11Y_ISSUE_STATES} from '../../shared/setting-defs.js';
import i18n from '../i18next.js';
import {mergeConfig} from '../lib/a11y/config';
import {forgetDecision, importDecisions, recordDecision} from '../lib/a11y/issues';
import {scanScreen} from '../lib/a11y/rules';
import {identifyScreen} from '../lib/a11y/screen';
import {parseUiTree} from '../lib/a11y/ui-tree';
import {backend, getSetting, setSetting} from '../polyfills.js';
import {log} from '../utils/logger.js';
import {notification} from '../utils/notification.js';
import {applyClientMethod} from './SessionInspector.js';

export const A11Y_SCAN_REQUESTED = 'A11Y_SCAN_REQUESTED';
export const A11Y_SCAN_DONE = 'A11Y_SCAN_DONE';
export const A11Y_SCAN_FAILED = 'A11Y_SCAN_FAILED';
export const SET_A11Y_HIGHLIGHT = 'SET_A11Y_HIGHLIGHT';
export const SET_A11Y_OVERLAY = 'SET_A11Y_OVERLAY';
export const SET_A11Y_CONFIG = 'SET_A11Y_CONFIG';
export const SET_A11Y_ISSUES = 'SET_A11Y_ISSUES';
export const SET_A11Y_FILTER = 'SET_A11Y_FILTER';
export const SET_A11Y_STRESS = 'SET_A11Y_STRESS';

// time for the app to redraw after a theme, font or orientation change
const STRESS_SETTLE_MS = 2000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The screenshot as RGBA pixels, which the contrast rules read.
 */
async function decodeScreenshot(base64Png) {
  const blob = await (await fetch(`data:image/png;base64,${base64Png}`)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.drawImage(bitmap, 0, 0);
  const {data} = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return {width: canvas.width, height: canvas.height, data};
}

const tryScript = async (driver, script) => {
  try {
    return await driver.executeScript(script, []);
  } catch {
    return null;
  }
};

/**
 * What the rules need from the device besides the source: the app, the
 * current Android activity and the screen density.
 */
async function readDeviceInfo(driver, sessionCaps, isAndroid, cachedDensity) {
  if (isAndroid) {
    const [deviceInfo, activity, appPackage] = await Promise.all([
      cachedDensity ? null : tryScript(driver, 'mobile: deviceInfo'),
      tryScript(driver, 'mobile: getCurrentActivity'),
      tryScript(driver, 'mobile: getCurrentPackage'),
    ]);
    return {
      densityDpi: cachedDensity ?? deviceInfo?.displayDensity ?? null,
      activity: activity ?? null,
      appId: appPackage ?? sessionCaps['appium:appPackage'] ?? sessionCaps.appPackage ?? 'android',
    };
  }
  const appInfo = await tryScript(driver, 'mobile: activeAppInfo');
  return {
    densityDpi: null,
    activity: null,
    appId: appInfo?.bundleId ?? sessionCaps['appium:bundleId'] ?? sessionCaps.bundleId ?? 'ios',
  };
}

export function loadA11ySettings() {
  return async (dispatch) => {
    const [config, issues] = await Promise.all([getSetting(A11Y_CONFIG), getSetting(A11Y_ISSUE_STATES)]);
    dispatch({type: SET_A11Y_CONFIG, config: mergeConfig(config)});
    dispatch({type: SET_A11Y_ISSUES, issues: issues ?? {}});
  };
}

/**
 * Checks the screen shown in the inspector against the accessibility rules.
 */
export function runA11yScan({force = false} = {}) {
  return async (dispatch, getState) => {
    const {sourceXML, screenshot, driver, sessionCaps, a11yConfig, a11yDevice, a11yInput} = getState().inspector;
    if (!sourceXML || !driver) {
      return;
    }
    // the same source and screenshot were already checked
    if (!force && a11yInput?.sourceXML === sourceXML && a11yInput?.screenshot === screenshot) {
      return;
    }
    dispatch({type: A11Y_SCAN_REQUESTED, input: {sourceXML, screenshot}});
    try {
      const isAndroid = /hierarchy|class="android\./.test(sourceXML.slice(0, 4096));
      const [image, device] = await Promise.all([
        screenshot ? decodeScreenshot(screenshot) : null,
        readDeviceInfo(driver, sessionCaps ?? {}, isAndroid, a11yDevice?.densityDpi),
      ]);
      const config = a11yConfig ?? mergeConfig(null);
      const tree = parseUiTree(sourceXML, {
        imageWidth: image?.width ?? 0,
        imageHeight: image?.height ?? 0,
        densityDpi: device.densityDpi ?? undefined,
        activity: device.activity ?? undefined,
      });
      const scan = scanScreen(tree, image ?? undefined, config);
      const screen = identifyScreen(tree, {titleTag: config.patterns.screenTitleTag, activity: device.activity});
      dispatch({
        type: A11Y_SCAN_DONE,
        scan: {...scan, scale: tree.scale, imageWidth: image?.width ?? 0, imageHeight: image?.height ?? 0},
        screen,
        device,
        scannedAt: Date.now(),
      });
    } catch (error) {
      log.error(error);
      dispatch({type: A11Y_SCAN_FAILED, error: error.message});
    }
  };
}

export function setA11yHighlight(violationId) {
  return (dispatch) => dispatch({type: SET_A11Y_HIGHLIGHT, violationId});
}

export function setA11yOverlay(patch) {
  return (dispatch) => dispatch({type: SET_A11Y_OVERLAY, patch});
}

export function setA11yFilter(patch) {
  return (dispatch) => dispatch({type: SET_A11Y_FILTER, patch});
}

export function saveA11yConfig(config) {
  return async (dispatch) => {
    const merged = mergeConfig(config);
    await setSetting(A11Y_CONFIG, merged);
    dispatch({type: SET_A11Y_CONFIG, config: merged});
    await dispatch(runA11yScan({force: true}));
  };
}

const storeIssues = (issues) => async (dispatch) => {
  await setSetting(A11Y_ISSUE_STATES, issues);
  dispatch({type: SET_A11Y_ISSUES, issues});
};

/**
 * Remembers what was decided about an issue on this screen: filed as a bug or ignored.
 */
export function recordA11yDecision(violation, decision) {
  return async (dispatch, getState) => {
    const {a11yIssues, a11yScreen, a11yDevice} = getState().inspector;
    const issues = recordDecision(a11yIssues ?? {}, {
      appId: a11yDevice.appId,
      screenKey: a11yScreen.key,
      screenTitle: a11yScreen.title,
      violationId: violation.id,
      rule: violation.rule,
      element: violation.details?.element ?? violation.className,
      ...decision,
    });
    await dispatch(storeIssues(issues));
  };
}

export function forgetA11yDecision(violationId) {
  return async (dispatch, getState) => {
    const {a11yIssues, a11yScreen, a11yDevice} = getState().inspector;
    await dispatch(storeIssues(forgetDecision(a11yIssues ?? {}, a11yDevice.appId, a11yScreen.key, violationId)));
  };
}

export function importA11yDecisions(imported) {
  return async (dispatch, getState) => {
    await dispatch(storeIssues(importDecisions(getState().inspector.a11yIssues ?? {}, imported)));
  };
}

const deviceOf = (sessionCaps, sourceXML) => ({
  platform: /hierarchy|class="android\./.test(sourceXML.slice(0, 4096)) ? 'android' : 'ios',
  udid: sessionCaps['appium:udid'] ?? sessionCaps.udid ?? sessionCaps.deviceUDID ?? null,
});

const refreshAndScan = async (dispatch) => {
  await dispatch(applyClientMethod({methodName: 'getPageSource'}));
  await dispatch(runA11yScan({force: true}));
};

/**
 * Puts the device under stress (dark theme, largest font, landscape), checks
 * the screen again and keeps the issues that only show up under it marked.
 */
export function startA11yStress(mode) {
  return async (dispatch, getState) => {
    const {driver, sessionCaps, sourceXML, a11yScan, a11yStress} = getState().inspector;
    if (a11yStress) {
      await dispatch(endA11yStress());
    }
    const baselineIds = (a11yScan?.violations ?? []).map((v) => v.id);
    const modeName = i18n.t(`a11yStress_${mode}`);
    const device = deviceOf(sessionCaps ?? {}, sourceXML ?? '');
    notification.info({title: i18n.t('a11yStressRunning', {mode: modeName}), duration: 2});

    let previous;
    if (mode === 'landscape') {
      previous = await driver.getOrientation();
      await driver.setOrientation('LANDSCAPE');
      await delay(STRESS_SETTLE_MS);
      if ((await driver.getOrientation()) !== 'LANDSCAPE') {
        notification.warning({title: i18n.t('a11yStressLocked'), duration: 6});
      }
    } else {
      if (!backend.available) {
        notification.error({title: i18n.t('a11yStressUnavailable')});
        return;
      }
      const result = await backend.doctor.applyStress(device, mode);
      if (!result.ok) {
        notification.error({title: modeName, description: result.error});
        return;
      }
      previous = result.previous;
      await delay(STRESS_SETTLE_MS);
    }

    dispatch({type: SET_A11Y_STRESS, stress: {mode, previous, device, baselineIds}});
    await refreshAndScan(dispatch);
    const found = getState().inspector.a11yScan?.violations ?? [];
    const added = found.filter((v) => !baselineIds.includes(v.id)).length;
    notification.success({title: i18n.t('a11yStressDone', {mode: modeName, count: added}), duration: 4});
  };
}

export function endA11yStress() {
  return async (dispatch, getState) => {
    const {driver, a11yStress} = getState().inspector;
    if (!a11yStress) {
      return;
    }
    const {mode, previous, device} = a11yStress;
    try {
      if (mode === 'landscape') {
        await driver.setOrientation(previous || 'PORTRAIT');
      } else if (backend.available) {
        await backend.doctor.restoreStress(device, mode, previous);
      }
    } catch (error) {
      log.error(error);
    }
    dispatch({type: SET_A11Y_STRESS, stress: null});
    await delay(STRESS_SETTLE_MS / 2);
    await refreshAndScan(dispatch);
    notification.info({title: i18n.t('a11yStressRestored'), duration: 2});
  };
}
