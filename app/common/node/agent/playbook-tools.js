import {z} from 'zod';

import {parseUiTree} from '../../renderer/lib/a11y/ui-tree';
import {cleanPlaybook, locatorFor, loginScreen, playbookDetails} from '../../shared/agent/playbook.js';
import {createDeviceClient} from './device-client.js';

// The playbook's tools: signing in and putting the app back to its start,
// both done by the station on the Inspector's session, so a password goes
// from the keychain to the device and never through the agent; and reading
// the playbook itself.

const LOGIN_WAIT_MS = 30000;
const OTP_LEFT =
  'The app asks a one-time code and the user has not typed it: it is a condition of the test. Stop and ask the user.';
const POLL_MS = 1000;
const ERROR_TEXT = /помилк|невірн|неправильн|не вдалося|incorrect|wrong|invalid|error|failed/i;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// how long the station waits for the person to type a one-time code
const OTP_WAIT_MS = 5 * 60 * 1000;

/**
 * @param {object} deps
 * @param {(kind: string, args?: object) => Promise<any>} deps.ask asks the window: `session`, `state`
 * @param {() => Promise<object>} deps.playbook the playbook of the profile that is on
 * @param {(accountId: string) => Promise<{login?: string, password?: string} | null>} deps.secret
 * @param {(conversation: string, step: object) => void} [deps.onStep] an action of the station on the device, for the chat and the screens
 * @param {(conversation: string, info: object) => Promise<boolean>} [deps.onOtp] the app asks a one-time code: the person types it and says so (true), or not
 * @param {(session: object) => ReturnType<typeof createDeviceClient>} [deps.client]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {number} [deps.waitMs]
 */
export function playbookTools(deps) {
  const client = deps.client ?? ((session) => createDeviceClient(session));
  const sleep = deps.sleep ?? delay;
  const waitMs = deps.waitMs ?? LOGIN_WAIT_MS;
  const ready = async (id) => {
    const secret = await deps.secret(id).catch(() => null);
    return !!(secret?.login && secret?.password);
  };

  const sessionOf = async () => {
    const session = await deps.ask('session').catch(() => null);
    if (!session?.sessionId) {
      throw new Error('There is no session: ask the user to start one in the station (Start session).');
    }
    return session;
  };

  // a one-time code is a condition of the test: the person types it, the agent waits for them
  const askCode = async (conversation, account) => {
    const typed = deps.onOtp
      ? await Promise.race([deps.onOtp(conversation, {account}), sleep(OTP_WAIT_MS).then(() => false)])
      : false;
    return !!typed;
  };

  const nodesOf = async (device) => parseUiTree(await device.source(), {}).nodes;

  // what the playbook names wins over what the station finds on the screen
  const findParts = async (device, nodes, locators) => {
    const found = loginScreen(nodes);
    const parts = {kind: found.kind};
    for (const name of ['login', 'password', 'submit']) {
      if (locators?.[name]) {
        parts[name] = await device.find(locators[name]);
      } else if (found[name]) {
        parts[name] = await device.find(locatorFor(found[name], nodes));
      }
    }
    if (locators?.password) {
      parts.kind = parts.password ? (parts.login ? 'full' : 'password') : found.kind === 'otp' ? 'otp' : 'none';
    }
    return parts;
  };

  const errorOn = (nodes) =>
    nodes.find((node) => node.visible !== false && ERROR_TEXT.test(`${node.text ?? ''} ${node.label ?? ''}`));

  return [
    {
      name: 'app_login',
      readOnly: false,
      handsGroup: 'app',
      description:
        'Signs in to the app with an account of the playbook, by its name: the station finds the sign-in on the screen and types the login and password itself (on a second sign-in only the password). You never see or type passwords. If the app asks a one-time code, the user types it.',
      input: {account: z.string().describe('The name of an account from the playbook, e.g. "basic"')},
      run: async ({account}, {conversation}) => {
        const book = cleanPlaybook(await deps.playbook());
        const known = book.accounts.find((one) => one.name.toLowerCase() === String(account).trim().toLowerCase());
        if (!known) {
          return `No account "${account}" in the playbook. Accounts: ${book.accounts.map((one) => one.name).join(', ') || 'none'}.`;
        }
        const secret = await deps.secret(known.id).catch(() => null);
        if (!secret?.login || !secret?.password) {
          return `The account "${known.name}" has no login or password on this Mac: ask the user to enter them in Settings → Profiles → App playbook.`;
        }
        const session = await sessionOf();
        const device = client(session);
        const nodes = await nodesOf(device);
        const parts = await findParts(device, nodes, book.login[session.platform]);
        if (parts.kind === 'otp') {
          return (await askCode(conversation, known.name))
            ? `The user typed the one-time code for ${known.name}. Look at the screen with screen_current.`
            : OTP_LEFT;
        }
        if (parts.kind === 'none' || !parts.password) {
          return 'There is no sign-in on this screen: nothing done. Go to the sign-in first, or the app is already signed in.';
        }
        if (parts.kind === 'full' && !parts.login) {
          return 'Failed at the login field: it was not found. The user can set its locator in the playbook.';
        }
        if (parts.kind === 'full') {
          await device.clear(parts.login).catch(() => null);
          await device.type(parts.login, secret.login);
        }
        await device.clear(parts.password).catch(() => null);
        await device.type(parts.password, secret.password);
        if (!parts.submit) {
          return 'Failed at the button: no sign-in button was found after the password. The user can set its locator in the playbook.';
        }
        await device.click(parts.submit);
        deps.onStep?.(conversation, {line: `login «${known.name}»`, tool: 'app_login'});

        for (let waited = 0; waited < waitMs; waited += POLL_MS) {
          await sleep(POLL_MS);
          const now = await nodesOf(device).catch(() => null);
          if (!now) {
            continue;
          }
          const screen = loginScreen(now);
          if (screen.kind === 'otp') {
            return (await askCode(conversation, known.name))
              ? `Signed in as ${known.name}; the user typed the one-time code. Look at the screen with screen_current.`
              : OTP_LEFT;
          }
          const error = screen.kind !== 'none' ? errorOn(now) : null;
          if (error) {
            return `Failed: the app shows "${String(error.text || error.label).slice(0, 120)}" on the sign-in.`;
          }
          if (screen.kind === 'none') {
            return `Signed in as ${known.name} (${parts.kind === 'full' ? 'login and password' : 'password'}).`;
          }
        }
        return `Failed: the sign-in is still on the screen after ${Math.round(waitMs / 1000)} s.`;
      },
    },
    {
      name: 'app_reset',
      readOnly: false,
      handsGroup: 'app',
      description:
        "Puts the project's app back to its start as the playbook says (restart, clear data, a deep link); without a playbook reset, restarts the app.",
      input: {},
      run: async (_args, {conversation}) => {
        const book = cleanPlaybook(await deps.playbook());
        const session = await sessionOf();
        if (!session.appId) {
          return 'The project has no app for this platform yet: the user picks it in the title bar.';
        }
        const device = client(session);
        const steps = book.reset[session.platform] ?? [{kind: 'restart'}];
        for (const step of steps) {
          if (step.kind === 'restart') {
            await device.terminate(session.appId).catch(() => null);
            await device.activate(session.appId);
          } else if (step.kind === 'clear') {
            await device.terminate(session.appId).catch(() => null);
            await device.clearApp(session.appId);
            await device.activate(session.appId);
          } else if (step.kind === 'deeplink') {
            await device.deepLink(step.url, session.appId);
          }
        }
        deps.onStep?.(conversation, {line: `reset ${steps.map((step) => step.kind).join(', ')}`, tool: 'app_reset'});
        await sleep(2 * POLL_MS);
        return `Done: ${steps.map((step) => step.kind).join(', ')}. Look at the screen with screen_current.`;
      },
    },
    {
      name: 'playbook_get',
      readOnly: true,
      description:
        "The project's playbook: accounts by name and purpose (ready: has a password on this Mac), what the agent may do on the device, what it must never touch, the reset. part: one of them.",
      input: {part: z.enum(['accounts', 'permissions', 'forbidden', 'reset', 'login']).optional()},
      run: async ({part}) => {
        const book = cleanPlaybook(await deps.playbook());
        const states = Object.fromEntries(
          await Promise.all(book.accounts.map(async (account) => [account.id, await ready(account.id)])),
        );
        return playbookDetails(book, part ?? null, {ready: (id) => states[id]});
      },
    },
  ];
}
