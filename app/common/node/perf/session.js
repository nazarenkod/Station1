import {isAppId} from '../../shared/perf/parsers.js';
import {addSample, processChanges} from '../../shared/perf/series.js';
import {appVersion} from '../device/apps.js';
import {DEVICE_KIND} from '../doctor/devices.js';
import {androidSampler} from './android.js';
import {simulatorSampler} from './ios.js';

const LOOK_MS = 1000;
// a memory reading older than this is not shown as the current one
const MEMORY_FRESH_MS = 8000;

const isAndroid = (device) =>
  device.kind === DEVICE_KIND.ANDROID_DEVICE || device.kind === DEVICE_KIND.ANDROID_EMULATOR;

/**
 * Measures one app on one device while the person asked for it: a sample a
 * second with CPU, threads and the latest memory, markers when the app's
 * processes start and end, and batches of both sent to the screen.
 */
export class PerfSession {
  constructor({device, appId, onBatch, sampler = null, now = () => Date.now(), version = appVersion}) {
    this.device = device;
    this.appId = appId;
    this.onBatch = onBatch;
    this.now = now;
    this.sampler = sampler;
    this.readVersion = version;
    this.samples = [];
    this.markers = [];
    this.pids = [];
    this.memory = null;
    this.status = {state: 'starting', build: 'unknown', flutter: null};
    this.startedAt = now();
    this.timers = [];
    this.busy = {look: false, memory: false};
    this.pending = {samples: [], markers: []};
    this.paused = false;
  }

  /** A paused test takes no samples; the graph shows a gap there. */
  setPaused(paused) {
    this.paused = !!paused;
  }

  snapshot() {
    return {
      samples: this.samples,
      markers: this.markers,
      status: this.status,
      appId: this.appId,
      deviceId: this.device.id,
      android: isAndroid(this.device),
      startedAt: this.startedAt,
    };
  }

  async start() {
    if (!this.appId || !isAppId(this.appId)) {
      return this.setStatus({state: 'failed', reason: 'noApp'});
    }
    if (!this.sampler) {
      if (isAndroid(this.device)) {
        this.sampler = androidSampler(this.device, this.appId);
      } else if (this.device.kind === DEVICE_KIND.IOS_SIMULATOR) {
        this.sampler = simulatorSampler(this.device, this.appId);
      } else if (this.device.kind === DEVICE_KIND.IOS_DEVICE) {
        return this.setStatus({state: 'failed', reason: 'iosDevice'});
      } else {
        return this.setStatus({state: 'failed', reason: 'notRunning'});
      }
    }
    this.setStatus({state: 'live'});
    // the build does not change while the app runs: one look is enough
    this.sampler
      .build()
      .then(({kind, flutter}) => this.setStatus({build: kind, flutter}))
      .catch(() => null);
    // the version the device reports: runs of one build are compared together
    Promise.resolve(this.readVersion(this.device, this.appId))
      .then((installed) => this.setStatus({version: installed?.version ?? '', number: installed?.build ?? ''}))
      .catch(() => null);
    await this.look();
    this.every(LOOK_MS, () => this.look());
    this.every(this.sampler.memoryEvery, () => this.readMemory());
    return this.status;
  }

  /**
   * What the run measured so far, to be kept: the samples of the main
   * process, the markers the window gathered (screens and processes).
   */
  run(markers) {
    const platform = isAndroid(this.device) ? 'android' : 'ios';
    return {
      id: `${this.startedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      appId: this.appId,
      platform,
      device: this.device.name ?? this.device.id,
      os: this.device.platformVersion ?? '',
      build: {version: this.status.version ?? '', number: this.status.number ?? '', kind: this.status.build},
      samples: this.samples,
      markers: markers ?? this.markers,
      startedAt: this.startedAt,
      endAt: this.samples.at(-1)?.at ?? this.now(),
    };
  }

  /** A new test: the measurement goes on from now with nothing behind it. */
  reset() {
    this.samples = [];
    this.markers = [];
    this.pending = {samples: [], markers: []};
    this.startedAt = this.now();
  }

  stop() {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    this.setStatus({state: 'stopped'});
  }

  every(ms, fn) {
    this.timers.push(setInterval(fn, ms));
  }

  setStatus(patch) {
    this.status = {...this.status, ...patch};
    this.emit(true);
    return this.status;
  }

  async look() {
    if (this.busy.look || this.paused || this.status.state === 'stopped') {
      return;
    }
    this.busy.look = true;
    try {
      const look = await this.sampler.look();
      const at = this.now();
      if (this.status.state === 'stopped') {
        return;
      }
      if (!look.ok) {
        this.setStatus({state: 'failed', reason: 'tool', error: look.error});
        return;
      }
      const {started, ended} = processChanges(this.pids, look.pids);
      for (const pid of ended) {
        this.mark({at, kind: 'end', pid});
      }
      for (const pid of started) {
        this.mark({at, kind: 'start', pid});
      }
      this.pids = look.pids;
      if (!look.pids.length) {
        this.memory = null;
      } else if (!this.memory && !this.busy.memory) {
        // a process that just started gets its memory now, not on the next round
        this.readMemory();
      }
      const memory = this.memory && at - this.memory.at < MEMORY_FRESH_MS ? this.memory : null;
      const sample = {
        at,
        cpu: look.cpu,
        threads: look.threads,
        memory: memory?.total ?? null,
        parts: memory?.parts ?? null,
        pids: look.pids,
      };
      addSample(this.samples, sample);
      this.pending.samples.push(sample);
      const state = look.pids.length ? 'live' : 'waiting';
      if (this.status.state !== state) {
        this.setStatus({state, reason: undefined, error: undefined});
      } else {
        this.emit();
      }
    } catch (error) {
      this.setStatus({state: 'failed', reason: 'tool', error: error?.message ?? String(error)});
    } finally {
      this.busy.look = false;
    }
  }

  async readMemory() {
    if (this.busy.memory || !this.pids.length || this.status.state === 'stopped') {
      return;
    }
    this.busy.memory = true;
    try {
      const memory = await this.sampler.memory();
      this.memory = memory ? {...memory, at: this.now()} : null;
    } catch {
      this.memory = null;
    } finally {
      this.busy.memory = false;
    }
  }

  mark(marker) {
    this.markers.push(marker);
    this.pending.markers.push(marker);
  }

  emit(withStatus = false) {
    const {samples, markers} = this.pending;
    if (!withStatus && !samples.length && !markers.length) {
      return;
    }
    this.pending = {samples: [], markers: []};
    this.onBatch({samples, markers, status: this.status});
  }
}
