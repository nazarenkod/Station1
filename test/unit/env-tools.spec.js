import {describe, expect, it, vi} from 'vitest';

vi.mock('../../app/common/renderer/polyfills.js', () => ({backend: null}));
// nothing on PATH: the doctor sees only what the station itself has
vi.mock('../../app/common/node/doctor/exec.js', () => ({
  run: vi.fn(async (_command, args) =>
    args.includes('-v')
      ? {ok: true, stdout: '3.9.0\n'}
      : {ok: true, stdout: JSON.stringify({uiautomator2: {installed: true, version: '8.7.2'}})},
  ),
  runTool: vi.fn(async () => ({ok: false, missing: true, stdout: '', stderr: ''})),
  shellEnv: vi.fn(async () => ({})),
  shellEnvFailure: vi.fn(async () => null),
  shellEnvStatus: vi.fn(async () => ({shell: '/bin/zsh', ok: true, ms: 3240, timedOut: false})),
  rereadShellEnvIfFailed: vi.fn(async () => ({})),
}));
vi.mock('../../app/common/node/agent/kiro-doctor.js', () => ({checkKiro: async () => ({id: 'kiro', status: 'ok'})}));

import {envTools} from '../../app/common/node/agent/env-tools.js';
import {checkEnvironment, homeShort} from '../../app/common/node/doctor/environment.js';
import * as exec from '../../app/common/node/doctor/exec.js';
import {doctorSeverity} from '../../app/common/renderer/components/Desk/doctor-store.js';

const CHECKS = [
  {id: 'node', status: 'ok', params: {version: '22.12.0'}},
  {id: 'driver', status: 'warn', params: {driver: 'xcuitest'}, fix: {action: 'installDriver', driver: 'xcuitest'}},
  {id: 'java', status: 'warn', params: {version: '17'}},
  {id: 'xcode', status: 'error', params: {path: '/Library/Developer/CommandLineTools'}},
  {id: 'androidSdk', status: 'error'},
];

const setup = (checks = CHECKS) => {
  const deps = {
    check: vi.fn(async () => ({checks})),
    installDriver: vi.fn(async () => ({ok: true, stdout: 'Driver xcuitest installed'})),
    installAppium: vi.fn(async () => ({ok: false, stdout: 'npm ERR! code EACCES'})),
    runShell: vi.fn(async () => ({ok: true, stdout: 'done\n', stderr: ''})),
    onFixed: vi.fn(),
  };
  const tools = Object.fromEntries(envTools(deps).map((tool) => [tool.name, tool]));
  return {deps, tools};
};

describe('env_check', () => {
  it('reads the doctor with the fix for each problem', async () => {
    const {tools} = setup();
    expect(tools.env_check.readOnly).toBe(true);
    const checks = await tools.env_check.run({});
    expect(checks[0]).toMatchObject({id: 'node', status: 'ok'});
    expect(checks[0].fix).toBeUndefined();
    expect(checks.find((c) => c.id === 'driver')).toMatchObject({
      fix: 'appium driver install xcuitest',
      runs: 'env_run_fix',
    });
    // a found Java without JAVA_HOME is fixed by setting it
    expect(checks.find((c) => c.id === 'java').fix).toContain('JAVA_HOME');
    // sudo asks a password: the engineer runs it
    expect(checks.find((c) => c.id === 'xcode').runs).toContain('terminal');
  });
});

describe('env_run_fix', () => {
  it('asks the person and shows the exact command first', async () => {
    const {tools} = setup();
    expect(tools.env_run_fix.readOnly).toBe(false);
    expect(await tools.env_run_fix.preview({check: 'androidSdk'})).toEqual({
      command: 'brew install --cask android-studio',
    });
    expect(await tools.env_run_fix.preview({check: 'xcode'})).toBeNull();
  });

  it('runs the known command in a login shell and checks again', async () => {
    const {tools, deps} = setup();
    const text = await tools.env_run_fix.run({check: 'androidSdk'});
    expect(deps.runShell).toHaveBeenCalledWith('brew install --cask android-studio', expect.any(Object));
    expect(deps.onFixed).toHaveBeenCalled();
    expect(text).toContain('Ran: brew install --cask android-studio');
    expect(text).toContain('done');
  });

  it('installs a driver through the Appium of the station', async () => {
    const {tools, deps} = setup();
    expect(await tools.env_run_fix.run({check: 'driver', driver: 'xcuitest'})).toContain('Ran');
    expect(deps.installDriver).toHaveBeenCalledWith('xcuitest');
    expect(deps.runShell).not.toHaveBeenCalled();
  });

  it('runs nothing for a fix that asks the engineer, a fine check or an unknown one', async () => {
    const {tools, deps} = setup();
    expect(await tools.env_run_fix.run({check: 'xcode'})).toContain('terminal');
    expect(await tools.env_run_fix.run({check: 'node'})).toContain('fine');
    expect(await tools.env_run_fix.run({check: 'gradle'})).toContain('No check');
    expect(deps.runShell).not.toHaveBeenCalled();
    expect(deps.onFixed).not.toHaveBeenCalled();
  });

  it('passes on why an install of Appium failed', async () => {
    const {tools} = setup([{id: 'appiumMissing', status: 'warn'}]);
    expect(await tools.env_run_fix.run({check: 'appiumMissing'})).toMatch(/^Failed: [^]*EACCES/);
  });

  it('says when the fix failed', async () => {
    const {tools, deps} = setup();
    deps.runShell.mockResolvedValue({ok: false, stdout: '', stderr: 'brew: command not found'});
    expect(await tools.env_run_fix.run({check: 'androidSdk'})).toMatch(/^Failed: [^]*command not found/);
  });
});

describe('doctorSeverity', () => {
  it('is the worst status of the problems, the Appium server among them', () => {
    expect(doctorSeverity({checks: CHECKS})).toBe('error');
    expect(doctorSeverity({checks: CHECKS.slice(0, 3)})).toBe('warn');
    expect(doctorSeverity({checks: CHECKS.slice(0, 1)}, {status: 'failed'})).toBe('error');
  });
});

describe('the doctor checks the Appium the station starts', () => {
  const own = {
    resolveBinary: async () => ({binary: '/Electron', prefixArgs: ['/appium/main.js'], local: true}),
    env: async () => ({ELECTRON_RUN_AS_NODE: '1'}),
  };

  it('counts the station’s own Appium and its drivers, though none is on PATH', async () => {
    const {checks} = await checkEnvironment({appium: own});
    expect(checks.find((c) => c.id.startsWith('appium'))).toMatchObject({
      id: 'appium',
      status: 'ok',
      params: {version: '3.9.0', own: true},
    });
    expect(checks.find((c) => c.params?.driver === 'uiautomator2')).toMatchObject({status: 'ok'});
  });

  it('finds Appium missing when the station has none and PATH has none', async () => {
    const {checks} = await checkEnvironment({appium: {resolveBinary: async () => null}});
    expect(checks.find((c) => c.id.startsWith('appium'))).toMatchObject({id: 'appiumMissing'});
  });
});

describe('the terminal environment in the doctor', () => {
  it('is always a row, with how long it took to read', async () => {
    const {checks} = await checkEnvironment({appium: {resolveBinary: async () => null}});
    expect(checks[0]).toEqual({id: 'shellEnv', status: 'ok', params: {shell: '/bin/zsh', name: 'zsh', seconds: '3.2'}});
  });

  it('is read again on every check while it has not loaded, and says why it did not', async () => {
    exec.shellEnvFailure.mockResolvedValueOnce({shell: '/bin/zsh', timedOut: true, seconds: 20});
    const before = exec.rereadShellEnvIfFailed.mock.calls.length;
    const {checks} = await checkEnvironment({appium: {resolveBinary: async () => null}});
    expect(exec.rereadShellEnvIfFailed.mock.calls.length).toBe(before + 1);
    expect(checks[0]).toEqual({
      id: 'shellEnv',
      status: 'warn',
      params: {shell: '/bin/zsh', timedOut: true, seconds: 20},
    });
  });
});

describe('the Android SDK in the doctor', () => {
  it('shows its path with the home folder as ~', () => {
    expect(homeShort('/Users/qa/Library/Android/sdk', '/Users/qa')).toBe('~/Library/Android/sdk');
    expect(homeShort('/opt/android-sdk', '/Users/qa')).toBe('/opt/android-sdk');
  });
});
