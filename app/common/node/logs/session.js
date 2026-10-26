import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

import {createLogRuleEngine} from '../../shared/findings/log-rules.js';
import {readPlist} from '../builds/plist.js';
import {DEVICE_KIND} from '../doctor/devices.js';
import {runTool, shellEnv} from '../doctor/exec.js';
import {LogcatJoiner, parseIdevicesyslogLine, parseIosNdjsonLine} from './parsers.js';

const MAX_ENTRIES = 20000;
const BATCH_INTERVAL_MS = 200;
const PID_POLL_MS = 1500;
const ANDROID_HISTORY_LINES = '2000';

const isAndroid = (device) =>
  device.kind === DEVICE_KIND.ANDROID_DEVICE || device.kind === DEVICE_KIND.ANDROID_EMULATOR;

// ActivityManager: "Start proc 13410:com.acme.wallet/u0a123 for activity {...}"
const START_PROC = /^Start proc (\d+):([\w.]+)[/:]/;
// ActivityManager: "Process com.acme.wallet (pid 12873) has died: fg TOP"
const PROC_DIED = /^Process ([\w.]+) \(pid (\d+)\) has died/;

/**
 * The executable of an app on a simulator, the process name its log lines carry.
 */
async function simulatorExecutable(udid, bundleId) {
  const container = await runTool('xcrun', ['simctl', 'get_app_container', udid, bundleId], {timeout: 10000});
  if (!container.ok) {
    return null;
  }
  const appPath = container.stdout.trim();
  try {
    const info = await readPlist(await readFile(path.join(appPath, 'Info.plist')));
    return info.CFBundleExecutable ?? path.basename(appPath, '.app');
  } catch {
    return path.basename(appPath, '.app');
  }
}

/**
 * The log of one device while the workstation runs: every line is kept (up
 * to a limit), checked by the rules and sent to the screen in small batches.
 * The app's processes are followed across restarts, so "only the app" keeps
 * working when its pid changes.
 */
export class LogSession {
  constructor({device, appId = null, rules = {}, onBatch}) {
    this.device = device;
    this.appId = appId;
    this.onBatch = onBatch;
    this.engine = createLogRuleEngine(rules);
    this.rulesConfig = rules;
    this.entries = [];
    this.findings = new Map();
    this.processes = [];
    this.appPids = new Set();
    this.appProcess = null;
    this.seq = 0;
    this.status = {state: 'starting'};
    this.pending = {entries: [], findings: new Set(), changed: false};
    this.child = null;
    this.timers = [];
  }

  // ---- what the screen asks for

  snapshot() {
    return {
      entries: this.entries,
      findings: [...this.findings.values()],
      processes: this.processes,
      status: this.status,
      appId: this.appId,
    };
  }

  async setApp(appId) {
    this.appId = appId;
    this.appPids = new Set();
    this.processes = [];
    this.appProcess = null;
    if (appId && !isAndroid(this.device) && this.device.kind === DEVICE_KIND.IOS_SIMULATOR) {
      this.appProcess = await simulatorExecutable(this.device.id, appId);
    }
    if (appId && isAndroid(this.device)) {
      await this.pollPid();
    }
    this.recheck();
  }

  setRules(rules) {
    this.rulesConfig = rules;
    this.engine = createLogRuleEngine(rules);
    this.recheck();
  }

  clear() {
    this.entries = [];
    this.findings = new Map();
    this.pending = {entries: [], findings: new Set(), changed: true};
    this.emit({reset: true});
  }

  // ---- the stream

  async start() {
    const env = await shellEnv();
    if (this.appId) {
      await this.setApp(this.appId);
    }
    let command;
    let args;
    let onLine;
    if (isAndroid(this.device)) {
      const joiner = new LogcatJoiner();
      command = 'adb';
      args = ['-s', this.device.id, 'logcat', '-v', 'threadtime', '-T', ANDROID_HISTORY_LINES];
      onLine = (line) => {
        const entry = joiner.push(line);
        if (entry) {
          this.add(entry);
        }
      };
      // the last line of a burst would otherwise wait for the next one
      this.every(BATCH_INTERVAL_MS, () => {
        const entry = joiner.flush();
        if (entry) {
          this.add(entry);
        }
      });
      this.every(PID_POLL_MS, () => this.pollPid());
    } else if (this.device.kind === DEVICE_KIND.IOS_SIMULATOR) {
      command = 'xcrun';
      args = ['simctl', 'spawn', this.device.id, 'log', 'stream', '--style', 'ndjson', '--level', 'info'];
      onLine = (line) => {
        const entry = parseIosNdjsonLine(line);
        if (entry) {
          this.add(entry);
        }
      };
    } else if (this.device.kind === DEVICE_KIND.IOS_DEVICE) {
      command = 'idevicesyslog';
      args = ['-u', this.device.id];
      onLine = (line) => {
        const entry = parseIdevicesyslogLine(line);
        if (entry) {
          this.add(entry);
        }
      };
    } else {
      this.setStatus({state: 'failed', reason: 'notRunning'});
      return this.status;
    }

    const child = spawn(command, args, {env});
    this.child = child;
    let buffered = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) {
        onLine(line.replace(/\r$/, ''));
      }
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', (error) => {
      this.setStatus({
        state: 'failed',
        reason:
          error.code === 'ENOENT' ? (command === 'idevicesyslog' ? 'needsLibimobiledevice' : 'toolMissing') : 'failed',
        error: error.message,
      });
    });
    child.on('exit', (code) => {
      if (this.child === child && this.status.state !== 'stopped') {
        this.setStatus({state: 'failed', reason: 'ended', error: stderr.trim().split('\n').pop() || `exit ${code}`});
      }
    });
    this.every(BATCH_INTERVAL_MS, () => this.emit());
    this.setStatus({state: 'live'});
    return this.status;
  }

  stop() {
    this.setStatus({state: 'stopped'});
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    this.child?.kill();
    this.child = null;
  }

  // ---- inside

  every(ms, fn) {
    this.timers.push(setInterval(fn, ms));
  }

  setStatus(status) {
    this.status = status;
    this.pending.changed = true;
    this.emit();
  }

  isApp(entry) {
    if (isAndroid(this.device)) {
      return this.appPids.has(entry.pid);
    }
    return !!this.appProcess && entry.process === this.appProcess;
  }

  marker(event, pid, time) {
    // rechecking walks the kept lines: a marker added then would land at the end
    if (this.rechecking) {
      return;
    }
    const entry = {seq: ++this.seq, kind: 'marker', event, pid, time};
    this.store(entry);
  }

  processStarted(pid, time = '') {
    if (this.appPids.has(pid)) {
      return;
    }
    this.appPids.add(pid);
    this.processes = [...this.processes, {pid, startedAt: time, endedAt: null}];
    this.marker('start', pid, time);
    this.pending.changed = true;
  }

  processEnded(pid, time = '') {
    const process = this.processes.find((p) => p.pid === pid && !p.endedAt);
    if (!process) {
      return;
    }
    this.processes = this.processes.map((p) => (p === process ? {...p, endedAt: time || 'ended'} : p));
    this.marker('end', pid, time);
    this.pending.changed = true;
  }

  async pollPid() {
    if (!this.appId) {
      return;
    }
    const result = await runTool('adb', ['-s', this.device.id, 'shell', 'pidof', this.appId], {timeout: 5000});
    const pids = result.ok ? result.stdout.trim().split(/\s+/).filter(Boolean).map(Number) : [];
    for (const pid of pids) {
      this.processStarted(pid);
    }
    for (const process of this.processes) {
      if (!process.endedAt && !pids.includes(process.pid) && result.ok) {
        this.processEnded(process.pid);
      }
    }
  }

  followProcesses(entry) {
    if (!this.appId || entry.tag !== 'ActivityManager') {
      return;
    }
    const started = START_PROC.exec(entry.message);
    if (started && started[2] === this.appId) {
      this.processStarted(Number(started[1]), entry.time);
    }
    const died = PROC_DIED.exec(entry.message);
    if (died && died[1] === this.appId) {
      this.processEnded(Number(died[2]), entry.time);
    }
  }

  add(raw) {
    this.followProcesses(raw);
    const entry = {...raw, seq: ++this.seq};
    this.decorate(entry);
    this.store(entry);
  }

  decorate(entry) {
    entry.app = this.isApp(entry);
    // iOS has no pidof: the app's process shows itself with its first line
    if (entry.app && !isAndroid(this.device) && !this.appPids.has(entry.pid)) {
      for (const process of this.processes.filter((p) => !p.endedAt)) {
        this.processEnded(process.pid, entry.time);
      }
      this.processStarted(entry.pid, entry.time);
    }
    const hits = this.engine.check(entry, {appId: this.appId, isApp: (e) => this.isApp(e)});
    entry.hits = hits.map((hit) => hit.rule);
    entry.forApp = entry.app || hits.some((hit) => hit.forApp);
    for (const hit of hits) {
      const known = this.findings.get(hit.id);
      const {ruleId: _ruleId, ...finding} = hit;
      this.findings.set(
        hit.id,
        known
          ? {...known, count: known.count + 1, lastSeq: entry.seq, lastTime: entry.time}
          : {
              ...finding,
              count: 1,
              firstSeq: entry.seq,
              lastSeq: entry.seq,
              firstTime: entry.time,
              lastTime: entry.time,
            },
      );
      this.pending.findings.add(hit.id);
    }
  }

  store(entry) {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    this.pending.entries.push(entry);
  }

  /**
   * The rules or the app changed: every kept line is checked again.
   */
  recheck() {
    this.findings = new Map();
    if (!isAndroid(this.device)) {
      this.appPids = new Set();
      this.processes = [];
    }
    this.rechecking = true;
    for (const entry of this.entries) {
      if (entry.kind !== 'marker') {
        this.decorate(entry);
      }
    }
    this.rechecking = false;
    this.pending = {entries: [], findings: new Set(), changed: true};
    this.emit({reset: true});
  }

  emit({reset = false} = {}) {
    const {entries, findings, changed} = this.pending;
    if (!reset && !entries.length && !findings.size && !changed) {
      return;
    }
    this.pending = {entries: [], findings: new Set(), changed: false};
    this.onBatch(
      reset
        ? {reset: true, ...this.snapshot()}
        : {
            entries,
            findings: [...findings].map((id) => this.findings.get(id)),
            processes: this.processes,
            status: this.status,
            appId: this.appId,
          },
    );
  }
}
