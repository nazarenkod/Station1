import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {
  actionLine,
  allowedTools,
  failureHint,
  groupOf,
  HANDS_LIMIT,
  HANDS_SERVER,
  handsVerdict,
  shortAnswer,
} from '../../shared/agent/hands.js';
import {cleanPlaybook} from '../../shared/agent/playbook.js';
import {maskText} from '../../shared/agent/privacy.js';
import plugin from './hands-plugin.mjs?raw';

// The agent's hands, on the station's side: appium-mcp installed in the
// station's own folder, the server each conversation gets, and the station's
// answers to the plugin: before an action whether it may go, after it what
// the agent hears and what the station notes of it.

export const HANDS_SPEC = 'appium-mcp@1.99.1';
const PLUGIN_FILE = 'station-hands.mjs';

const INSTRUCTIONS =
  "You act on the station's Appium session only. Attach to it first as the station says, never create or delete a session. " +
  "See the screen with the station's screen_current (or generate_locators for locators); sign in with the station's app_login, never type a password.";

/**
 * @param {object} deps
 * @param {string} deps.dir the hands folder, `<userData>/hands`
 * @param {string} deps.node the Node to run the hands with: Electron run as Node
 * @param {(command: string, args: string[]) => Promise<boolean>} deps.npm installs, with the output going to the log
 * @param {(kind: string, args?: object) => Promise<any>} deps.ask the window: `session`, `elementAt`, `handsStep`
 * @param {() => Promise<object>} deps.playbook the playbook of the profile that is on
 * @param {() => Promise<string[]>} deps.builds the build files of the project's app the station knows
 * @param {() => Promise<number>} [deps.limit] actions in a turn before the agent asks for more
 * @param {(conversation: string) => number} [deps.turnOf]
 * @param {(conversation: string, step: object) => void} [deps.onStep] an action was done
 * @param {(conversation: string) => Promise<boolean>} [deps.askMore] the limit is reached: the person says whether to go on
 * @param {(entry: object) => void} [deps.log] the station journal
 * @param {() => Promise<RegExp[]>} [deps.masks] what the station hides in what goes to the agent
 */
export function createHands(deps) {
  const conversations = new Map();
  let installing = null;

  const stateOf = (conversation) => {
    if (!conversations.has(conversation)) {
      conversations.set(conversation, {count: 0, extra: 0, stopped: false, before: null});
    }
    return conversations.get(conversation);
  };

  const entry = path.join(deps.dir, 'node_modules', 'appium-mcp', 'dist', 'core.js');
  const pluginPath = path.join(deps.dir, PLUGIN_FILE);

  const installed = async () => {
    try {
      await access(entry);
      return true;
    } catch {
      return false;
    }
  };

  const writePlugin = async () => {
    const before = await readFile(pluginPath, 'utf8').catch(() => null);
    if (before !== plugin) {
      await mkdir(deps.dir, {recursive: true});
      await writeFile(pluginPath, plugin);
    }
  };

  const hands = {
    async status() {
      return {installed: await installed(), installing: !!installing, spec: HANDS_SPEC};
    },

    /** Installs appium-mcp in the station's folder, once at a time. */
    async install() {
      installing ??= (async () => {
        await mkdir(deps.dir, {recursive: true});
        const ok = await deps.npm('npm', ['install', '--prefix', deps.dir, '--no-audit', '--no-fund', HANDS_SPEC]);
        if (ok) {
          await writePlugin();
        }
        return ok;
      })().finally(() => {
        installing = null;
      });
      return {ok: await installing, ...(await hands.status())};
    },

    /**
     * The hands for `session/new`, or null when they are not installed. The
     * tools the agent sees follow the project's permissions at this moment.
     */
    async server(conversation, {port, token}) {
      if (!(await installed())) {
        return null;
      }
      await writePlugin();
      const book = cleanPlaybook(await deps.playbook());
      const env = {
        ELECTRON_RUN_AS_NODE: '1',
        HANDS_HOME: deps.dir,
        HANDS_TOOLS: allowedTools(book.permissions).join(','),
        HANDS_INSTRUCTIONS: INSTRUCTIONS,
        STATION_HANDS_URL: `http://127.0.0.1:${port}/hands/${encodeURIComponent(conversation)}`,
        STATION_TOKEN: token,
        // text answers only: the HTML viewers cost tokens and nobody sees them
        NO_UI: 'true',
        // the session is the Inspector's: a conversation that ends leaves it be
        APPIUM_MCP_ON_CLIENT_DISCONNECT: 'skip',
        ALLOW_REMOTE_APP_URLS: 'false',
        REMOTE_SERVER_URL_ALLOW_REGEX: '^http://127\\.0\\.0\\.1:\\d+(/.*)?$',
        APPIUM_MCP_DOCS_ENABLED: 'false',
        AI_VISION_ENABLED: 'false',
      };
      return {
        name: HANDS_SERVER,
        command: deps.node,
        args: [pluginPath],
        env: Object.entries(env).map(([name, value]) => ({name, value})),
      };
    },

    /** A new turn: the count of actions starts again, and a «Stop» is lifted. */
    startTurn(conversation) {
      const state = stateOf(conversation);
      state.count = 0;
      state.extra = 0;
      state.stopped = false;
    },

    stop(conversation) {
      stateOf(conversation).stopped = true;
    },

    stopped: (conversation) => stateOf(conversation).stopped,

    /** Before an action: whether it may go. */
    async check(conversation, {tool, args = {}, active = null, element = null}) {
      const state = stateOf(conversation);
      const session = await deps.ask('session').catch(() => null);
      const group = groupOf(tool, args);
      let touched = element;
      if (!touched && Number.isFinite(args.x) && Number.isFinite(args.y) && group === 'act') {
        touched = await deps.ask('elementAt', {x: args.x, y: args.y}).catch(() => null);
      }
      const verdict = handsVerdict({
        tool,
        args,
        expected: session?.sessionId ? {serverUrl: session.serverUrl, sessionId: session.sessionId} : null,
        active,
        stopped: state.stopped,
        playbook: cleanPlaybook(await deps.playbook()),
        appId: session?.appId ?? null,
        element: touched,
        screen: session?.screen?.title ?? null,
        builds: await deps.builds(),
      });
      if (!verdict.ok) {
        return verdict;
      }
      // what only reads, and joining the session, is not an action on the device
      if (!['look', 'session'].includes(group)) {
        const limit = ((await deps.limit?.()) ?? HANDS_LIMIT) + state.extra;
        if (state.count >= limit) {
          const more = (await deps.askMore?.(conversation)) ?? false;
          if (!more || state.stopped) {
            return {
              ok: false,
              text: `The user stopped the actions at ${state.count} in this turn: sum up what was done and what is left.`,
            };
          }
          state.extra += HANDS_LIMIT;
        }
        state.count += 1;
      }
      state.before = session?.screen ?? null;
      return {ok: true, element: touched};
    },

    /** After an action: the step for the chat, the screens and the journal; the short answer for the agent. */
    async done(conversation, {tool, args = {}, ok = true, text = '', element = null}) {
      const state = stateOf(conversation);
      const group = groupOf(tool, args);
      const masks = (await deps.masks?.().catch(() => null)) ?? undefined;
      const hidden = maskText(String(text ?? ''), masks);
      // what only reads is data: it goes through the read budget of the turn, as the station's reads do
      if (['look', 'session'].includes(group)) {
        return {text: hidden, read: group === 'look'};
      }
      const line = actionLine(tool, args, element);
      const after = await deps.ask('handsStep', {line, ok}).catch(() => null);
      const step = {
        at: Date.now(),
        conversation,
        turn: deps.turnOf?.(conversation) ?? 0,
        tool,
        line,
        ok,
        screenBefore: state.before?.title ?? null,
        screenAfter: after?.screen?.title ?? null,
        // where the chat opens the step in the screens of the session
        screenKey: after?.key ?? null,
        stateId: after?.stateId ?? null,
      };
      deps.onStep?.(conversation, step);
      deps.log?.({level: ok ? 'info' : 'warn', source: 'station', text: `Operator: ${line}${ok ? '' : ' (failed)'}`});
      const said = ok ? hidden : `Not done. ${failureHint(hidden)}\n${hidden}`;
      return {text: shortAnswer(said, {before: state.before, after: after?.screen ?? null})};
    },
  };
  return hands;
}
