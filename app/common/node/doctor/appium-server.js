import {spawn} from 'node:child_process';
import {access, mkdir} from 'node:fs/promises';
import path from 'node:path';

import {findAndroidSdk} from './environment.js';
import {runTool, shellEnv} from './exec.js';
import {probeServer} from './servers.js';

// Installed when no Appium is found on the machine
export const MANAGED_APPIUM_SPEC = 'appium@^3';
const MAX_LOG_LINES = 3000;
const START_TIMEOUT_MS = 60000;
const isWindows = process.platform === 'win32';

export const SERVER_STATUS = {
  STOPPED: 'stopped',
  INSTALLING: 'installing',
  STARTING: 'starting',
  RUNNING: 'running',
  FAILED: 'failed',
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * An Appium server Vision Inspector runs itself: the one found on PATH, or one
 * it installs into its own folder (with drivers in its own APPIUM_HOME).
 */
export class ManagedAppium {
  constructor({dataDir, onLog = () => {}, onState = () => {}}) {
    this.installDir = path.join(dataDir, 'appium');
    this.appiumHome = path.join(dataDir, 'appium-home');
    this.onLog = onLog;
    this.onState = onState;
    this.logs = [];
    this.process = null;
    this.state = {status: SERVER_STATUS.STOPPED, port: null, binary: null, error: null};
  }

  get localEntry() {
    return path.join(this.installDir, 'node_modules', 'appium', 'index.js');
  }

  setState(patch) {
    this.state = {...this.state, ...patch};
    this.onState(this.state);
  }

  log(text, stream = 'out') {
    // Appium colours its log for terminals
    const lines = String(text)
      // oxlint-disable-next-line no-control-regex
      .replace(/\x1b\[[\d;]*m/g, '')
      .split('\n')
      .filter((line) => line.length);
    if (!lines.length) {
      return;
    }
    this.logs.push(...lines);
    if (this.logs.length > MAX_LOG_LINES) {
      this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
    }
    this.onLog({lines, stream});
  }

  async hasLocalInstall() {
    try {
      await access(this.localEntry);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The Appium to run: our own install if there is one, else the one on PATH.
   * Our own install runs on the Node.js built into the app (Electron run as
   * Node), so a Node version Appium does not support on the machine is no obstacle.
   */
  async resolveBinary() {
    if (await this.hasLocalInstall()) {
      return {binary: process.execPath, prefixArgs: [this.localEntry], local: true};
    }
    const which = await runTool(isWindows ? 'where' : 'which', ['appium']);
    return which.ok ? {binary: which.stdout.split('\n')[0].trim(), prefixArgs: [], local: false} : null;
  }

  async env(local) {
    const env = {...(await shellEnv())};
    if (local) {
      env.ELECTRON_RUN_AS_NODE = '1';
    }
    const sdk = await findAndroidSdk(env);
    // Appium refuses Android sessions without ANDROID_HOME even when the SDK is in the default place
    if (sdk?.exists && !env.ANDROID_HOME) {
      env.ANDROID_HOME = sdk.path;
    }
    if (local) {
      env.APPIUM_HOME = this.appiumHome;
    }
    return env;
  }

  runLogged(command, args, env) {
    return new Promise((resolve) => {
      const viaAppNode = command === process.execPath;
      // our own Appium runs as `<app> <entry> ...`; show it the way a person would type it
      const shown = viaAppNode ? ['appium', ...args.slice(1)] : [path.basename(command), ...args];
      this.log(`$ ${shown.join(' ')}`, 'cmd');
      const child = spawn(command, args, {env, shell: isWindows && !viaAppNode});
      child.stdout.on('data', (data) => this.log(data));
      child.stderr.on('data', (data) => this.log(data, 'err'));
      child.on('error', (error) => {
        this.log(error.message, 'err');
        resolve(false);
      });
      child.on('close', (code) => resolve(code === 0));
    });
  }

  /**
   * Installs Appium and the given drivers into the app's own folder.
   */
  async install(drivers = []) {
    if (this.process) {
      throw new Error('Stop the server before installing');
    }
    this.setState({status: SERVER_STATUS.INSTALLING, error: null});
    await mkdir(this.installDir, {recursive: true});
    await mkdir(this.appiumHome, {recursive: true});
    const env = await this.env(true);
    const npm = isWindows ? 'npm.cmd' : 'npm';
    let ok = await this.runLogged(npm, ['install', '--prefix', this.installDir, MANAGED_APPIUM_SPEC], env);
    for (const driver of drivers) {
      if (!ok) {
        break;
      }
      ok = await this.runLogged(process.execPath, [this.localEntry, 'driver', 'install', driver], env);
    }
    this.setState({status: ok ? SERVER_STATUS.STOPPED : SERVER_STATUS.FAILED, error: ok ? null : 'installFailed'});
    return ok;
  }

  /**
   * Installs a driver for the Appium that would be started.
   */
  async installDriver(driver) {
    const resolved = await this.resolveBinary();
    if (!resolved) {
      return false;
    }
    return await this.runLogged(
      resolved.binary,
      [...resolved.prefixArgs, 'driver', 'install', driver],
      await this.env(resolved.local),
    );
  }

  async start({port = 4723, extraArgs = []} = {}) {
    if (this.process) {
      return this.state;
    }
    const resolved = await this.resolveBinary();
    if (!resolved) {
      this.setState({status: SERVER_STATUS.FAILED, error: 'notInstalled'});
      return this.state;
    }
    // --allow-cors: the web build of the Inspector talks to the server from a browser page
    // session_discovery lets the doctor list the server's sessions (Appium 3 keeps it off by default)
    const args = ['--port', String(port), '--allow-cors', '--allow-insecure', '*:session_discovery', ...extraArgs];
    this.setState({status: SERVER_STATUS.STARTING, port, binary: resolved.binary, local: resolved.local, error: null});
    this.log(`$ appium ${args.join(' ')}`, 'cmd');

    const child = spawn(resolved.binary, [...resolved.prefixArgs, ...args], {
      env: await this.env(resolved.local),
      shell: isWindows && !resolved.local,
    });
    this.process = child;
    child.stdout.on('data', (data) => this.log(data));
    child.stderr.on('data', (data) => this.log(data, 'err'));
    child.on('error', (error) => {
      this.log(error.message, 'err');
      this.process = null;
      this.setState({status: SERVER_STATUS.FAILED, error: error.message});
    });
    child.on('exit', (code, signal) => {
      this.process = null;
      const stoppedByUs = this.state.status === SERVER_STATUS.STOPPED;
      this.log(`Appium exited (${signal ?? code})`, 'cmd');
      if (!stoppedByUs) {
        this.setState({status: SERVER_STATUS.FAILED, error: `exited:${signal ?? code}`});
      }
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (this.process === child && Date.now() < deadline) {
      const probe = await probeServer({hostname: '127.0.0.1', port, path: ''});
      if (probe.reachable) {
        this.setState({status: SERVER_STATUS.RUNNING, version: probe.version});
        return this.state;
      }
      await delay(500);
    }
    if (this.process === child) {
      this.stop();
      this.setState({status: SERVER_STATUS.FAILED, error: 'startTimeout'});
    }
    return this.state;
  }

  stop() {
    const child = this.process;
    this.setState({status: SERVER_STATUS.STOPPED});
    if (child) {
      child.kill('SIGTERM');
      // Appium normally exits on SIGTERM within a second or two; make sure it does
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 5000).unref();
    }
  }
}
