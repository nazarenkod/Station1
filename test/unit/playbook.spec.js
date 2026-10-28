import {describe, expect, it} from 'vitest';

import {createDeviceClient} from '../../app/common/node/agent/device-client.js';
import {playbookTools} from '../../app/common/node/agent/playbook-tools.js';
import {parseUiTree} from '../../app/common/renderer/lib/a11y/ui-tree.ts';
import {
  cleanPlaybook,
  DEFAULT_PERMISSIONS,
  forbiddenFor,
  isPasswordField,
  locatorFor,
  loginScreen,
  playbookDetails,
  playbookSummary,
} from '../../app/common/shared/agent/playbook.js';
import {APP_PLAYBOOK} from '../../app/common/shared/setting-defs.js';
import {GROUPS} from '../../app/common/shared/settings/groups.js';

const android = (body) => parseUiTree(`<?xml version="1.0"?><hierarchy rotation="0">${body}</hierarchy>`, {}).nodes;
const ios = (body) =>
  parseUiTree(
    `<?xml version="1.0"?><AppiumAUT><XCUIElementTypeApplication name="Bank" label="Bank" x="0" y="0" width="390" height="844" visible="true" enabled="true">${body}</XCUIElementTypeApplication></AppiumAUT>`,
    {},
  ).nodes;

const field = (id, extra = '') =>
  `<android.widget.EditText resource-id="com.bank:id/${id}" text="" class="android.widget.EditText" clickable="true" enabled="true" displayed="true" bounds="[0,100][400,160]" ${extra}/>`;
const button = (text) =>
  `<android.widget.Button text="${text}" class="android.widget.Button" clickable="true" enabled="true" displayed="true" bounds="[0,300][400,360]"/>`;

describe('the playbook as it is kept', function () {
  it('fills in the default permissions and drops what is not a rule', function () {
    const book = cleanPlaybook({
      accounts: [{id: 'a1', name: 'basic', purpose: 'no cards', login: 'x', password: 'y'}, {name: ''}],
      permissions: {install: 'allow', act: 'sometimes'},
      forbidden: [
        {kind: 'text', value: 'Pay'},
        {kind: 'color', value: 'red'},
        {kind: 'id', value: ''},
      ],
      reset: {android: [{kind: 'clear'}, {kind: 'deeplink'}, {kind: 'deeplink', url: 'bank://home'}]},
    });
    expect(book.accounts).toEqual([{id: 'a1', name: 'basic', purpose: 'no cards'}]);
    expect(book.permissions).toEqual({...DEFAULT_PERMISSIONS, install: 'allow'});
    expect(book.forbidden).toHaveLength(1);
    expect(book.reset.android).toEqual([{kind: 'clear'}, {kind: 'deeplink', url: 'bank://home'}]);
  });

  it('goes with the profile without any login or password', function () {
    const group = GROUPS.playbook;
    expect(group.scope).toBe('profile');
    const all = {[APP_PLAYBOOK]: {accounts: [{id: 'a1', name: 'basic', purpose: '', password: 'secret'}]}};
    const exported = group.read(all);
    expect(JSON.stringify(exported)).not.toContain('secret');
    expect(group.valid(exported)).toBe(true);
    expect(group.write(exported, {})[APP_PLAYBOOK].accounts[0]).toEqual({id: 'a1', name: 'basic', purpose: ''});
  });
});

describe('the sign-in on the screen', function () {
  it('tells the full sign-in, the password alone, a one-time code and no sign-in apart', function () {
    const full = loginScreen(android(field('login') + field('password', 'password="true"') + button('Увійти')));
    expect(full.kind).toBe('full');
    expect(full.login.resourceId).toBe('com.bank:id/login');
    expect(full.password.resourceId).toBe('com.bank:id/password');
    expect(full.submit.text).toBe('Увійти');

    const again = loginScreen(android(field('password', 'password="true"') + button('Далі')));
    expect(again.kind).toBe('password');
    expect(again.login).toBeUndefined();

    expect(loginScreen(android(field('sms_code', 'text="Код з SMS"'))).kind).toBe('otp');
    expect(loginScreen(android(button('Переказ'))).kind).toBe('none');
  });

  it('reads iOS secure fields as passwords', function () {
    const nodes = ios(
      '<XCUIElementTypeTextField name="login" label="Логін" x="0" y="100" width="390" height="44" visible="true" enabled="true"/>' +
        '<XCUIElementTypeSecureTextField name="password" label="Пароль" x="0" y="160" width="390" height="44" visible="true" enabled="true"/>' +
        '<XCUIElementTypeButton name="signin" label="Sign in" x="0" y="220" width="390" height="44" visible="true" enabled="true"/>',
    );
    const screen = loginScreen(nodes);
    expect(screen.kind).toBe('full');
    expect(isPasswordField(screen.password)).toBe(true);
    expect(locatorFor(screen.password, nodes)).toEqual({using: 'id', value: 'password'});
  });

  it('finds an element by its id, else by its place among its class', function () {
    const nodes = android(
      field('login') +
        '<android.widget.EditText class="android.widget.EditText" password="true" displayed="true" bounds="[0,200][400,260]"/>',
    );
    expect(
      locatorFor(
        nodes.find((node) => node.resourceId),
        nodes,
      ),
    ).toEqual({using: 'id', value: 'com.bank:id/login'});
    expect(
      locatorFor(
        nodes.find((node) => node.password),
        nodes,
      ),
    ).toEqual({
      using: 'xpath',
      value: '(//android.widget.EditText)[2]',
    });
  });
});

describe('what the agent must not touch', function () {
  const rules = cleanPlaybook({
    forbidden: [
      {kind: 'text', value: 'Оплатити', why: 'real money'},
      {kind: 'pattern', value: 'видалити\\s+акаунт'},
      {kind: 'id', value: 'btn_logout'},
      {kind: 'screen', value: 'Settings'},
    ],
  }).forbidden;

  it('matches by text, pattern, id and screen, and lets the rest be', function () {
    expect(forbiddenFor({text: ' оплатити '}, rules)?.why).toBe('real money');
    expect(forbiddenFor({label: 'Видалити   акаунт'}, rules)?.kind).toBe('pattern');
    expect(forbiddenFor({resourceId: 'com.bank:id/btn_logout'}, rules)?.kind).toBe('id');
    expect(forbiddenFor(null, rules, 'settings')?.kind).toBe('screen');
    expect(forbiddenFor({text: 'Переказ'}, rules, 'Home')).toBeNull();
  });
});

describe('what goes to the agent', function () {
  const book = {
    accounts: [
      {id: 'a1', name: 'basic', purpose: 'no cards'},
      {id: 'a2', name: 'premium', purpose: 'limit 1000'},
    ],
    forbidden: [{kind: 'text', value: 'Pay', why: 'real money'}],
    permissions: {install: 'deny'},
  };

  it('is a short summary with the accounts by name and purpose only', function () {
    const text = playbookSummary(book, {ready: (id) => id === 'a1'});
    expect(text).toContain('- basic: no cards');
    expect(text).toContain('- premium: limit 1000 (no password yet)');
    expect(text).toContain('Never touch: text "Pay" (real money)');
    expect(text).toContain('never install');
    expect(text.length).toBeLessThanOrEqual(1500);
  });

  it('gives a part of the details on request, still without secrets', function () {
    expect(playbookDetails(book, 'accounts', {ready: () => false})).toEqual({
      accounts: [
        {id: 'a1', name: 'basic', purpose: 'no cards', ready: false},
        {id: 'a2', name: 'premium', purpose: 'limit 1000', ready: false},
      ],
    });
    expect(Object.keys(playbookDetails(book))).toEqual(['accounts', 'permissions', 'forbidden', 'reset', 'login']);
  });
});

describe('signing in and the reset, done by the station', function () {
  const xmlOf = (body) => `<?xml version="1.0"?><hierarchy rotation="0">${body}</hierarchy>`;
  const loginXml = xmlOf(field('login') + field('password', 'password="true"') + button('Увійти'));

  // a device that shows the screens it is given, one after each look, and notes what was done
  function fakeDevice(screens) {
    const done = [];
    let look = 0;
    return {
      done,
      source: async () => screens[Math.min(look++, screens.length - 1)],
      find: async (locator) => `${locator.using}:${locator.value}`,
      clear: async (id) => done.push(`clear ${id}`),
      type: async (id, text) => done.push(`type ${id} ${text}`),
      click: async (id) => done.push(`click ${id}`),
      terminate: async (app) => done.push(`terminate ${app}`),
      activate: async (app) => done.push(`activate ${app}`),
      clearApp: async (app) => done.push(`clearApp ${app}`),
      deepLink: async (url) => done.push(`deepLink ${url}`),
    };
  }
  const book = {
    accounts: [
      {id: 'a1', name: 'basic', purpose: 'no cards'},
      {id: 'a2', name: 'fresh', purpose: 'no password yet'},
    ],
    reset: {android: [{kind: 'clear'}, {kind: 'deeplink', url: 'bank://home'}]},
  };
  const tools = (device, extra = {}) =>
    Object.fromEntries(
      playbookTools({
        ask: async () => ({
          serverUrl: 'http://127.0.0.1:4723',
          sessionId: 's1',
          platform: 'android',
          appId: 'com.bank',
        }),
        playbook: async () => book,
        secret: async (id) => (id === 'a1' ? {login: 'user@bank', password: 'p4ss'} : null),
        client: () => device,
        sleep: async () => {},
        waitMs: 3000,
        ...extra,
      }).map((tool) => [tool.name, tool]),
    );
  const run = (device, name, args = {}, extra) => tools(device, extra)[name].run(args, {conversation: 'c1'});

  it('types the login and password itself and never says them', async function () {
    const device = fakeDevice([loginXml, xmlOf(button('Переказ'))]);
    const answer = await run(device, 'app_login', {account: 'Basic'});
    expect(answer).toBe('Signed in as basic (login and password).');
    expect(answer).not.toContain('p4ss');
    expect(device.done).toContain('type id:com.bank:id/login user@bank');
    expect(device.done).toContain('type id:com.bank:id/password p4ss');
    expect(device.done.at(-1)).toBe('click xpath:(//android.widget.Button)[1]');
  });

  it('types only the password when the app remembers who', async function () {
    const device = fakeDevice([xmlOf(field('password', 'password="true"') + button('Далі')), xmlOf(button('Home'))]);
    expect(await run(device, 'app_login', {account: 'basic'})).toBe('Signed in as basic (password).');
    expect(device.done.some((line) => line.includes('user@bank'))).toBe(false);
  });

  it('waits at a one-time code for the person to type it', async function () {
    const otp = [];
    const device = fakeDevice([
      xmlOf(field('login') + field('password', 'password="true"') + button('Увійти')),
      xmlOf(field('otp_code', 'text="Код з SMS"')),
    ]);
    const typed = await run(
      device,
      'app_login',
      {account: 'basic'},
      {onOtp: async (conversation, info) => (otp.push(info), true)},
    );
    expect(typed).toBe('Signed in as basic; the user typed the one-time code. Look at the screen with screen_current.');
    expect(otp).toEqual([{account: 'basic'}]);
    const left = fakeDevice([loginXml, xmlOf(field('otp_code', 'text="Код з SMS"'))]);
    expect(await run(left, 'app_login', {account: 'basic'}, {onOtp: async () => false})).toMatch(/has not typed it/);
  });

  it('says at which step and why a sign-in failed, without the values', async function () {
    const stuck = fakeDevice([
      xmlOf(field('login') + field('password', 'password="true"') + button('Увійти')),
      xmlOf(
        field('login') +
          field('password', 'password="true"') +
          '<android.widget.TextView text="Невірний пароль" class="android.widget.TextView" displayed="true" bounds="[0,400][400,440]"/>' +
          button('Увійти'),
      ),
    ]);
    expect(await run(stuck, 'app_login', {account: 'basic'})).toBe(
      'Failed: the app shows "Невірний пароль" on the sign-in.',
    );
    const still = fakeDevice([xmlOf(field('login') + field('password', 'password="true"') + button('Увійти'))]);
    expect(await run(still, 'app_login', {account: 'basic'})).toBe(
      'Failed: the sign-in is still on the screen after 3 s.',
    );
    expect(await run(fakeDevice([xmlOf(button('Home'))]), 'app_login', {account: 'basic'})).toMatch(
      /no sign-in on this screen/,
    );
  });

  it('does not start without the login and password, nor with an unknown account', async function () {
    const device = fakeDevice([loginXml]);
    expect(await run(device, 'app_login', {account: 'fresh'})).toMatch(/no login or password on this Mac/);
    expect(await run(device, 'app_login', {account: 'nobody'})).toMatch(/Accounts: basic, fresh/);
    expect(device.done).toEqual([]);
  });

  it('puts the app back to its start as the playbook says', async function () {
    const device = fakeDevice([xmlOf(button('Home'))]);
    expect(await run(device, 'app_reset')).toMatch(/^Done: clear, deeplink/);
    expect(device.done).toEqual([
      'terminate com.bank',
      'clearApp com.bank',
      'activate com.bank',
      'deepLink bank://home',
    ]);
  });

  it('reads the playbook with which accounts are ready', async function () {
    const answer = await run(fakeDevice([]), 'playbook_get', {part: 'accounts'});
    expect(answer.accounts.map((one) => [one.name, one.ready])).toEqual([
      ['basic', true],
      ['fresh', false],
    ]);
  });

  it('speaks W3C to the Inspector session', async function () {
    const calls = [];
    const device = createDeviceClient(
      {serverUrl: 'http://127.0.0.1:4723/', sessionId: 's1', platform: 'ios'},
      async (url, options) => {
        calls.push(`${options.method} ${url} ${options.body ?? ''}`);
        if (url.endsWith('/element')) {
          return {ok: false, status: 404, json: async () => ({value: {error: 'no such element', message: 'none'}})};
        }
        return {ok: true, json: async () => ({value: null})};
      },
    );
    expect(await device.find({using: 'id', value: 'x'})).toBeNull();
    await device.terminate('com.bank');
    expect(calls[1]).toBe(
      'POST http://127.0.0.1:4723/session/s1/execute/sync {"script":"mobile: terminateApp","args":[{"bundleId":"com.bank"}]}',
    );
  });
});
