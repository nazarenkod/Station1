import {PNG} from 'pngjs';

import {mergeConfig} from '../../renderer/lib/a11y/config';
import {reviewScan} from '../../renderer/lib/a11y/issues';
import {scanScreen} from '../../renderer/lib/a11y/rules';
import {identifyScreen} from '../../renderer/lib/a11y/screen';
import {detectFormat, parseUiTree} from '../../renderer/lib/a11y/ui-tree';

const REQUEST_TIMEOUT_MS = 60000;

export const decodePng = (buffer) => {
  const png = PNG.sync.read(buffer);
  return {width: png.width, height: png.height, data: png.data};
};

async function webdriver(baseUrl, path, {method = 'GET', body} = {}) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method,
    headers: body ? {'Content-Type': 'application/json'} : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.value?.message ?? `${method} ${path} failed (${response.status})`);
  }
  return json.value;
}

const script = (baseUrl, sessionId, name) =>
  webdriver(baseUrl, `/session/${sessionId}/execute/sync`, {method: 'POST', body: {script: name, args: []}}).catch(
    () => null,
  );

/**
 * The first session the server runs, for when none was named.
 */
export async function firstSession(baseUrl) {
  for (const endpoint of ['/appium/sessions', '/sessions']) {
    const sessions = await webdriver(baseUrl, endpoint).catch(() => null);
    if (Array.isArray(sessions) && sessions.length) {
      return sessions[0].id;
    }
  }
  throw new Error(`No session found on ${baseUrl}: name one with --session`);
}

/**
 * What a session shows right now: its page source, screenshot, and what the
 * rules need from the device (density, app, Android activity).
 */
export async function captureSession(baseUrl, sessionId) {
  const id = sessionId ?? (await firstSession(baseUrl));
  const [sourceXml, screenshot] = await Promise.all([
    webdriver(baseUrl, `/session/${id}/source`),
    webdriver(baseUrl, `/session/${id}/screenshot`),
  ]);
  const isAndroid = detectFormat(sourceXml) === 'appium-android';
  const [deviceInfo, activity, appPackage, appInfo] = await Promise.all([
    isAndroid ? script(baseUrl, id, 'mobile: deviceInfo') : null,
    isAndroid ? script(baseUrl, id, 'mobile: getCurrentActivity') : null,
    isAndroid ? script(baseUrl, id, 'mobile: getCurrentPackage') : null,
    isAndroid ? null : script(baseUrl, id, 'mobile: activeAppInfo'),
  ]);
  return {
    sessionId: id,
    sourceXml,
    png: Buffer.from(screenshot, 'base64'),
    densityDpi: deviceInfo?.displayDensity ?? null,
    activity: activity ?? null,
    appId: appPackage ?? appInfo?.bundleId ?? (isAndroid ? 'android' : 'ios'),
  };
}

/**
 * Checks one screen. Decisions (an export from Vision Inspector) mark issues
 * that were filed or ignored, so only open ones count.
 */
export function auditScreen({sourceXml, png, densityDpi, activity, appId = 'app', config, decisions}) {
  const rules = mergeConfig(config);
  const image = png ? decodePng(png) : null;
  const tree = parseUiTree(sourceXml, {
    imageWidth: image?.width ?? 0,
    imageHeight: image?.height ?? 0,
    densityDpi: densityDpi ?? undefined,
    activity: activity ?? undefined,
  });
  const scan = scanScreen(tree, image ?? undefined, rules);
  const screen = identifyScreen(tree, {titleTag: rules.patterns.screenTitleTag, activity: activity ?? undefined});
  const reviewed = reviewScan(scan.violations, decisions ?? {}, appId, screen.key);
  return {
    scan: {...scan, scale: tree.scale, imageWidth: image?.width ?? 0, imageHeight: image?.height ?? 0},
    screen,
    reviewed,
    appId,
  };
}

const SEVERITY_RANK = {error: 0, warning: 1, info: 2};

/**
 * Whether open issues reach the severity a build should fail on.
 */
export const failsAt = (reviewed, failOn) =>
  failOn !== 'none' && reviewed.open.some((v) => SEVERITY_RANK[v.severity] <= SEVERITY_RANK[failOn]);
