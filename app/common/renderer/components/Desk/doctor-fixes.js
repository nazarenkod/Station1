// How to fix what the doctor finds: a sentence (doctorFix_<key>), the command
// to paste into a terminal for this platform, and an action the app can take
// itself when there is one.

import {commandFor as sharedCommand, fixKey} from '../../../shared/doctor/fix-commands.js';

const isWindows = () => typeof navigator !== 'undefined' && /^win/i.test(navigator.platform ?? '');
const commandFor = (key, params = {}) => sharedCommand(key, params, isWindows() ? 'win' : 'mac');

/**
 * The fix for one check of the doctor's environment report, or null when it passed.
 */
export function fixForCheck(check) {
  if (check.status === 'ok') {
    return null;
  }
  const key = fixKey(check);
  const fix = {key, command: commandFor(key, check.params)};
  if (check.fix?.action === 'installDriver') {
    fix.action = {kind: 'installDriver', driver: check.fix.driver};
  } else if (check.id === 'appiumMissing') {
    fix.action = {kind: 'installAppium'};
  }
  return fix;
}
