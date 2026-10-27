import {parseVersion} from '../doctor/environment.js';
import {runTool} from '../doctor/exec.js';

// Whether the agent can work on this Mac: kiro-cli is there, its V3 engine
// answers over ACP, and someone is signed in. Each problem says how to fix it.

/**
 * The check from what the commands said.
 * @param {{version: object | null, acpHelp: string, whoami: {ok: boolean}}} found
 */
export function kiroCheck({version, acpHelp, whoami}) {
  if (!version) {
    return {id: 'kiroMissing', status: 'warn'};
  }
  const params = {version: version.raw};
  if (!/\bv3\b/.test(acpHelp ?? '')) {
    return {id: 'kiroV3', status: 'warn', params};
  }
  if (!whoami?.ok) {
    return {id: 'kiroLogin', status: 'warn', params};
  }
  return {id: 'kiro', status: 'ok', params};
}

export async function checkKiro() {
  const version = await runTool('kiro-cli', ['--version']);
  if (!version.ok) {
    return kiroCheck({version: null});
  }
  const [acpHelp, whoami] = await Promise.all([
    runTool('kiro-cli', ['acp', '--help']),
    runTool('kiro-cli', ['whoami'], {timeout: 20000}),
  ]);
  return kiroCheck({version: parseVersion(version.stdout), acpHelp: acpHelp.stdout, whoami});
}
