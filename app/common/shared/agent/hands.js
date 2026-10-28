import {forbiddenFor, isPasswordField} from './playbook.js';

// The agent's hands are the tools of appium-mcp, run by the station on the
// session of the Inspector. Each tool, and each action of the tools that do
// several things, belongs to a group of the playbook's permissions; a few
// tools are never shown. Before each action the station says whether it may
// go, and after it what the agent hears back.

export const HANDS_SERVER = 'hands';
export const HANDS_LIMIT = 60;
const MAX_ANSWER = 1000;

// tools the agent never gets: the session and the device are the station's
export const NEVER_TOOLS = new Set([
  'select_device',
  'prepare_ios_simulator',
  'appium_prepare_ios_real_device',
  'appium_driver_settings',
  'appium_generate_tests',
  'appium_mobile_file',
  'appium_ai',
  'appium_documentation_query',
  'appium_skills',
]);

// the group of each tool; a map for the tools whose `action` decides it
const TOOL_GROUPS = {
  appium_session_management: 'session',
  appium_find_element: 'look',
  appium_find_elements: 'look',
  appium_get_text: 'look',
  appium_get_element_attribute: 'look',
  appium_get_active_element: 'look',
  appium_get_window_size: 'look',
  appium_get_page_source: 'look',
  appium_mobile_device_info: 'look',
  generate_locators: 'look',
  appium_gesture: 'act',
  appium_drag_and_drop: 'act',
  appium_perform_actions: 'act',
  appium_set_value: 'act',
  appium_mobile_press_key: 'act',
  appium_context: {list: 'look', '*': 'act'},
  appium_mobile_keyboard: {is_shown: 'look', '*': 'act'},
  appium_alert: {get_text: 'look', '*': 'act'},
  appium_app_lifecycle: {
    list: 'look',
    is_installed: 'look',
    query_state: 'look',
    activate: 'app',
    terminate: 'app',
    background: 'app',
    deep_link: 'app',
    install: 'install',
    uninstall: 'install',
    clear: 'appData',
  },
  appium_mobile_permissions: {get: 'look', '*': 'appData'},
  appium_geolocation: {get: 'look', '*': 'device'},
  appium_orientation: {get: 'look', '*': 'device'},
  appium_mobile_device_control: 'device',
  appium_mobile_clipboard: 'device',
  appium_screenshot: 'capture',
  appium_screen_recording: 'capture',
};

// the actions of each group, for the instructions and the settings
export const HAND_GROUPS = ['look', 'act', 'app', 'install', 'appData', 'device', 'capture'];

/**
 * The group an action is in: a group of the permissions, `session` for the
 * station's own session handling, or `never`.
 */
export function groupOf(tool, args = {}) {
  if (NEVER_TOOLS.has(tool)) {
    return 'never';
  }
  const known = TOOL_GROUPS[tool];
  if (!known) {
    // a tool of a newer appium-mcp the station does not know yet
    return 'never';
  }
  if (typeof known === 'string') {
    return known;
  }
  return known[args?.action] ?? known['*'] ?? 'never';
}

/** The tools the agent sees: none that is never shown, none whose every action is denied. */
export function allowedTools(permissions) {
  return Object.entries(TOOL_GROUPS)
    .filter(([, groups]) => {
      const all = typeof groups === 'string' ? [groups] : Object.values(groups);
      return all.some((group) => group === 'session' || permissions?.[group] !== 'deny');
    })
    .map(([tool]) => tool);
}

/**
 * What the station answers when Kiro asks to run a tool of the hands: what
 * the playbook allows goes, what it asks about is the person's call, the rest
 * is refused.
 * @returns {'allow' | 'ask' | 'reject'}
 */
export function handsPermission(tool, args, permissions) {
  const group = groupOf(tool, args);
  if (group === 'session') {
    return 'allow';
  }
  if (group === 'never') {
    return 'reject';
  }
  return {allow: 'allow', ask: 'ask', deny: 'reject'}[permissions?.[group] ?? 'ask'] ?? 'ask';
}

const touchesElement = (tool, args) =>
  tool === 'appium_set_value' ||
  tool === 'appium_drag_and_drop' ||
  (tool === 'appium_gesture' && ['tap', 'double_tap', 'long_press'].includes(args?.action));

const appIdOf = (args) => args?.id ?? args?.name ?? null;

const attachHint = (expected) =>
  `Call appium_session_management with action=attach, remoteServerUrl=${expected.serverUrl} and sessionId=${expected.sessionId} first; then repeat this.`;

const refuse = (text) => ({ok: false, text});

/**
 * Whether an action of the hands may go, as `check` answers the plugin.
 * @param {object} input
 * @param {string} input.tool
 * @param {object} [input.args]
 * @param {{serverUrl: string, sessionId: string} | null} input.expected the session of the Inspector
 * @param {string | null} [input.active] the session appium-mcp works on now
 * @param {boolean} [input.stopped] the person pressed «Stop»
 * @param {object} input.playbook the clean playbook
 * @param {string | null} [input.appId] the project's app on this platform
 * @param {object | null} [input.element] the element the action touches
 * @param {string | null} [input.screen] the title of the screen on the device
 * @param {string[]} [input.builds] the build files the station knows
 * @returns {{ok: true, group: string} | {ok: false, text: string}}
 */
export function handsVerdict({
  tool,
  args = {},
  expected,
  active = null,
  stopped = false,
  playbook,
  appId = null,
  element = null,
  screen = null,
  builds = [],
}) {
  if (stopped) {
    return refuse('The user pressed Stop: do nothing more on the device and wait for their next message.');
  }
  const group = groupOf(tool, args);
  if (group === 'never') {
    return refuse(`${tool} is not for the agent: the station handles sessions and devices itself.`);
  }
  if (!expected?.sessionId) {
    return refuse('There is no session: ask the user to start one in the station (Start session), then go on.');
  }
  if (args.sessionId && args.sessionId !== expected.sessionId) {
    return refuse(`Work on the station's session only (sessionId ${expected.sessionId}).`);
  }
  if (group === 'session') {
    if (args.action === 'list') {
      return {ok: true, group};
    }
    const right = args.sessionId === expected.sessionId;
    if (args.action === 'attach' && right && args.remoteServerUrl === expected.serverUrl) {
      return {ok: true, group};
    }
    if (args.action === 'select' && right) {
      return {ok: true, group};
    }
    return refuse(`Only the station's session is yours. ${attachHint(expected)}`);
  }
  if (active !== expected.sessionId) {
    return refuse(`Not on the station's session yet. ${attachHint(expected)}`);
  }
  if (playbook.permissions[group] === 'deny') {
    return refuse(`The project does not let the agent do this (${group}).`);
  }
  if (tool === 'appium_get_page_source' && !args.selector && !args.pattern) {
    return refuse(
      'The whole XML is too big: use screen_current of the station, generate_locators, or pass selector or pattern with saveToFile.',
    );
  }
  if (tool === 'appium_set_value' && isPasswordField(element)) {
    return refuse(
      'This is a password field: sign in with app_login(account) of the station; the agent never types passwords.',
    );
  }
  if (group === 'act') {
    const rule = forbiddenFor(touchesElement(tool, args) ? element : null, playbook.forbidden, screen);
    if (rule) {
      return refuse(
        `The project forbids this: ${rule.kind} "${rule.value}"${rule.why ? ` — ${rule.why}` : ''}. Choose another way.`,
      );
    }
  }
  if (
    tool === 'appium_app_lifecycle' &&
    !['list', 'is_installed', 'query_state', 'background', 'install'].includes(args.action)
  ) {
    if (!appId) {
      return refuse('The project has no app for this platform yet: the user picks it in the title bar.');
    }
    if (appIdOf(args) && appIdOf(args) !== appId) {
      return refuse(`Only the project's app (${appId}) is yours.`);
    }
  }
  if (tool === 'appium_app_lifecycle' && args.action === 'install' && !builds.includes(args.path)) {
    return refuse('Install only a build the station knows: get it from builds_list and pass its file as path.');
  }
  return {ok: true, group};
}

const SHORT_ACTIONS = {
  appium_gesture: (args) => args.action,
  appium_set_value: () => 'type',
  appium_drag_and_drop: () => 'drag',
  appium_mobile_press_key: (args) => `key ${args.key ?? args.keycode ?? ''}`.trim(),
  appium_app_lifecycle: (args) => `app ${args.action}`,
  appium_alert: (args) => `alert ${args.action}`,
};

/**
 * One line for an action, for the chat and the station's journal: what was
 * done and to what. Typed text is never in it.
 */
export function actionLine(tool, args = {}, element = null) {
  const what = SHORT_ACTIONS[tool]?.(args) ?? `${tool.replace(/^appium_/, '')}${args.action ? ` ${args.action}` : ''}`;
  const target = element?.text || element?.label || element?.resourceId?.split('/').pop() || null;
  const where =
    target ??
    (Number.isFinite(args.x) && Number.isFinite(args.y) ? `${args.x},${args.y}` : (args.url ?? args.selector ?? null));
  return where ? `${what} «${String(where).slice(0, 60)}»` : what;
}

const FAILURES = [
  [
    /no such element|could not be located|unable to find|not found/i,
    'The element is not on the screen now: look at the screen again (screen_current) and pick another locator.',
  ],
  [/stale element/i, 'The screen changed since the element was found: find it again.'],
  [
    /not (?:interactable|clickable)|obscured|intercepted/i,
    'The element cannot be tapped now: something covers it, or it is disabled. Look at the screen.',
  ],
  [
    /invalid session|session.*(?:terminated|not (?:found|started))|ECONNREFUSED|did not answer/i,
    'The session is gone: ask the user to start one (Start session), then attach again.',
  ],
  [/timed? ?out|timeout/i, 'The device took too long: look at the screen and try once more.'],
];

/** A failed action in plain words, with what to try; the tool's own text comes after it. */
export function failureHint(text) {
  return (
    FAILURES.find(([pattern]) => pattern.test(String(text ?? '')))?.[1] ??
    'It did not work: look at the screen and choose another way.'
  );
}

/**
 * What the agent hears after an action: the tool's own words, cut short, and
 * the screen the device shows now.
 * @param {string} text what appium-mcp answered
 * @param {{before?: object | null, after?: object | null}} screens title and state of the screen
 */
export function shortAnswer(text, {before = null, after = null} = {}) {
  const name = (screen) => (screen ? `${screen.title ?? 'unnamed'}${screen.state ? ` (${screen.state})` : ''}` : null);
  const now = name(after);
  const tail = now ? `\nScreen now: ${now}${name(before) && name(before) === now ? ' (unchanged)' : ''}.` : '';
  const room = MAX_ANSWER - tail.length;
  const body = String(text ?? '').trim();
  return `${body.length > room ? `${body.slice(0, room - 1)}…` : body}${tail}`;
}

const MAX_GOALS = 1500;

/**
 * The goals of the session for the agent: each with its state, where it is
 * expected and what proved it, open ones first, in at most 1 500 characters.
 */
export function goalsStatus(goals = [], states = {}) {
  if (!goals.length) {
    return 'No goals for this session: the task has none yet.';
  }
  const order = {failed: 0, pending: 1, manual: 2, holding: 3, passed: 4};
  const rows = goals
    .map((goal) => ({goal, state: states?.[goal.id] ?? {state: 'pending'}}))
    .sort((a, b) => (order[a.state.state] ?? 5) - (order[b.state.state] ?? 5));
  const lines = rows.map(({goal, state}) => {
    const where = goal.expectOn ? ` — on ${goal.expectOn}` : '';
    const proof = state.evidence?.label ? ` — ${state.evidence.label}` : '';
    return `- [${state.state}] ${goal.title}${where}${proof}`;
  });
  const counts = rows.reduce((all, {state}) => ({...all, [state.state]: (all[state.state] ?? 0) + 1}), {});
  const head = `Goals: ${Object.entries(counts)
    .map(([state, count]) => `${count} ${state}`)
    .join(', ')}.`;
  const out = [head, ...lines].join('\n');
  return out.length > MAX_GOALS ? `${out.slice(0, MAX_GOALS - 1)}…` : out;
}
