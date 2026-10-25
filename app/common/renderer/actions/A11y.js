import {A11Y_CONFIG, A11Y_ISSUE_STATES, AI_CONFIG} from '../../shared/setting-defs.js';
import i18n from '../i18next.js';
import {aiElements, auditPrompt, labelsPrompt, parseAuditAnswer, parseLabelsAnswer, screenTexts} from '../lib/a11y/ai';
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
export const SET_A11Y_AI = 'SET_A11Y_AI';

// the longest side of the screenshot a model gets, and of each control crop
const AI_SCREEN_MAX_SIDE = 1280;
const AI_CROP_MAX_SIDE = 128;
const AI_MAX_LABEL_CROPS = 8;
const EDITABLE = /EditText|AutoCompleteTextView|XCUIElementType(TextField|SecureTextField|SearchField|TextView)$/;

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
      if (!backend.doctor) {
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
      } else if (backend.doctor) {
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

async function loadImage(base64Png) {
  const image = new Image();
  image.src = `data:image/png;base64,${base64Png}`;
  await image.decode();
  return image;
}

const canvasPng = (canvas) => canvas.toDataURL('image/png').split(',')[1];

/**
 * Hides what must not leave the machine, then shrinks the screenshot: password
 * and filled-in fields, and any element whose text matches a mask pattern.
 */
function maskedScreenshot(image, tree, maskPatterns) {
  const masked = (text) => maskPatterns.some((pattern) => pattern.test(text));
  const scale = Math.min(1, AI_SCREEN_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  for (const node of tree.nodes) {
    const secret =
      node.password || (EDITABLE.test(node.className) && node.text.trim()) || masked(`${node.text} ${node.label}`);
    if (secret && node.bounds.width > 0) {
      context.fillRect(
        node.bounds.x * scale,
        node.bounds.y * scale,
        node.bounds.width * scale,
        node.bounds.height * scale,
      );
    }
  }
  return canvasPng(canvas);
}

function cropControl(image, bounds) {
  const padding = 8;
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const width = Math.min(image.naturalWidth - x, bounds.width + 2 * padding);
  const height = Math.min(image.naturalHeight - y, bounds.height + 2 * padding);
  const scale = Math.min(1, AI_CROP_MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvasPng(canvas);
}

const compilePatterns = (patterns = []) =>
  patterns.flatMap((pattern) => {
    try {
      return [new RegExp(pattern, 'gi')];
    } catch {
      return [];
    }
  });

/**
 * Asks the chosen model what the rules cannot see on this screen, and for
 * labels of the controls that have none. Issues it finds sit next to the
 * rules' ones with an AI badge; suggested labels go into the bug.
 */
export function runA11yAi() {
  return async (dispatch, getState) => {
    const {sourceXML, screenshot, a11yScan, a11yScreen, a11yDevice} = getState().inspector;
    if (!backend.ai || !sourceXML || !screenshot || !a11yScan || !a11yScreen) {
      return;
    }
    const status = await backend.ai.status();
    if (!status.ready) {
      dispatch({type: SET_A11Y_AI, ai: {status: 'setup'}});
      return;
    }
    if (!status.consent) {
      dispatch({type: SET_A11Y_AI, ai: {status: 'consent'}});
      return;
    }
    dispatch({type: SET_A11Y_AI, ai: {status: 'running', screenKey: a11yScreen.key}});
    try {
      const settings = {...(await getSetting(AI_CONFIG))};
      const patterns = compilePatterns(settings.maskPatterns);
      const mask = (text) => patterns.reduce((value, pattern) => value.replace(pattern, '•••'), text);
      const image = await loadImage(screenshot);
      const tree = parseUiTree(sourceXML, {
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        densityDpi: a11yDevice?.densityDpi ?? undefined,
      });
      const {elements, nodes} = aiElements(tree, mask);
      const platform = a11yScan.format === 'appium-ios' ? 'ios' : 'android';
      const audit = await backend.ai.generate({
        kind: 'a11y-audit',
        prompt: auditPrompt(elements, i18n.language?.slice(0, 2) ?? 'en', platform),
        images: [maskedScreenshot(image, tree, patterns)],
      });
      if (!audit.ok) {
        throw new Error(audit.error);
      }
      const violations = parseAuditAnswer(audit.result, tree, nodes);

      let labels = {};
      const unlabeled = a11yScan.violations.filter((v) => v.rule === 'missing-label').slice(0, AI_MAX_LABEL_CROPS);
      if (unlabeled.length) {
        const answer = await backend.ai.generate({
          kind: 'a11y-labels',
          prompt: labelsPrompt(unlabeled.length, screenTexts(tree, mask)),
          images: unlabeled.map((v) => cropControl(image, v.bounds)),
        });
        labels = answer.ok ? parseLabelsAnswer(answer.result, unlabeled) : {};
      }
      dispatch({
        type: SET_A11Y_AI,
        ai: {status: 'done', screenKey: a11yScreen.key, violations, labels, model: audit.model, cached: audit.cached},
      });
    } catch (error) {
      log.error(error);
      dispatch({type: SET_A11Y_AI, ai: {status: 'error', screenKey: a11yScreen.key, error: error.message}});
    }
  };
}

export function setA11yAiState(ai) {
  return (dispatch) => dispatch({type: SET_A11Y_AI, ai});
}

/**
 * Remembers that the person agreed to send screenshots to the chosen provider.
 */
export function grantAiConsent() {
  return async (dispatch) => {
    await setSetting(AI_CONFIG, {...((await getSetting(AI_CONFIG)) ?? {}), consent: true});
    await dispatch(runA11yAi());
  };
}
