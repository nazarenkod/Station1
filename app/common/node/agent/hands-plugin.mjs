// The agent's hands as a process of their own: appium-mcp with the station's
// plugin, started by Kiro (Electron run as Node) for one conversation. The
// station writes this file into the hands folder as it is, so it imports
// nothing but Node and the appium-mcp installed there.
//
// Before each tool the plugin asks the station whether it may go (the
// session, the permissions of the project, what it must not touch); after
// it, it tells the station what was done and gives the agent the station's
// short answer in place of appium-mcp's.

import path from 'node:path';
import {pathToFileURL} from 'node:url';

const CHECK_TIMEOUT_MS = 15 * 60 * 1000;
const DONE_TIMEOUT_MS = 60 * 1000;
const AI_ELEMENT = /^ai-element:/;

const textOf = (result) =>
  (result?.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

const refusal = (text) => ({isError: true, content: [{type: 'text', text}]});

// what the station needs of the arguments: never the text being typed
const safeArgs = (tool, args) => {
  const copy = {...args};
  if (tool === 'appium_set_value' || tool === 'appium_mobile_clipboard') {
    delete copy.text;
    delete copy.content;
  }
  return copy;
};

/** The element an action touches, read from the device through appium-mcp's own driver. */
async function elementOf(driver, elementId) {
  if (!driver || !elementId || AI_ELEMENT.test(elementId)) {
    return null;
  }
  const names = ['text', 'content-desc', 'resource-id', 'password', 'class', 'name', 'label', 'type'];
  const values = await Promise.all(
    names.map((name) => Promise.resolve(driver.getElementAttribute(elementId, name)).catch(() => null)),
  );
  const read = Object.fromEntries(names.map((name, at) => [name, values[at] ?? null]));
  // a driver answers an attribute it lacks with an empty text or null
  return {
    text: read.text || read.name || null,
    label: read['content-desc'] || read.label || null,
    resourceId: read['resource-id'] || null,
    password: read.password === 'true' || read.password === true,
    className: read.class || read.type || null,
  };
}

/**
 * @param {{post: (op: 'check' | 'done', body: object) => Promise<object>}} station
 * @param {(session: {serverUrl: string, sessionId: string}) => Promise<boolean>} [attach] joins the station's session
 */
export function createStationPlugin(station, attach = null) {
  const touched = new WeakMap();

  // what the action touches and whether the station lets it go
  const ask = async (ctx) => {
    const driver = ctx.session.getDriver?.() ?? null;
    let elementId = ctx.args?.elementUUID ?? ctx.args?.sourceElementUUID ?? null;
    if (!elementId && ctx.toolName === 'appium_set_value' && driver?.getActiveElement) {
      const active = await Promise.resolve(driver.getActiveElement()).catch(() => null);
      elementId = active?.['element-6066-11e4-a52e-4f735466cecf'] ?? active?.ELEMENT ?? null;
    }
    const element = await elementOf(driver, elementId).catch(() => null);
    const verdict = await station.post('check', {
      tool: ctx.toolName,
      args: safeArgs(ctx.toolName, ctx.args ?? {}),
      active: ctx.session.getSessionId?.() ?? null,
      element,
    });
    return {verdict, element};
  };

  return {
    name: 'station',
    version: '1.0.0',

    async beforeCall(ctx) {
      let asked;
      try {
        asked = await ask(ctx);
        // not on the station's session yet: join it, then ask once more
        if (asked.verdict?.attach && attach && (await attach(asked.verdict.attach))) {
          asked = await ask(ctx);
        }
      } catch (error) {
        return refusal(`The station did not answer (${error.message}): nothing done on the device.`);
      }
      const {verdict, element} = asked;
      if (!verdict?.ok) {
        return refusal(verdict?.text ?? 'The station refused this.');
      }
      touched.set(ctx, verdict.element ?? element);
      return undefined;
    },

    async afterCall(ctx, result) {
      try {
        const answer = await station.post('done', {
          tool: ctx.toolName,
          args: safeArgs(ctx.toolName, ctx.args ?? {}),
          ok: !result.isError,
          text: textOf(result),
          element: touched.get(ctx) ?? null,
        });
        if (typeof answer?.text !== 'string') {
          return undefined;
        }
        // pictures stay as they are; the words are the station's
        const rest = (result.content ?? []).filter((part) => part.type !== 'text');
        return {...result, content: [{type: 'text', text: answer.text}, ...rest]};
      } catch {
        return undefined;
      }
    },
  };
}

/** Talks to the station's MCP server over HTTP, with the token of this run. */
export function stationClient({url, token}) {
  return {
    async post(op, body) {
      const response = await fetch(`${url}/${op}`, {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(op === 'check' ? CHECK_TIMEOUT_MS : DONE_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    },
  };
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function main() {
  const home = process.env.HANDS_HOME;
  const tools = String(process.env.HANDS_TOOLS ?? '')
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
  // an empty allow list would show every tool
  if (!home || !tools.length) {
    process.stderr.write('The station did not say where the hands are or which tools they have.\n');
    process.exit(2);
  }
  const dist = path.join(home, 'node_modules', 'appium-mcp', 'dist');
  const core = await import(pathToFileURL(path.join(dist, 'core.js')).href);
  // appium-mcp has no public way to join a session from a plugin: its own attach, of the pinned version
  const {attachSessionAction} = await import(
    pathToFileURL(path.join(dist, 'tools', 'session', 'attach-session.js')).href
  );
  const attach = async ({serverUrl, sessionId}) =>
    !(await attachSessionAction({remoteServerUrl: serverUrl, sessionId}))?.isError;
  const server = await core.createAppiumMcpServer({
    plugins: [
      createStationPlugin(
        stationClient({url: process.env.STATION_HANDS_URL, token: process.env.STATION_TOKEN}),
        attach,
      ),
    ],
    additionalInstructions: process.env.HANDS_INSTRUCTIONS ?? '',
    policy: {allowTools: tools.map((tool) => new RegExp(`^${escape(tool)}$`))},
  });
  await server.start({transportType: 'stdio'});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exit(1);
  });
}
