import {describe, expect, it} from 'vitest';

import {parseStatList, sandboxCommand, shellQuote, writeScript} from '../../app/common/node/app-data/android.js';
import {findAppProcess, parseDevicectlFiles} from '../../app/common/node/app-data/iphone.js';
import {parseGroups} from '../../app/common/node/app-data/simulator.js';
import {
  androidAccess,
  devicectlDataProblem,
  NO_ACCESS,
  simulatorProblem,
} from '../../app/common/shared/app-data/access.js';

const ok = (stdout) => ({ok: true, stdout, stderr: ''});
const fail = (stderr) => ({ok: false, stdout: '', stderr});

describe('reaching the data of an Android app', function () {
  it('takes run-as for a debug build', function () {
    expect(androidAccess({runAs: ok('10153\n'), root: fail('su: not found'), emulator: false})).toEqual({
      mode: 'run-as',
      reason: null,
    });
  });

  it('takes root on an emulator without Google Play when the build is not debuggable', function () {
    expect(
      androidAccess({runAs: fail('run-as: package not debuggable: ua.app'), root: ok('0\n'), emulator: true}),
    ).toEqual({mode: 'root', reason: null});
  });

  it('says a release build on a phone cannot be read', function () {
    expect(
      androidAccess({
        runAs: fail('run-as: package not debuggable: ua.app'),
        root: fail('su: not found'),
        emulator: false,
      }),
    ).toEqual({mode: null, reason: NO_ACCESS.RELEASE_BUILD});
  });

  it('says an emulator with Google Play has no root', function () {
    expect(
      androidAccess({
        runAs: fail('run-as: package not debuggable: ua.app'),
        root: fail('/system/bin/sh: su: inaccessible or not found'),
        emulator: true,
      }),
    ).toEqual({mode: null, reason: NO_ACCESS.EMULATOR_NO_ROOT});
  });

  it('says the app is not installed', function () {
    expect(androidAccess({runAs: fail('run-as: unknown package: ua.app'), root: fail(''), emulator: true}).reason).toBe(
      NO_ACCESS.NOT_INSTALLED,
    );
    expect(androidAccess({installed: false}).reason).toBe(NO_ACCESS.NOT_INSTALLED);
  });

  it('keeps the tool’s text when the reason is unknown', function () {
    expect(androidAccess({runAs: fail('error: device offline'), root: fail(''), emulator: false})).toEqual({
      mode: null,
      reason: NO_ACCESS.FAILED,
      detail: 'error: device offline',
    });
  });
});

describe('reaching the data of an iOS app', function () {
  it('says a simulator app is not installed', function () {
    expect(
      simulatorProblem(fail('An error was encountered processing the command (code=2): No such file or directory'))
        .reason,
    ).toBe(NO_ACCESS.NOT_INSTALLED);
  });

  it('reads the devicectl errors of an iPhone', function () {
    const error = (text) => ({
      error: {userInfo: {NSLocalizedDescription: {string: text}, NSDebugDescription: {string: text}}},
    });
    expect(devicectlDataProblem(error('Expected to find key requireContainerAccess.')).reason).toBe(
      NO_ACCESS.XCODE_TOO_OLD,
    );
    expect(devicectlDataProblem(error('The device is passcode locked')).reason).toBe(NO_ACCESS.DEVICE_LOCKED);
    expect(devicectlDataProblem(error('The application could not be found')).reason).toBe(NO_ACCESS.NOT_INSTALLED);
    expect(devicectlDataProblem(error('Operation not permitted: missing get-task-allow')).reason).toBe(
      NO_ACCESS.NOT_DEVELOPMENT_SIGNED,
    );
    expect(devicectlDataProblem({result: {}})).toBe(null);
  });
});

describe('the device tools’ output', function () {
  it('lists the Android sandbox with times finer than a second', function () {
    const output = [
      '172|2026-10-27 23:30:00.123456789 +0200|./shared_prefs/app.xml',
      '172|2026-10-27 23:30:00.987000000 +0200|./files/with space.txt',
      'stat: ./gone: No such file',
    ].join('\n');
    expect(parseStatList(output)).toEqual([
      {path: 'files/with space.txt', size: 172, mtime: Date.parse('2026-10-27T21:30:00.987Z')},
      {path: 'shared_prefs/app.xml', size: 172, mtime: Date.parse('2026-10-27T21:30:00.123Z') + 0.457},
    ]);
  });

  it('runs a script in the sandbox as the app, or as root with the files given back to the app', function () {
    expect(sandboxCommand('ua.app', 'run-as', "cat 'a b'")).toBe(
      `run-as ua.app sh -c 'cd /data/data/ua.app 2>/dev/null || cd /data/user/0/ua.app || exit 1; cat '\\''a b'\\'''`,
    );
    expect(sandboxCommand('ua.app', 'root', 'ls')).toMatch(/^su 0 sh -c /);
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it('puts a pushed file in place with the app’s rights, and as root gives it and its folders to the app', function () {
    expect(writeScript('run-as', 'shared_prefs/app.xml', '/data/local/tmp/s1')).toBe(
      "umask 007 && mkdir -p 'shared_prefs' && cat '/data/local/tmp/s1' > 'shared_prefs/app.xml'",
    );
    expect(writeScript('run-as', 'top.txt', '/data/local/tmp/s1')).toBe(
      "umask 007 && cat '/data/local/tmp/s1' > 'top.txt'",
    );
    expect(writeScript('root', 'files/datastore/a.preferences_pb', '/t')).toBe(
      "umask 007 && mkdir -p 'files/datastore' && cat '/t' > 'files/datastore/a.preferences_pb' && " +
        "chown $(stat -c %u:%g .) 'files' 'files/datastore' 'files/datastore/a.preferences_pb' && " +
        "(restorecon 'files' 'files/datastore' 'files/datastore/a.preferences_pb' 2>/dev/null; true)",
    );
  });

  it('reads the group containers of a simulator app', function () {
    expect(parseGroups('group.ua.pb\t/Users/x/AppGroup/1\n\n')).toEqual([
      {id: 'group.ua.pb', dir: '/Users/x/AppGroup/1'},
    ]);
  });

  it('reads the files devicectl lists, whatever it calls their fields', function () {
    const json = {
      result: {
        files: [
          {relativePath: 'Library/Preferences/ua.app.plist', fileSize: 120, lastModDate: '2026-10-27T10:00:00Z'},
          {relativePath: 'Documents', isDirectory: true, fileSize: 0},
          {name: './tmp/x.txt', size: 5},
        ],
      },
    };
    expect(parseDevicectlFiles(json)).toEqual([
      {path: 'Library/Preferences/ua.app.plist', size: 120, mtime: Date.parse('2026-10-27T10:00:00Z')},
      {path: 'tmp/x.txt', size: 5, mtime: 0},
    ]);
  });

  it('finds the app among the iPhone’s processes by its bundle folder', function () {
    const processes = {
      result: {
        runningProcesses: [
          {processIdentifier: 10, executable: 'file:///usr/libexec/backboardd'},
          {processIdentifier: 42, executable: 'file:///private/var/containers/Bundle/Application/AB/App.app/App'},
        ],
      },
    };
    expect(
      findAppProcess(processes, 'file:///private/var/containers/Bundle/Application/AB/App.app/').processIdentifier,
    ).toBe(42);
    expect(findAppProcess(processes, null)).toBe(null);
  });
});
