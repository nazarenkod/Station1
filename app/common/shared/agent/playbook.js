// The playbook of an app: the accounts to sign in with and what each is
// for, how the station finds the sign-in on the screen, what the agent may
// do on the device, what it must never touch, and how the app goes back to
// its start. The person writes it; the agent only reads it. Logins and
// passwords are not here: they live in the keychain, by account.

export const PERMISSION_GROUPS = ['look', 'act', 'app', 'install', 'appData', 'device', 'capture'];
export const PERMISSION_VALUES = ['allow', 'ask', 'deny'];

export const DEFAULT_PERMISSIONS = {
  look: 'allow',
  act: 'allow',
  app: 'allow',
  install: 'ask',
  appData: 'ask',
  device: 'ask',
  capture: 'ask',
};

export const FORBIDDEN_KINDS = ['text', 'pattern', 'id', 'screen'];
export const RESET_KINDS = ['restart', 'clear', 'deeplink'];
const PLATFORMS = ['android', 'ios'];
const MAX_SUMMARY = 1500;

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const text = (value, max = 300) =>
  String(value ?? '')
    .trim()
    .slice(0, max);
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);

const cleanLocator = (value) =>
  isObject(value) && text(value.value, 500)
    ? {using: text(value.using, 60) || 'id', value: text(value.value, 500)}
    : null;

function cleanLocators(value) {
  const out = {};
  for (const name of ['login', 'password', 'submit']) {
    const locator = cleanLocator(value?.[name]);
    if (locator) {
      out[name] = locator;
    }
  }
  return out;
}

const cleanStep = (step) =>
  isObject(step) && RESET_KINDS.includes(step.kind)
    ? step.kind === 'deeplink'
      ? text(step.url, 500)
        ? {kind: 'deeplink', url: text(step.url, 500)}
        : null
      : {kind: step.kind}
    : null;

/** The playbook as it is kept, with the default permissions filled in. */
export function cleanPlaybook(value) {
  const permissions = {...DEFAULT_PERMISSIONS};
  for (const group of PERMISSION_GROUPS) {
    if (PERMISSION_VALUES.includes(value?.permissions?.[group])) {
      permissions[group] = value.permissions[group];
    }
  }
  const login = {};
  const reset = {};
  for (const platform of PLATFORMS) {
    const locators = cleanLocators(value?.login?.[platform]);
    if (Object.keys(locators).length) {
      login[platform] = locators;
    }
    const steps = list(value?.reset?.[platform]).map(cleanStep).filter(Boolean);
    if (steps.length) {
      reset[platform] = steps;
    }
  }
  return {
    accounts: list(value?.accounts)
      .filter(isObject)
      .map((account) => ({
        id: text(account.id, 60) || newId('acc'),
        name: text(account.name, 40),
        purpose: text(account.purpose),
      }))
      .filter((account) => account.name),
    login,
    permissions,
    forbidden: list(value?.forbidden)
      .filter((rule) => isObject(rule) && FORBIDDEN_KINDS.includes(rule.kind) && text(rule.value))
      .map((rule) => ({
        id: text(rule.id, 60) || newId('ban'),
        kind: rule.kind,
        value: text(rule.value),
        why: text(rule.why),
      })),
    reset,
  };
}

export const newAccount = () => ({id: newId('acc'), name: '', purpose: ''});
export const newForbidden = () => ({id: newId('ban'), kind: 'text', value: '', why: ''});

// ---- the sign-in on the screen

const TEXT_FIELD = /EditText|AutoCompleteTextView|XCUIElementTypeTextField|XCUIElementTypeSearchField/;
const BUTTON = /Button|XCUIElementTypeButton|XCUIElementTypeLink/;
const SUBMIT_TEXT = /увійти|вхід|далі|продовжити|login|log in|sign in|signin|next|continue|submit|^ok$/i;
const OTP_TEXT = /otp|one.?time|verification|confirm.*code|sms|код|одноразов|підтвердж/i;

const visible = (nodes) => list(nodes).filter((node) => node.visible !== false && node.enabled !== false);
const isPasswordNode = (node) => !!node.password || node.className === 'XCUIElementTypeSecureTextField';
const isTextField = (node) => TEXT_FIELD.test(node.className ?? '') && !isPasswordNode(node);
const words = (node) => [node.text, node.label, node.hint, node.resourceId].filter(Boolean).join(' ');

/** Whether an element is a password field, by what Android or iOS says of it. */
export const isPasswordField = (element) =>
  !!element &&
  (element.password === true || element.password === 'true' || /SecureTextField/.test(element.className ?? ''));

/**
 * What the screen asks for, by its fields: the full sign-in (a text field
 * and a password field), the password alone (the app remembers who), a
 * one-time code, or no sign-in at all.
 * @param {object[]} nodes the nodes of a parsed UI tree
 * @returns {{kind: 'full' | 'password' | 'otp' | 'none', login?: object, password?: object, submit?: object}}
 */
export function loginScreen(nodes) {
  const shown = visible(nodes);
  const password = shown.find(isPasswordNode);
  if (!password) {
    const code = shown.find((node) => isTextField(node) && OTP_TEXT.test(words(node)));
    return code ? {kind: 'otp', code} : {kind: 'none'};
  }
  // the login is the text field nearest above the password
  const login = shown.filter((node) => isTextField(node) && node.index < password.index).at(-1) ?? null;
  const after = shown.filter((node) => node.index > password.index && node.clickable !== false);
  const submit =
    after.find((node) => SUBMIT_TEXT.test(`${node.text ?? ''} ${node.label ?? ''}`)) ??
    after.find((node) => BUTTON.test(node.className ?? '')) ??
    null;
  return {kind: login ? 'full' : 'password', ...(login ? {login} : {}), password, ...(submit ? {submit} : {})};
}

const quote = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');

/**
 * A locator for a node of the tree: its id, its accessibility label, or its
 * place among the elements of its class.
 * @returns {{using: string, value: string}}
 */
export function locatorFor(node, nodes) {
  if (node.resourceId) {
    return {using: 'id', value: node.resourceId};
  }
  if (node.label && /^XCUIElementType/.test(node.className ?? '')) {
    return {using: 'accessibility id', value: node.label};
  }
  const same = list(nodes).filter((one) => one.className === node.className);
  const place = same.findIndex((one) => one.index === node.index) + 1;
  return {using: 'xpath', value: `(//${node.className})[${Math.max(place, 1)}]`};
}

/** A locator from the playbook as a node to find, for the parts it names. */
export const locatorText = (locator) => `${locator.using}="${quote(locator.value)}"`;

// ---- what the agent must not touch

const same = (a, b) =>
  String(a ?? '')
    .trim()
    .toLowerCase() ===
  String(b ?? '')
    .trim()
    .toLowerCase();

function patternOf(value) {
  try {
    return new RegExp(value, 'i');
  } catch {
    return null;
  }
}

/**
 * The rule of the playbook an action breaks, if any: an element by its text,
 * a pattern of its text, its id, or the screen it is on.
 * @param {{text?: string, label?: string, resourceId?: string} | null} element
 * @param {object[]} rules the `forbidden` of the playbook
 * @param {string | null} screenTitle the screen the device shows
 */
export function forbiddenFor(element, rules, screenTitle = null) {
  for (const rule of list(rules)) {
    if (rule.kind === 'screen') {
      if (screenTitle && same(rule.value, screenTitle)) {
        return rule;
      }
      continue;
    }
    if (!element) {
      continue;
    }
    const texts = [element.text, element.label].filter(Boolean);
    if (rule.kind === 'text' && texts.some((one) => same(one, rule.value))) {
      return rule;
    }
    if (rule.kind === 'pattern' && texts.some((one) => patternOf(rule.value)?.test(one))) {
      return rule;
    }
    if (rule.kind === 'id' && element.resourceId) {
      const id = String(element.resourceId);
      if (id === rule.value || id.endsWith(`/${rule.value}`) || id.endsWith(`:id/${rule.value}`)) {
        return rule;
      }
    }
  }
  return null;
}

// ---- what goes to the agent

const describeRule = (rule) =>
  `${rule.kind === 'screen' ? 'screen' : rule.kind} "${rule.value}"${rule.why ? ` (${rule.why})` : ''}`;

/**
 * The playbook in a few lines for the agent's instructions: the accounts and
 * what each is for, what it must not touch, what it may do.
 * @param {object} playbook
 * @param {{ready?: (id: string) => boolean}} [options] whether an account has its login and password
 */
export function playbookSummary(playbook, {ready = () => true} = {}) {
  const book = cleanPlaybook(playbook);
  const lines = [];
  if (book.accounts.length) {
    lines.push('Accounts (sign in with app_login, never type a password):');
    for (const account of book.accounts) {
      lines.push(
        `- ${account.name}${account.purpose ? `: ${account.purpose}` : ''}${ready(account.id) ? '' : ' (no password yet)'}`,
      );
    }
  }
  if (book.forbidden.length) {
    lines.push(`Never touch: ${book.forbidden.map(describeRule).join('; ')}.`);
  }
  const by = (value) => PERMISSION_GROUPS.filter((group) => book.permissions[group] === value);
  lines.push(
    `On the device: free ${by('allow').join(', ') || 'nothing'}; ask first ${by('ask').join(', ') || 'nothing'}; never ${by('deny').join(', ') || 'nothing'}.`,
  );
  if (Object.keys(book.reset).length) {
    lines.push('app_reset brings the app back to its start.');
  }
  const out = lines.join('\n');
  return out.length > MAX_SUMMARY ? `${out.slice(0, MAX_SUMMARY - 1)}…` : out;
}

/** The playbook for `playbook_get`, a part of it or the whole, without secrets. */
export function playbookDetails(playbook, part = null, {ready = () => true} = {}) {
  const book = cleanPlaybook(playbook);
  const parts = {
    accounts: book.accounts.map((account) => ({...account, ready: ready(account.id)})),
    permissions: book.permissions,
    forbidden: book.forbidden.map(({kind, value, why}) => ({kind, value, why})),
    reset: book.reset,
    login: book.login,
  };
  return part && parts[part] ? {[part]: parts[part]} : parts;
}
