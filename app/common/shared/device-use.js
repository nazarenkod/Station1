// How often each device was used, so the lists put the usual ones first. A
// use is a device picked by the person or a session started on it; the
// station's own pick of a connected device does not count.

// enough for every phone and simulator on a desk; the least used beyond it are forgotten
const MAX_DEVICES = 50;

/**
 * Counts one more use of a device.
 * @param {Record<string, {count: number, last: number}>} use
 * @returns the counts, changed
 */
export function noteDeviceUse(use, deviceId, now = Date.now()) {
  if (!deviceId) {
    return use ?? {};
  }
  const was = use?.[deviceId];
  const next = {...use, [deviceId]: {count: (was?.count ?? 0) + 1, last: now}};
  const ids = Object.keys(next);
  if (ids.length <= MAX_DEVICES) {
    return next;
  }
  const kept = ids.sort((a, b) => compareUse(next[a], next[b])).slice(0, MAX_DEVICES);
  return Object.fromEntries(kept.map((id) => [id, next[id]]));
}

// the more uses first; of two used as often, the one used last
const compareUse = (a, b) => (b?.count ?? 0) - (a?.count ?? 0) || (b?.last ?? 0) - (a?.last ?? 0);

/**
 * The devices with the most used first. Devices used as often (never, say)
 * keep the order they came in: the doctor's, connected before stopped.
 */
export function byUse(devices, use) {
  if (!use || !Object.keys(use).length) {
    return devices;
  }
  return devices
    .map((device, index) => ({device, index}))
    .sort((a, b) => compareUse(use[a.device.id], use[b.device.id]) || a.index - b.index)
    .map(({device}) => device);
}
