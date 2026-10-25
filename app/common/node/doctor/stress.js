import {runTool} from './exec.js';

// iOS content sizes run up to accessibility-extra-extra-extra-large
const IOS_LARGEST_CONTENT_SIZE = 'accessibility-extra-extra-extra-large';
// Android 14 allows up to 2.0; older versions apply it all the same
const ANDROID_LARGEST_FONT_SCALE = '2.0';

const adbShell = (udid, ...args) => runTool('adb', ['-s', udid, 'shell', ...args], {timeout: 15000});
const simctlUi = (udid, ...args) => runTool('xcrun', ['simctl', 'ui', udid, ...args], {timeout: 15000});

// "Night mode: yes" -> "yes"
export const parseNightMode = (output) => /Night mode:\s*(\w+)/i.exec(output)?.[1]?.toLowerCase() ?? 'no';

const failure = (result, fallback) => ({ok: false, error: (result.stderr || result.stdout).trim() || fallback});

/**
 * Switches the device into a stress mode and returns what to restore later.
 * Android devices go through adb; iOS only works on simulators (simctl ui).
 */
export async function applyStress({platform, udid}, mode) {
  if (!udid) {
    return {ok: false, error: 'The session does not name its device (no udid)'};
  }
  if (platform === 'android') {
    if (mode === 'dark') {
      const current = await adbShell(udid, 'cmd', 'uimode', 'night');
      if (!current.ok) {
        return failure(current, 'adb failed');
      }
      const set = await adbShell(udid, 'cmd', 'uimode', 'night', 'yes');
      return set.ok ? {ok: true, previous: parseNightMode(current.stdout)} : failure(set, 'adb failed');
    }
    if (mode === 'fontScale') {
      const current = await adbShell(udid, 'settings', 'get', 'system', 'font_scale');
      if (!current.ok) {
        return failure(current, 'adb failed');
      }
      const set = await adbShell(udid, 'settings', 'put', 'system', 'font_scale', ANDROID_LARGEST_FONT_SCALE);
      const previous = current.stdout.trim();
      return set.ok ? {ok: true, previous: previous === 'null' ? '1.0' : previous} : failure(set, 'adb failed');
    }
  }
  if (platform === 'ios') {
    const setting = mode === 'dark' ? 'appearance' : mode === 'fontScale' ? 'content_size' : null;
    if (setting) {
      const current = await simctlUi(udid, setting);
      // a physical device makes simctl fail: there is no way to switch it from here
      if (!current.ok) {
        return failure(current, 'Only iOS simulators can be switched');
      }
      const value = setting === 'appearance' ? 'dark' : IOS_LARGEST_CONTENT_SIZE;
      const set = await simctlUi(udid, setting, value);
      return set.ok ? {ok: true, previous: current.stdout.trim()} : failure(set, 'simctl failed');
    }
  }
  return {ok: false, error: `Stress mode ${mode} is not supported on ${platform}`};
}

export async function restoreStress({platform, udid}, mode, previous) {
  if (platform === 'android' && mode === 'dark') {
    return (await adbShell(udid, 'cmd', 'uimode', 'night', previous || 'no')).ok;
  }
  if (platform === 'android' && mode === 'fontScale') {
    return (await adbShell(udid, 'settings', 'put', 'system', 'font_scale', previous || '1.0')).ok;
  }
  if (platform === 'ios' && mode === 'dark') {
    return (await simctlUi(udid, 'appearance', previous || 'light')).ok;
  }
  if (platform === 'ios' && mode === 'fontScale') {
    return (await simctlUi(udid, 'content_size', previous || 'large')).ok;
  }
  return false;
}
