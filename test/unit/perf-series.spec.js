import {afterEach, describe, expect, it, vi} from 'vitest';

import {PerfSession} from '../../app/common/node/perf/session.js';
import {addSample, processChanges, screenSegments, segmentAt, summarize} from '../../app/common/shared/perf/series.js';

vi.mock('../../app/common/renderer/polyfills.js', () => ({backend: {}}));
const {screenMarker} = await import('../../app/common/renderer/components/Perf/perf-store.js');

const device = {id: 'emulator-5554', kind: 'android-emulator'};

/** A sampler that answers with the looks given, one per call. */
function fakeSampler(looks) {
  let index = 0;
  return {
    memoryEvery: 5000,
    look: async () => looks[Math.min(index++, looks.length - 1)],
    memory: async () => ({total: 100, parts: {}}),
    build: async () => ({kind: 'release', flutter: null}),
  };
}

describe('the series of samples', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps the series within its limit', () => {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      addSample(samples, {at: i}, 3);
    }
    expect(samples.map((sample) => sample.at)).toEqual([2, 3, 4]);
  });

  it('tells processes that started and ended', () => {
    expect(processChanges([1, 2], [2, 3])).toEqual({started: [3], ended: [1]});
  });

  it('marks the app starting, ending and starting again, and waits while it is gone', async () => {
    vi.useFakeTimers();
    const batches = [];
    let now = 0;
    const session = new PerfSession({
      device,
      appId: 'com.acme.wallet',
      onBatch: (batch) => batches.push(batch),
      now: () => (now += 1000),
      sampler: fakeSampler([
        {ok: true, pids: [10], cpu: null, threads: 30},
        {ok: true, pids: [], cpu: null, threads: null},
        {ok: true, pids: [11], cpu: 5, threads: 31},
      ]),
    });
    await session.start();
    expect(session.status).toMatchObject({state: 'live', build: 'release'});
    await session.look();
    expect(session.status.state).toBe('waiting');
    await session.look();
    session.stop();
    expect(session.markers.map((marker) => [marker.kind, marker.pid])).toEqual([
      ['start', 10],
      ['end', 10],
      ['start', 11],
    ]);
    expect(session.samples.map((sample) => sample.cpu)).toEqual([null, null, 5]);
    expect(session.status.state).toBe('stopped');
    expect(batches.at(-1).status.state).toBe('stopped');
  });

  it('says why it cannot measure on a real iPhone or without an app', async () => {
    const iphone = new PerfSession({device: {id: 'X', kind: 'ios-device'}, appId: 'com.acme', onBatch: () => {}});
    expect((await iphone.start()).reason).toBe('iosDevice');
    const noApp = new PerfSession({device, appId: null, onBatch: () => {}});
    expect((await noApp.start()).reason).toBe('noApp');
  });

  it('cuts time into the stretches each screen was on', () => {
    const markers = [
      {at: 1000, kind: 'start', pid: 1},
      {at: 2000, kind: 'screen', key: 'title:login', title: 'Login'},
      {at: 5000, kind: 'screen', key: 'title:home', title: 'Home'},
      {at: 6000, kind: 'screen', key: 'title:home', title: 'Home'},
      {at: 9000, kind: 'screen', key: 'layout:ab12', title: null},
    ];
    const segments = screenSegments(markers, 12000);
    expect(segments.map((segment) => [segment.title, segment.from, segment.to])).toEqual([
      ['Login', 2000, 5000],
      ['Home', 5000, 9000],
      [null, 9000, 12000],
    ]);
    expect(segmentAt(segments, 7000).title).toBe('Home');
    expect(segmentAt(segments, 500)).toBeNull();
  });

  it('sums up a stretch: CPU on average and at most, memory in, out and at most', () => {
    const samples = [
      {at: 1000, cpu: 10, memory: 100},
      {at: 2000, cpu: null, memory: null},
      {at: 3000, cpu: 30, memory: 300},
      {at: 4000, cpu: 20, memory: 200},
      {at: 5000, cpu: 90, memory: 900},
    ];
    expect(summarize(samples, 1000, 5000)).toEqual({
      samples: 4,
      cpuAvg: 20,
      cpuMax: 30,
      memoryStart: 100,
      memoryEnd: 200,
      memoryMax: 300,
    });
  });

  it('marks a screen once per arrival, and again in a new session', () => {
    const history = {
      sessionId: 's1',
      currentKey: 'title:home',
      screens: [{key: 'title:home', title: 'Home', named: true}],
      path: [{key: 'title:home', at: 4200}],
    };
    const marker = screenMarker(history, null);
    expect(marker).toEqual({at: 4200, kind: 'screen', key: 'title:home', title: 'Home'});
    expect(screenMarker(history, 's1|title:home')).toBeNull();
    expect(screenMarker({...history, sessionId: 's2'}, 's1|title:home')).not.toBeNull();
    expect(screenMarker({...history, screens: [{key: 'title:home', title: 'x', named: false}]}, null).title).toBeNull();
  });
});
