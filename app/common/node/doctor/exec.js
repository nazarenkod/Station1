import {spawn} from 'node:child_process';
import path from 'node:path';

import {commandOutcome, describeCommand} from '../../shared/journal.js';
import {journal, setSummary} from '../journal.js';

const ENV_START = '__VISION_ENV_START__';
const ENV_TIMEOUT_MS = 8000;
// a second try, asked by a recheck, waits longer: a cold ~/.zshrc with jenv or nvm can take that
const ENV_RETRY_TIMEOUT_MS = 20000;
const MAX_OUTPUT = 16 * 1024 * 1024;

let shellEnvPromise = null;
let shellEnvProblem = null;
let shellEnvRead = null;

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
 * The environment of the app without what `npm run` puts in it when the
 * station is started from its repository: the `node_modules/.bin` chain at
 * the head of PATH would find the project's own tools first, and the
 * `npm_*` variables (npm_config_prefix above all) break nvm in a shell profile.
 */
export function withoutNpmRun(env) {
  const clean = Object.fromEntries(Object.entries(env ?? {}).filter(([name]) => !/^npm_/i.test(name)));
  if (clean.PATH) {
    clean.PATH = clean.PATH.split(path.delimiter)
      .filter((dir) => dir && !/[\\/]node_modules[\\/]\.bin$/.test(dir) && !/@npmcli[\\/]run-script/.test(dir))
      .filter((dir, index, all) => all.indexOf(dir) === index)
      .join(path.delimiter);
  }
  return clean;
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
    shellEnvPromise = readShellEnv(ENV_TIMEOUT_MS);
  }
  return shellEnvPromise;
}

/**
 * How the terminal environment was read: the shell, whether it worked and
 * how long it took. Null where there is no login shell to read (Windows).
 */
export async function shellEnvStatus() {
  await shellEnv();
  return shellEnvRead;
}

/**
 * Reads the terminal environment again, waiting longer, when the first read
 * failed: until then every tool runs without its PATH and JAVA_HOME, and only
 * a restart of the station would bring them back.
 */
export async function rereadShellEnvIfFailed() {
  await shellEnv();
  if (shellEnvProblem) {
    shellEnvProblem = null;
    shellEnvPromise = readShellEnv(ENV_RETRY_TIMEOUT_MS);
  }
  return await shellEnvPromise;
}

/**
 * Why the login shell environment could not be read, or null when it was.
 */
export async function shellEnvFailure() {
  await shellEnv();
  return shellEnvProblem;
}

async function readShellEnv(timeout) {
  const base = withoutNpmRun(process.env);
  let env = {...base};
  if (process.platform !== 'win32') {
    const shell = process.env.SHELL || '/bin/zsh';
    const started = Date.now();
    const result = await run(shell, ['-ilc', `printf %s ${ENV_START}; env -0`], {
      timeout,
      env: base,
    });
    shellEnvRead = {shell, ok: result.ok, ms: Date.now() - started, timedOut: result.timedOut};
    setSummary({shell, shellEnv: shellEnvRead});
    if (result.ok) {
      env = withoutNpmRun({...env, ...parseEnvOutput(result.stdout)});
    } else {
      // the tools are looked up on the app's bare PATH then; the doctor says why
      shellEnvProblem = {shell, timedOut: result.timedOut, seconds: timeout / 1000};
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
 * `input` is written to stdin instead of closing it; `maxOutput` lets a file
 * pulled from a device be larger; the raw bytes are in `stdoutBuffer`.
 */
export function run(
  command,
  args = [],
  {timeout = 15000, env, cwd, quiet = false, input = null, maxOutput = MAX_OUTPUT} = {},
) {
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
      const stdoutBuffer = Buffer.concat(out);
      const full = {
        timedOut,
        stdout: stdoutBuffer.toString(),
        stderr: Buffer.concat(err).toString(),
        ...result,
      };
      // the bytes for a pulled file; hidden, so results spread or sent over IPC stay small
      Object.defineProperty(full, 'stdoutBuffer', {value: stdoutBuffer, enumerable: false});
      if (!quiet || !full.ok) {
        journal.end(record ?? begin(), commandOutcome(full));
      }
      resolve(full);
    };

    let child;
    try {
      child = spawn(command, args, {
        env,
        cwd,
        stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        detached: group,
      });
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
      if (size > maxOutput) {
        kill();
        return;
      }
      chunks.push(chunk);
    };
    if (input !== null) {
      // a command that exits before reading all of it must not crash the station
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
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
