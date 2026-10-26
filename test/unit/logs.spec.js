import {describe, expect, it} from 'vitest';

import {
  LogcatJoiner,
  parseIdevicesyslogLine,
  parseIosNdjsonLine,
  parseLogcatLine,
} from '../../app/common/node/logs/parsers.js';
import {LogSession} from '../../app/common/node/logs/session.js';
import {compileCustomRule, createLogRuleEngine} from '../../app/common/shared/findings/log-rules.js';

const PKG = 'com.acme.wallet';
const line = (time, pid, level, tag, message, tid = pid) =>
  `10-26 ${time}  ${String(pid).padStart(5)} ${String(tid).padStart(5)} ${level} ${tag}: ${message}`;

const CRASH = [
  'FATAL EXCEPTION: main',
  `Process: ${PKG}, PID: 12873`,
  'java.lang.IllegalStateException: Transfer tr_7c1e already confirmed',
  '\tat com.acme.wallet.transfer.TransferViewModel.onConfirmResult(TransferViewModel.kt:214)',
];

describe('reading device logs', () => {
  it('reads logcat threadtime lines and skips separators', () => {
    expect(parseLogcatLine('--------- beginning of main')).toBeNull();
    expect(parseLogcatLine(line('14:25:48.214', 12873, 'D', 'OkHttp', '<-- 502 https://api.acme.io (2904ms)'))).toEqual(
      {
        date: '10-26',
        time: '14:25:48.214',
        pid: 12873,
        tid: 12873,
        level: 'D',
        tag: 'OkHttp',
        message: '<-- 502 https://api.acme.io (2904ms)',
      },
    );
  });

  it('joins the lines of a stack trace back into one entry', () => {
    const joiner = new LogcatJoiner();
    const done = [
      ...CRASH.map((text) => joiner.push(line('14:25:48.951', 12873, 'E', 'AndroidRuntime', text))),
      joiner.push(line('14:25:48.990', 1534, 'I', 'ActivityManager', `Process ${PKG} (pid 12873) has died: fg TOP`)),
    ].filter(Boolean);
    expect(done).toHaveLength(1);
    expect(done[0].message).toBe(CRASH.join('\n'));
    expect(joiner.flush().tag).toBe('ActivityManager');
  });

  it('reads the simulator unified log and idevicesyslog', () => {
    const ndjson = JSON.stringify({
      timestamp: '2026-10-26 14:25:45.301234+0300',
      messageType: 'Error',
      processID: 4242,
      threadID: 99,
      processImagePath: '/Users/qa/Library/Developer/CoreSimulator/.../Wallet.app/Wallet',
      subsystem: 'com.acme.wallet',
      category: 'network',
      eventMessage: 'Request failed: 502',
    });
    expect(parseIosNdjsonLine(ndjson)).toMatchObject({
      time: '14:25:45.301',
      pid: 4242,
      level: 'E',
      tag: 'network',
      process: 'Wallet',
      message: 'Request failed: 502',
    });
    expect(parseIosNdjsonLine('Filtering the log data using ""')).toBeNull();
    expect(
      parseIdevicesyslogLine('Oct 26 14:25:45.301 iPhone Wallet(CFNetwork)[4242] <Error>: Task failed'),
    ).toMatchObject({
      date: '10-26',
      time: '14:25:45.301',
      pid: 4242,
      level: 'E',
      tag: 'CFNetwork',
      process: 'Wallet',
    });
  });
});

describe('log rules', () => {
  const app = (entry) => entry.pid === 12873;
  const context = {appId: PKG, isApp: app};
  const entry = (pid, level, tag, message) => ({pid, tid: pid, level, tag, message, time: '14:25:48.951'});

  it('finds crashes of the app, and ANRs the system reports about it', () => {
    const engine = createLogRuleEngine();
    const crash = engine.check(entry(12873, 'E', 'AndroidRuntime', CRASH.join('\n')), context);
    expect(crash).toHaveLength(1);
    expect(crash[0]).toMatchObject({rule: 'log-crash', severity: 'high', forApp: true});
    expect(crash[0].params.exception).toBe('java.lang.IllegalStateException');

    const anr = engine.check(
      entry(
        1534,
        'E',
        'ActivityManager',
        `ANR in ${PKG} (${PKG}/.transfer.TransferActivity)\nPID: 13410\nReason: Input dispatching timed out`,
      ),
      context,
    );
    expect(anr[0]).toMatchObject({
      rule: 'log-anr',
      forApp: true,
      params: {app: PKG, reason: 'Input dispatching timed out'},
    });

    // another app's crash is not ours
    expect(engine.check(entry(999, 'E', 'AndroidRuntime', 'FATAL EXCEPTION: main'), context)).toEqual([]);
  });

  it('gives the same finding to the same crash with other numbers', () => {
    const engine = createLogRuleEngine();
    const a = engine.check(entry(12873, 'E', 'AndroidRuntime', CRASH.join('\n')), context)[0];
    const b = engine.check(
      entry(12873, 'E', 'AndroidRuntime', CRASH.join('\n').replace('tr_7c1e', 'tr_9f20').replace('214', '215')),
      context,
    )[0];
    expect(a.id).toBe(b.id);
  });

  it('runs the project rules: pattern, tag, level, scope', () => {
    const token = {id: 't1', name: 'Token in logs', pattern: 'token=\\S{20,}', severity: 'high'};
    const engine = createLogRuleEngine({custom: [token, {id: 'bad', name: 'Broken', pattern: '('}]});
    const hits = engine.check(
      entry(12873, 'D', 'AuthInterceptor', 'refresh ok, token=eyJhbGciOiJSUzI1NiIsInR5cCI6'),
      context,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      rule: 'log-custom-t1',
      textKey: 'log-custom',
      severity: 'high',
      params: {name: 'Token in logs'},
    });
    expect(compileCustomRule({id: 'bad', pattern: '('})).toBeNull();
    const errorsOnly = compileCustomRule({id: 'e', name: 'Errors', pattern: 'fail', minLevel: 'E', tag: 'Net'});
    expect(errorsOnly.check(entry(1, 'W', 'Net', 'fail'))).toBeNull();
    expect(errorsOnly.check(entry(1, 'E', 'Other', 'fail'))).toBeNull();
    expect(errorsOnly.check(entry(1, 'E', 'Net', 'request failed'))).toMatchObject({params: {match: 'fail'}});
  });

  it('lets a project turn a built-in rule off', () => {
    const engine = createLogRuleEngine({overrides: {'log-strict-mode': {enabled: false}}});
    expect(engine.check(entry(12873, 'W', 'StrictMode', 'DiskReadViolation'), context)).toEqual([]);
  });
});

describe('a log session', () => {
  const session = () => {
    const batches = [];
    const s = new LogSession({
      device: {kind: 'android-emulator', id: 'emulator-5554'},
      appId: PKG,
      onBatch: (b) => batches.push(b),
    });
    return {s, batches};
  };

  it('follows the app across a restart and keeps its crash and the ANR', () => {
    const {s} = session();
    s.add({
      ...parseLogcatLine(
        line('14:02:11.000', 1534, 'I', 'ActivityManager', `Start proc 12873:${PKG}/u0a123 for activity`),
      ),
    });
    s.add({...parseLogcatLine(line('14:25:48.951', 12873, 'E', 'AndroidRuntime', 'FATAL EXCEPTION: main'))});
    s.add({
      ...parseLogcatLine(
        line('14:25:48.990', 1534, 'I', 'ActivityManager', `Process ${PKG} (pid 12873) has died: fg TOP`),
      ),
    });
    s.add({
      ...parseLogcatLine(
        line('14:25:50.000', 1534, 'I', 'ActivityManager', `Start proc 13410:${PKG}/u0a123 for activity`),
      ),
    });
    s.add({...parseLogcatLine(line('14:25:50.102', 13410, 'I', 'AcmeApp', 'onCreate'))});
    // a multi-line message comes joined from LogcatJoiner
    s.add({
      ...parseLogcatLine(line('14:25:56.880', 1534, 'E', 'ActivityManager', `ANR in ${PKG}`)),
      message: `ANR in ${PKG}\nReason: Input dispatching timed out`,
    });
    s.add({...parseLogcatLine(line('14:25:57.000', 1012, 'D', 'WifiService', 'rssi=-54'))});

    expect(s.processes).toEqual([
      {pid: 12873, startedAt: '14:02:11.000', endedAt: '14:25:48.990'},
      {pid: 13410, startedAt: '14:25:50.000', endedAt: null},
    ]);
    const shown = s.entries.filter((e) => e.kind === 'marker' || e.forApp);
    expect(shown.map((e) => e.kind ?? e.tag)).toEqual([
      'marker',
      'AndroidRuntime',
      'marker',
      'marker',
      'AcmeApp',
      'ActivityManager',
    ]);
    expect([...s.findings.values()].map((f) => f.rule).sort()).toEqual(['log-anr', 'log-crash']);
  });

  it('counts a repeated problem instead of listing it again, and rechecks with new rules', () => {
    const {s, batches} = session();
    s.appPids.add(12873);
    for (const time of ['14:00:00.001', '14:00:01.001']) {
      s.add({...parseLogcatLine(line(time, 12873, 'W', 'StrictMode', 'policy violation; DiskReadViolation'))});
    }
    expect([...s.findings.values()]).toHaveLength(1);
    expect([...s.findings.values()][0]).toMatchObject({count: 2, firstTime: '14:00:00.001', lastTime: '14:00:01.001'});

    s.setRules({overrides: {'log-strict-mode': {enabled: false}}});
    expect(s.findings.size).toBe(0);
    expect(batches.at(-1)).toMatchObject({reset: true});
    expect(batches.at(-1).entries).toHaveLength(2);
  });
});
