import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';

import {modelName, modelOption, pickModel} from '../../shared/agent/model.js';
import {AcpClient} from './acp-client.js';

// The agent is Kiro CLI on its V3 engine, spoken to over ACP. One process
// serves every conversation of the station; it starts when the chat is first
// used and stops with the station. A process that died starts again with the
// next message, and the conversation is loaded back.

const INIT_TIMEOUT_MS = 30000;

export const KIRO_ARGS = ['acp', '--agent-engine=v3', '--auth-method=cli'];

const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), ms))]);

/**
 * Explains a Kiro failure in a word the chat turns into text: not signed in,
 * out of credits, no network, not installed.
 */
export function kiroProblem(error) {
  const text = `${error?.message ?? ''} ${JSON.stringify(error?.data ?? '')}`;
  if (error?.code === 'ENOENT' || /not found|ENOENT/i.test(text)) {
    return 'missing';
  }
  if (/auth|login|sign.?in|token.*(expired|invalid)|unauthori/i.test(text)) {
    return 'login';
  }
  if (/credit|quota|limit exceeded|usage limit|throttl/i.test(text)) {
    return 'credits';
  }
  if (/network|ENOTFOUND|ECONNRE|ETIMEDOUT|EAI_AGAIN|offline/i.test(text)) {
    return 'network';
  }
  if (/stopped|exited|not running/i.test(text)) {
    return 'stopped';
  }
  return 'other';
}

export class KiroAgent extends EventEmitter {
  /**
   * @param {object} options
   * @param {() => Promise<string>} options.binary the kiro-cli to run
   * @param {() => Promise<object>} options.env the environment of the process
   * @param {(params: object) => Promise<{optionId: string} | null>} options.onPermission the station's answer, or null to cancel
   * @param {(url: string) => Promise<void>} [options.onOpenUrl]
   * @param {typeof spawn} [options.spawnProcess]
   */
  constructor({binary, env, onPermission, onOpenUrl = async () => {}, spawnProcess = spawn}) {
    super();
    this.binary = binary;
    this.env = env;
    this.onPermission = onPermission;
    this.onOpenUrl = onOpenUrl;
    this.spawnProcess = spawnProcess;
    this.child = null;
    this.client = null;
    this.starting = null;
    this.info = null;
  }

  get running() {
    return !!this.client && !this.client.closed;
  }

  /** Starts the process and says hello, once; later calls wait for the same start. */
  async start() {
    if (this.running) {
      return this.info;
    }
    if (!this.starting) {
      this.starting = this.launch().finally(() => {
        this.starting = null;
      });
    }
    return await this.starting;
  }

  async launch() {
    const child = this.spawnProcess(await this.binary(), KIRO_ARGS, {
      env: await this.env(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const failed = new Promise((_resolve, reject) => child.once('error', reject));
    failed.catch(() => {});
    const client = new AcpClient(child, (method, params) => this.answer(method, params));
    client.on('notification', (method, params) => this.notice(method, params));
    child.stderr?.on('data', () => {});
    child.once('exit', (code) => {
      client.close(`The agent stopped (exit ${code})`);
      if (this.client === client) {
        this.client = null;
        this.emit('exit', code);
      }
    });
    this.child = child;
    this.client = client;
    const hello = client.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: {readTextFile: false, writeTextFile: false},
        terminal: false,
        _meta: {kiro: {openExternalUrl: true}},
      },
      clientInfo: {name: 'station', version: '1'},
    });
    const result = await withTimeout(Promise.race([hello, failed]), INIT_TIMEOUT_MS, 'Kiro did not answer in time');
    this.info = {
      protocolVersion: result?.protocolVersion,
      extensions: new Set(result?.agentCapabilities?._meta?.kiro?.extensionMethods ?? []),
      loadSession: !!result?.agentCapabilities?.loadSession,
    };
    return this.info;
  }

  async answer(method, params) {
    if (method === 'session/request_permission') {
      const choice = await this.onPermission(params);
      return {outcome: choice ? {outcome: 'selected', optionId: choice.optionId} : {outcome: 'cancelled'}};
    }
    if (method === '_kiro/openExternalUrl') {
      await this.onOpenUrl(params.url);
      return {};
    }
    throw Object.assign(new Error(`Not supported: ${method}`), {code: -32601});
  }

  notice(method, params) {
    if (method === 'session/update') {
      this.emit('update', params.sessionId, params.update);
    } else if (method === '_kiro/mcp/status') {
      this.emit('mcpStatus', params.sessionId, params.servers ?? []);
    }
  }

  async request(method, params) {
    await this.start();
    return await this.client.request(method, params);
  }

  /**
   * A new conversation on the pinned model; content collection is turned off
   * when Kiro offers the switch. `model` is the name of the model it runs on.
   */
  async newSession({cwd, additionalDirectories = [], mcpServers = [], model = null}) {
    const result = await this.request('session/new', {cwd, additionalDirectories, mcpServers});
    await this.keepPrivate(result.sessionId, result.configOptions);
    return {...result, model: await this.pinModel(result.sessionId, result.configOptions, model)};
  }

  /** An earlier conversation, with its folders and servers given again: Kiro does not keep them. */
  async loadSession({sessionId, cwd, additionalDirectories = [], mcpServers = [], model = null}) {
    const result = await this.request('session/load', {sessionId, cwd, additionalDirectories, mcpServers});
    await this.keepPrivate(sessionId, result?.configOptions);
    return {...result, sessionId, model: await this.pinModel(sessionId, result?.configOptions, model)};
  }

  /** Sets the wanted model (or the nearest one offered); the name of the model the session is on. */
  async pinModel(sessionId, options, wanted) {
    const option = modelOption(options);
    const value = option
      ? pickModel(
          (option.options ?? []).map((one) => one.value),
          wanted,
        )
      : null;
    if (!value || value === option.currentValue) {
      return modelName(option);
    }
    const changed = await this.setConfig(sessionId, 'model', value).catch(() => null);
    return changed ? modelName({...option, currentValue: value}) : modelName(option);
  }

  async keepPrivate(sessionId, options = []) {
    const collection = options?.find((option) => option.id === 'contentCollection');
    if (collection && collection.currentValue !== 'disabled') {
      await this.setConfig(sessionId, 'contentCollection', 'disabled').catch(() => null);
    }
  }

  setConfig(sessionId, configId, value) {
    return this.request('session/set_config_option', {sessionId, configId, value});
  }

  /** Sends a message; resolves when the turn ends, with its stop reason. */
  prompt(sessionId, prompt) {
    return this.request('session/prompt', {sessionId, prompt});
  }

  cancel(sessionId) {
    this.client?.notify('session/cancel', {sessionId});
  }

  /** The plan of the account: credits used, the limit, when it resets. */
  async usage() {
    // Kiro answers it without listing it among its extensions
    try {
      return await this.request('_kiro/account/getUsage', {});
    } catch {
      return null;
    }
  }

  stop() {
    this.client?.close('The station stopped the agent');
    this.child?.kill();
    this.client = null;
    this.child = null;
  }
}
