import {describe, expect, it} from 'vitest';

import {run} from '../../app/common/node/doctor/exec.js';
import {journal, parseJournalFile, trackHandler} from '../../app/common/node/journal.js';
import {
  commandOutcome,
  createJournal,
  describeCommand,
  filterEntries,
  formatJournal,
  journalHealth,
  formatSummary,
  mergeEntries,
  redact,
  runningEntries,
  SLOW_MS,
} from '../../app/common/shared/journal.js';

const clock = (start = 1_000_000) => {
  let time = start;
  const now = () => time;
  now.add = (ms) => (time += ms);
  return now;
};

describe('station journal: records', function () {
  it('opens a record that runs and closes it with how it ended', function () {
    const now = clock();
    const log = createJournal({now});
    const id = log.begin({source: 'command', text: 'adb devices'});
    expect(log.list()[0]).toMatchObject({source: 'command', state: 'running', level: 'debug'});
    now.add(1500);
    log.end(id, {level: 'info', outcome: 'exit 0'});
    expect(log.list()[0]).toMatchObject({state: 'done', duration: 1500, outcome: 'exit 0', level: 'info'});
  });

  it('keeps the newest records within the limit, but never drops one still running', function () {
    const log = createJournal({limit: 3});
    const hanging = log.begin({text: 'zsh -ilc'});
    for (let i = 0; i < 5; i++) {
      log.add({text: `record ${i}`});
    }
    expect(log.list().map((entry) => entry.text)).toEqual(['zsh -ilc', 'record 3', 'record 4']);
    expect(log.list()[0].id).toBe(hanging);
  });

  it('clears everything but what still runs', function () {
    const log = createJournal();
    log.add({text: 'done'});
    log.begin({text: 'running'});
    log.clear();
    expect(log.list().map((entry) => entry.text)).toEqual(['running']);
  });

  it('shows what runs now, longest first, slow ones marked', function () {
    const now = clock();
    const log = createJournal({now});
    log.begin({text: 'old'});
    now.add(SLOW_MS);
    log.begin({text: 'new'});
    now.add(100);
    const running = runningEntries(log.list(), now());
    expect(running.map((entry) => [entry.text, entry.slow])).toEqual([
      ['old', true],
      ['new', false],
    ]);
  });

  it('merges changed records into a list by id', function () {
    const merged = mergeEntries(
      [
        {id: 1, text: 'a', state: 'running'},
        {id: 2, text: 'b'},
      ],
      [
        {id: 1, text: 'a', state: 'done'},
        {id: 3, text: 'c'},
      ],
    );
    expect(merged.map((entry) => [entry.id, entry.state])).toEqual([
      [1, 'done'],
      [2, undefined],
      [3, undefined],
    ]);
  });
});

describe('station journal: commands', function () {
  it('describes a command as typed in a terminal', function () {
    expect(describeCommand('/bin/zsh', ['-ilc', 'printf %s; env -0'])).toBe("/bin/zsh -ilc 'printf %s; env -0'");
  });

  it('tells how a command ended without keeping its stdout', function () {
    expect(commandOutcome({ok: true, code: 0, stdout: 'SECRET=1'})).toEqual({level: 'info', outcome: 'exit 0'});
    expect(commandOutcome({ok: false, code: 2, stdout: 'TOKEN=x', stderr: 'boom'})).toEqual({
      level: 'warn',
      outcome: 'exit 2',
      detail: 'boom',
    });
    expect(commandOutcome({ok: false, missing: true})).toEqual({level: 'warn', outcome: 'missing'});
    expect(commandOutcome({ok: false, timedOut: true, stderr: ''})).toMatchObject({level: 'error', outcome: 'timeout'});
  });

  it.skipIf(process.platform === 'win32')('writes every command the station runs', async function () {
    await run('/bin/sh', ['-c', 'echo nope >&2; exit 4']);
    const record = journal.list().findLast((entry) => entry.source === 'command');
    expect(record).toMatchObject({
      text: "/bin/sh -c 'echo nope >&2; exit 4'",
      state: 'done',
      level: 'warn',
      outcome: 'exit 4',
      detail: 'nope\n',
    });
  });

  it.skipIf(process.platform === 'win32')('shows a hanging command as running until it ends', async function () {
    const pending = run('/bin/sh', ['-c', 'sleep 0.3'], {timeout: 100});
    const record = journal.list().findLast((entry) => entry.source === 'command');
    expect(record).toMatchObject({text: "/bin/sh -c 'sleep 0.3'", state: 'running'});
    await pending;
    expect(journal.list().find((entry) => entry.id === record.id)).toMatchObject({
      state: 'done',
      level: 'error',
      outcome: 'timeout',
    });
  });
});

describe('station journal: calls from the interface', function () {
  it('writes the channel, the time and a failure, never the arguments or the answer', async function () {
    const log = createJournal();
    const ok = trackHandler('doctor:devices', async () => ({devices: ['secret']}), log);
    const failed = trackHandler('proxy:start', async () => ({ok: false, error: 'port 8888 is busy'}), log);
    const thrown = trackHandler(
      'builds:inspect',
      async () => {
        throw new Error('no such file');
      },
      log,
    );

    expect(await ok({}, 'password=1')).toEqual({devices: ['secret']});
    await failed({});
    await expect(thrown({})).rejects.toThrow('no such file');

    const [first, second, third] = log.list();
    expect(first).toMatchObject({source: 'ipc', text: 'doctor:devices', level: 'debug', state: 'done'});
    expect(JSON.stringify(first)).not.toContain('secret');
    expect(JSON.stringify(first)).not.toContain('password');
    expect(second).toMatchObject({source: 'proxy', level: 'warn', detail: 'port 8888 is busy'});
    expect(third).toMatchObject({source: 'ipc', level: 'error'});
    expect(third.detail).toContain('no such file');
  });

  it('leaves quiet channels alone', function () {
    const handler = () => 1;
    expect(trackHandler('settings:get', handler)).toBe(handler);
    expect(trackHandler('journal:list', handler)).toBe(handler);
  });
});

describe('station journal: summary, filter and text', function () {
  const summary = {
    app: 'Station#1',
    version: '1.2.0',
    os: 'macOS 14.6',
    arch: 'arm64',
    shell: '/bin/zsh',
    shellEnv: {ok: false, timedOut: true, ms: 8004},
    path: '/usr/bin:/bin',
    androidHome: '/sdk',
  };

  it('sums up the run: the app, the OS, the shell and how its environment was read', function () {
    expect(formatSummary(summary)).toEqual([
      'app: Station#1 1.2.0',
      'os: macOS 14.6 arm64',
      'shell: /bin/zsh',
      'shell env: timed out after 8.0 s',
      'PATH: /usr/bin:/bin',
      'ANDROID_HOME: /sdk',
    ]);
  });

  const entries = [
    {id: 1, time: 0, level: 'debug', source: 'ipc', text: 'doctor:devices'},
    {id: 2, time: 0, level: 'warn', source: 'command', text: 'adb devices', detail: 'daemon not running'},
    {id: 3, time: 0, level: 'error', source: 'appium', text: 'Appium failed'},
  ];

  it('filters by level, source and text', function () {
    const ids = (filter) => filterEntries(entries, filter).map((entry) => entry.id);
    expect(ids({level: 'error'})).toEqual([3]);
    expect(ids({level: 'warn'})).toEqual([2, 3]);
    expect(ids({level: 'all', sources: ['ipc', 'command']})).toEqual([1, 2]);
    expect(ids({query: 'DAEMON'})).toEqual([2]);
  });

  it('turns the run into text: the summary, then every record with its details', function () {
    const text = formatJournal({
      summary,
      entries: [
        {
          id: 1,
          time: 0,
          level: 'warn',
          source: 'command',
          text: 'adb devices',
          outcome: 'exit 1',
          duration: 40,
          detail: 'boom',
        },
        {id: 2, time: 0, level: 'debug', source: 'command', text: 'zsh -ilc', state: 'running'},
      ],
      now: 9000,
    });
    expect(text).toContain('shell env: timed out after 8.0 s');
    expect(text).toMatch(/WARN {2}command adb devices → exit 1 \(40 ms\)\n {4}boom/);
    expect(text).toMatch(/zsh -ilc \(running 9\.0 s\)/);
  });

  it('reads a journal file back, a record that never ended stays running', function () {
    const lines = [
      JSON.stringify({summary}),
      JSON.stringify({entry: {id: 1, text: 'zsh -ilc', state: 'running'}}),
      JSON.stringify({entry: {id: 2, text: 'adb', state: 'running'}}),
      JSON.stringify({entry: {id: 2, text: 'adb', state: 'done'}}),
      '{"entry": {"id": 3, "te',
    ].join('\n');
    const read = parseJournalFile(lines);
    expect(read.summary).toEqual(summary);
    expect(read.entries.map((entry) => [entry.id, entry.state])).toEqual([
      [1, 'running'],
      [2, 'done'],
    ]);
  });
});

describe('station journal: secrets', function () {
  it('masks tokens, keys, passwords and authorization headers', function () {
    const text = redact(
      [
        'Authorization: Bearer abcdefghijklmnop',
        'curl https://gitlab.example.com/api?private_token=glpat-abcdefghij1234',
        '{"apiKey": "sk-ant-api03-abcdefghijk", "password":"hunter22"}',
        'JIRA_TOKEN=ATATT3xFfGF0abcdef',
      ].join('\n'),
    );
    expect(text).not.toMatch(/abcdefghijklmnop|glpat-abcdefghij1234|api03-abcdefghijk|hunter22|ATATT3xFfGF0abcdef/);
    expect(text).toContain('Authorization: •••');
    expect(text).toContain('password":"•••');
  });

  it('masks secrets in records and in the copied text', function () {
    const log = createJournal();
    log.add({text: 'git clone https://x?token=abc123secret', detail: 'Cookie: session=deadbeef'});
    const text = formatJournal({entries: log.list()});
    expect(text).not.toContain('abc123secret');
    expect(text).not.toContain('deadbeef');
  });

  it('leaves ordinary text as it is', function () {
    expect(redact('adb -s emulator-5554 shell getprop ro.build.version.release')).toBe(
      'adb -s emulator-5554 shell getprop ro.build.version.release',
    );
  });
});

describe('station journal: the dot in the title bar', function () {
  it('counts the errors and warnings since the journal was last looked at, a record once', function () {
    const entries = [
      {id: 1, time: 100, level: 'error'},
      {id: 2, time: 200, level: 'warn', state: 'running'},
      {id: 2, time: 200, level: 'error', state: 'failed'},
      {id: 3, time: 300, level: 'warn'},
      {id: 4, time: 400, level: 'info'},
    ];
    expect(journalHealth(entries)).toEqual({errors: 2, warnings: 1, status: 'error'});
    expect(journalHealth(entries, 250)).toEqual({errors: 0, warnings: 1, status: 'warn'});
    expect(journalHealth(entries, 1000)).toEqual({errors: 0, warnings: 0, status: 'ok'});
  });
});
