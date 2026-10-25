import {execFile} from 'node:child_process';
import path from 'node:path';

const ENV_START = '__VISION_ENV_START__';
const ENV_TIMEOUT_MS = 8000;

let shellEnvPromise = null;

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

async function readShellEnv() {
  let env = {...process.env};
  if (process.platform !== 'win32') {
    const shell = process.env.SHELL || '/bin/zsh';
    const result = await run(shell, ['-ilc', `printf %s ${ENV_START}; env -0`], {
      timeout: ENV_TIMEOUT_MS,
      env: process.env,
    });
    if (result.ok) {
      env = {...env, ...parseEnvOutput(result.stdout)};
    }
  }
  const extraDirs = androidToolDirs(env).filter((dir) => !(env.PATH || '').split(path.delimiter).includes(dir));
  if (extraDirs.length) {
    env.PATH = [env.PATH, ...extraDirs].filter(Boolean).join(path.delimiter);
  }
  return env;
}

/**
 * Runs a command and never throws: the result tells whether it ran, whether the
 * binary exists at all, and what it printed.
 */
export function run(command, args = [], {timeout = 15000, env, cwd} = {}) {
  return new Promise((resolve) => {
    execFile(command, args, {timeout, env, cwd, maxBuffer: 16 * 1024 * 1024}, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        missing: error?.code === 'ENOENT',
        timedOut: !!error?.killed,
        code: typeof error?.code === 'number' ? error.code : error ? null : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });
}

/**
 * Runs a command with the login shell environment.
 */
export async function runTool(command, args = [], options = {}) {
  return await run(command, args, {...options, env: await shellEnv()});
}
