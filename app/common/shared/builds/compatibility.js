// device kinds as the doctor lists them (app/common/node/doctor/devices.js)
const ANDROID_KINDS = ['android-device', 'android-emulator'];
const IOS_SIMULATOR = 'ios-simulator';

/**
 * Whether a build can go on a device at all, before trying: the platform,
 * simulator or device builds, the iPhones a provisioning profile lists.
 */
export function compatibility(build, device) {
  const deviceIsAndroid = ANDROID_KINDS.includes(device.kind);
  if ((build.platform === 'android') !== deviceIsAndroid) {
    return {ok: false, reason: 'wrongPlatform'};
  }
  if (build.platform === 'ios') {
    const simulator = device.kind === IOS_SIMULATOR;
    if (simulator && build.target === 'device') {
      return {ok: false, reason: 'deviceBuildOnSimulator'};
    }
    if (!simulator && build.target === 'simulator') {
      return {ok: false, reason: 'simulatorBuildOnDevice'};
    }
    const devices = build.manifest.profile?.devices;
    if (!simulator && devices && !devices.includes(device.id)) {
      return {ok: false, reason: 'notProvisioned'};
    }
  }
  return {ok: true};
}
