import {z} from 'zod';

import {commandFor, fixKey, TERMINAL_ONLY} from '../../shared/doctor/fix-commands.js';

// The environment tools of the agent: the doctor's checks with the fix the
// station knows for each, and running one of those fixes. Only known fixes
// run, each after the person's yes, with the exact command on the card.

const FIX_TIMEOUT_MS = 15 * 60 * 1000;
const OUTPUT = 3000;

const platform = () => (process.platform === 'win32' ? 'win' : 'mac');

/**
 * @param {object} deps
 * @param {() => Promise<{checks: object[]}>} deps.check the doctor's environment checks
 * @param {(driver: string) => Promise<{ok: boolean, stdout: string}>} deps.installDriver the Appium of the station, with its output
 * @param {() => Promise<{ok: boolean, stdout: string}>} deps.installAppium
 * @param {(command: string, options: object) => Promise<object>} deps.runShell a login shell command
 * @param {() => void} deps.onFixed the station checks again
 */
export function envTools(deps) {
  // what fixes a check: an action of the station, or a command of the shell
  const fixOf = (check) => {
    if (check.fix?.action === 'installDriver') {
      return {kind: 'installDriver', driver: check.fix.driver, command: `appium driver install ${check.fix.driver}`};
    }
    if (check.id === 'appiumMissing') {
      return {
        kind: 'installAppium',
        command: 'npm install appium@^3 (into the station) && appium driver install uiautomator2 xcuitest',
      };
    }
    const key = fixKey(check);
    const command = commandFor(key, check.params, platform());
    if (!command) {
      return null;
    }
    return {kind: TERMINAL_ONLY.has(key) ? 'terminal' : 'shell', command};
  };

  const find = async (id, driver) => {
    const {checks} = await deps.check();
    return checks.find((one) => one.id === id && (!driver || one.params?.driver === driver)) ?? null;
  };

  return [
    {
      name: 'env_check',
      readOnly: true,
      description:
        'The doctor of this Mac: every check (Node.js, Appium and drivers, Android SDK, adb, Java, Xcode, Kiro CLI) with its status and the fix the station knows. Run it before and after a fix.',
      input: {},
      run: async () => {
        const {checks} = await deps.check();
        return checks.map((check) => ({
          id: check.id,
          status: check.status,
          params: check.params,
          fix: check.status === 'ok' ? undefined : (fixOf(check)?.command ?? 'none known: guide the engineer'),
          runs:
            check.status === 'ok'
              ? undefined
              : fixOf(check)?.kind === 'terminal'
                ? 'in a terminal, by the engineer'
                : 'env_run_fix',
        }));
      },
    },
    {
      name: 'env_run_fix',
      readOnly: false,
      description:
        'Runs the fix the station knows for one failing doctor check (id from env_check; driver for a driver check). The engineer approves the exact command first. Fixes that ask for a password or a sign-in are not run: give the engineer the command for a terminal.',
      input: {check: z.string(), driver: z.string().optional()},
      run: async ({check: id, driver}) => {
        const check = await find(id, driver);
        if (!check) {
          return `No check ${id}${driver ? ` for ${driver}` : ''}; read env_check again.`;
        }
        if (check.status === 'ok') {
          return `${id} is fine already.`;
        }
        const fix = fixOf(check);
        if (!fix) {
          return `The station knows no fix for ${id}; guide the engineer instead.`;
        }
        if (fix.kind === 'terminal') {
          return `This fix asks the engineer something; give them the command to run in a terminal: ${fix.command}`;
        }
        const result =
          fix.kind === 'installDriver'
            ? await deps.installDriver(fix.driver)
            : fix.kind === 'installAppium'
              ? await deps.installAppium()
              : await deps.runShell(fix.command, {timeout: FIX_TIMEOUT_MS});
        deps.onFixed();
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(-OUTPUT);
        return `${result.ok ? 'Ran' : result.timedOut ? 'Timed out' : 'Failed'}: ${fix.command}\n${output || '(no output)'}\nCheck again with env_check.`;
      },
      // what the person sees before saying yes
      preview: async ({check: id, driver}) => {
        const check = await find(id, driver);
        const fix = check && fixOf(check);
        return fix && fix.kind !== 'terminal' ? {command: fix.command} : null;
      },
    },
  ];
}
