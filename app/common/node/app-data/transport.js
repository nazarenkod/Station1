import {NO_ACCESS} from '../../shared/app-data/access.js';
import {DEVICE_KIND} from '../doctor/devices.js';
import {openAndroid} from './android.js';
import {openIphone} from './iphone.js';
import {openSimulator} from './simulator.js';

// One way into an app's sandbox for each kind of device. A transport lists,
// reads, writes and deletes files by their path in the sandbox, stops and
// starts the app, and clears its data. iOS transports also read and write
// preferences as XML.

/**
 * @returns {Promise<{transport: object} | {error: {reason: string, detail?: string}}>}
 */
export async function openTransport(device, appId) {
  if (!device || !appId) {
    return {error: {reason: NO_ACCESS.NOT_RUNNING}};
  }
  if (device.state && device.state !== 'running') {
    return {error: {reason: NO_ACCESS.NOT_RUNNING}};
  }
  switch (device.kind) {
    case DEVICE_KIND.ANDROID_DEVICE:
    case DEVICE_KIND.ANDROID_EMULATOR:
      return await openAndroid(device, appId);
    case DEVICE_KIND.IOS_SIMULATOR:
      return await openSimulator(device, appId);
    case DEVICE_KIND.IOS_DEVICE:
      return await openIphone(device, appId);
    default:
      return {error: {reason: NO_ACCESS.NOT_RUNNING}};
  }
}
