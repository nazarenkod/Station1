import {spawn} from 'node:child_process';
import path from 'node:path';

import {commandOutcome, describeCommand} from '../../shared/journal.js';
import {journal, setSummary} from '../journal.js';

const ENV_START = '__VISION_ENV_START__';
const ENV_TIMEOUT_MS = 8000;
const MAX_OUTPUT = 16 * 1024 * 1024;

let shellEnvPromise = null;
let shellEnvProblem = null;

/**
 * Parses the NUL-separated output of `env -0` into an object.
 */
export function parseEnvOutput(output) {
  const start = output.indexOf(ENV_START);
  const body = start >= 0 ? output.slice(start + ENV_START.length) : output;
  const env = {};
  for (const entry of body.split('\0')) {
    const cleanEntry = entry.replace(/^\n+/, '');
    const separator = cleanEntry.indexOf('=');
    if (separator > 0) {
      env[cleanEntry.slice(0, separator)] = cleanEntry.slice(separator + 1);
    }
  }
  return env;
}

/**
 * Directories of the Android SDK tools that are often missing from PATH even
 * when ANDROID_HOME is set.
 */
export function androidToolDirs(env) {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  return sdk ? [path.join(sdk, 'platform-tools'), path.join(sdk, 'emulator')] : [];
}

/**
 * The environment a terminal would have. A GUI app on macOS starts with a bare
 * PATH, so tools installed through Homebrew, nvm or the Android SDK would not be
 * found without reading the login shell environment once.
 */
export function shellEnv() {
  if (!shellEnvPromise) {
    shellEnvPromise = readShellEnv();
  }
  return shellEnvPromise;
}

/**
 * Why the login shell environment could not be read, or null when it was.
 */
export async function shellEnvFailure() {
  await shellEnv();
  return shellEnvProblem;
}

async function readShellEnv() {
  let env = {...process.env};
  if (process.platform !== 'win32') {
    const shell = process.env.SHELL || '/bin/zsh';
    const started = Date.now();
    const result = await run(shell, ['-ilc', `printf %s ${ENV_START}; env -0`], {
      timeout: ENV_TIMEOUT_MS,
      env: process.env,
    });
    setSummary({shell, shellEnv: {ok: result.ok, ms: Date.now() - started, timedOut: result.timedOut}});
    if (result.ok) {
      env = {...env, ...parseEnvOutput(result.stdout)};
    } else {
      // the tools are looked up on the app's bare PATH then; the doctor says why
      shellEnvProblem = {shell, timedOut: result.timedOut, seconds: ENV_TIMEOUT_MS / 1000};
    }
  }
  const extraDirs = androidToolDirs(env).filter((dir) => !(env.PATH || '').split(path.delimiter).includes(dir));
  if (extraDirs.length) {
    env.PATH = [env.PATH, ...extraDirs].filter(Boolean).join(path.delimiter);
  }
  setSummary({path: env.PATH, androidHome: env.ANDROID_HOME || env.ANDROID_SDK_ROOT, javaHome: env.JAVA_HOME});
  return env;
}

/**
 * Runs a command and never throws: the result tells whether it ran, whether the
 * binary exists at all, and what it printed.
 *
 * It always ends by the timeout. stdin is closed, so a prompt in a shell
 * profile reads nothing instead of waiting; on timeout the whole process group
 * is killed with SIGKILL, because an interactive shell ignores SIGTERM and a
 * background job it started may hold the output open.
 *
 * `quiet` keeps a command polled every second out of the journal, unless it fails.
 */
export function run(command, args = [], {timeout = 15000, env, cwd, quiet = false} = {}) {
  return new Promise((resolve) => {
    const out = [];
    const err = [];
    let size = 0;
    let timedOut = false;
    let done = false;
    let timer = null;
    const group = process.platform !== 'win32';

    // the journal shows the command while it runs, then how it ended
    const begin = () =>
      journal.begin({
        source: 'command',
        text: describeCommand(command, args),
        detail: cwd && `cwd: ${cwd}`,
      });
    const record = quiet ? null : begin();

    const finish = (result) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      const full = {
        timedOut,
        stdout: Buffer.concat(out).toString(),
        stderr: Buffer.concat(err).toString(),
        ...result,
      };
      if (!quiet || !full.ok) {
        journal.end(record ?? begin(), commandOutcome(full));
      }
      resolve(full);
    };

    let child;
    try {
      child = spawn(command, args, {env, cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: group});
    } catch (error) {
      finish({ok: false, missing: error?.code === 'ENOENT', code: null});
      return;
    }

    const kill = () => {
      try {
        if (group && child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // already gone
      }
    };

    const collect = (chunks) => (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) {
        kill();
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));

    child.once('error', (error) => finish({ok: false, missing: error?.code === 'ENOENT', code: null}));
    child.once('close', (code) => finish({ok: code === 0 && !timedOut, missing: false, code: timedOut ? null : code}));

    timer = setTimeout(() => {
      timedOut = true;
      kill();
      // a process that outlives the kill must not hold the caller
      child.stdout.destroy();
      child.stderr.destroy();
      finish({ok: false, missing: false, code: null});
    }, timeout);
  });
}

/**
 * Runs a command with the login shell environment.
 */
export async function runTool(command, args = [], options = {}) {
  return await run(command, args, {...options, env: await shellEnv()});
}
