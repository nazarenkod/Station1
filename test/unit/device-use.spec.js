import {describe, expect, it, vi} from 'vitest';

import {byUse, noteDeviceUse} from '../../app/common/shared/device-use.js';

const backend = {doctor: {devices: vi.fn()}, device: null};
vi.mock('../../app/common/renderer/polyfills.js', () => ({backend, getSetting: vi.fn(), setSetting: vi.fn()}));

const {refreshDevices, selectDevice} = await import('../../app/common/renderer/actions/Workstation.js');
const {default: workstation} = await import('../../app/common/renderer/reducers/Workstation.js');

function storeWith(patch) {
  let state = {workstation: {...workstation(undefined, {type: 'init'}), ...patch}};
  const getState = () => state;
  const dispatch = (action) =>
    typeof action === 'function'
      ? action(dispatch, getState)
      : (state = {workstation: workstation(state.workstation, action)});
  return {dispatch, getState};
}

const device = (id, state = 'running') => ({id, name: id, state, platformName: 'Android', kind: 'android-emulator'});

describe('noteDeviceUse', () => {
  it('counts each use and remembers the last one', () => {
    const once = noteDeviceUse({}, 'pixel', 1);
    expect(noteDeviceUse(once, 'pixel', 5)).toEqual({pixel: {count: 2, last: 5}});
  });

  it('ignores no device', () => {
    expect(noteDeviceUse(undefined, null)).toEqual({});
  });

  it('forgets the least used beyond fifty devices', () => {
    let use = {};
    for (let i = 0; i < 50; i++) {
      use = noteDeviceUse(noteDeviceUse(use, `d${i}`, i), `d${i}`, i);
    }
    use = noteDeviceUse(use, 'new', 100);
    expect(Object.keys(use)).toHaveLength(50);
    expect(use.new).toBeUndefined();
  });
});

describe('byUse', () => {
  const list = [device('a'), device('b'), device('c'), device('d')];

  it('puts the most used first, then the one used last', () => {
    const use = {c: {count: 3, last: 1}, b: {count: 1, last: 9}, d: {count: 1, last: 2}};
    expect(byUse(list, use).map((one) => one.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('keeps the order of devices never used', () => {
    expect(byUse(list, {}).map((one) => one.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('devices of the workstation', () => {
  it('lists the most used first and picks it when nothing is chosen', async () => {
    backend.doctor.devices.mockResolvedValue({devices: [device('a'), device('b')]});
    const store = storeWith({deviceUse: {b: {count: 4, last: 1}}});
    await store.dispatch(refreshDevices());
    const {devices, deviceId, deviceUse} = store.getState().workstation;
    expect(devices.map((one) => one.id)).toEqual(['b', 'a']);
    expect(deviceId).toBe('b');
    // the station's own pick is not a use
    expect(deviceUse.b.count).toBe(4);
  });

  it('counts a device the person picks', async () => {
    const store = storeWith({devices: [device('a'), device('b')]});
    await store.dispatch(selectDevice('b'));
    const {devices, deviceUse} = store.getState().workstation;
    expect(deviceUse.b.count).toBe(1);
    expect(devices[0].id).toBe('b');
  });
});
