import {describe, expect, it} from 'vitest';

import {
  actionForStep,
  actionKind,
  addScreen,
  addStep,
  emptyFlow,
  followDelay,
  MAX_STEPS,
} from '../../app/common/renderer/components/A11yTool/screen-flow.js';
import {screenState} from '../../app/common/renderer/lib/a11y/screen';
import {parseUiTree} from '../../app/common/renderer/lib/a11y/ui-tree';

const android = (nodes) =>
  parseUiTree(
    `<hierarchy rotation="0" width="1080" height="2400"><android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" displayed="true">${nodes}</android.widget.FrameLayout></hierarchy>`,
    {imageWidth: 1080, imageHeight: 2400},
  );
const view = (id, text = '', cls = 'android.widget.TextView') =>
  `<${cls} class="${cls}" resource-id="${id}" text="${text}" enabled="true" displayed="true" bounds="[0,0][1080,150]"/>`;

const ios = (nodes) =>
  parseUiTree(
    `<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Bank" enabled="true" visible="true" accessible="false" x="0" y="0" width="390" height="844">${nodes}</XCUIElementTypeApplication></AppiumAUT>`,
    {imageWidth: 1170, imageHeight: 2532},
  );
const el = (type, attrs, children = '') =>
  `<${type} type="${type}" enabled="true" visible="true" x="0" y="0" width="390" height="44" ${attrs}>${children}</${type}>`;

describe('screen flow: the state of a screen', function () {
  const form = (amount, extra = '') => android(view('amount', amount, 'android.widget.EditText') + view('pay') + extra);

  it('is the same with other texts, and another with an error banner or a dialog', function () {
    expect(screenState(form('100')).id).toBe(screenState(form('2 500')).id);
    expect(screenState(form('100', view('error_banner', 'Недостатньо коштів'))).id).not.toBe(
      screenState(form('100')).id,
    );
    const dialog = screenState(form('100', view('android:id/alertTitle', 'Підтвердіть переказ')));
    expect(dialog.title).toBe('Підтвердіть переказ');
    expect(screenState(form('100')).title).toBeNull();
  });

  it('is the same with a list scrolled further, and another when the list is empty', function () {
    const list = (...rows) => android(view('toolbar') + rows.map((text) => view('row_title', text)).join(''));
    expect(screenState(list('Січень', 'Лютий')).id).toBe(screenState(list('Березень', 'Квітень', 'Травень')).id);
    expect(screenState(list()).id).not.toBe(screenState(list('Січень')).id);
  });

  it('is the same when a list with its own id on each row is scrolled', function () {
    const cell = (id, visible) =>
      `<XCUIElementTypeCell type="XCUIElementTypeCell" name="${id}" label="${id} row" enabled="true" visible="${visible}" x="0" y="0" width="390" height="44"/>`;
    const table = (...visible) =>
      ios(
        el(
          'XCUIElementTypeTable',
          '',
          ['General', 'Privacy', 'Photos'].map((id) => cell(id, visible.includes(id))).join(''),
        ),
      );
    expect(screenState(table('General', 'Privacy')).id).toBe(screenState(table('Privacy', 'Photos')).id);
  });

  it('leaves out the keyboard, the status bar and iOS names that are only labels', function () {
    const screen = (extra) =>
      ios(
        el('XCUIElementTypeButton', 'name="pay" label="Сплатити"') +
          el('XCUIElementTypeStaticText', `name="${extra}" label="${extra}"`),
      );
    expect(screenState(screen('2 500 ₴')).id).toBe(screenState(screen('100 ₴')).id);
    const withKeyboard = ios(
      el('XCUIElementTypeButton', 'name="pay" label="Сплатити"') +
        el('XCUIElementTypeStaticText', 'name="100 ₴" label="100 ₴"') +
        el('XCUIElementTypeKeyboard', '', el('XCUIElementTypeKey', 'name="shift" label="shift"')) +
        el('XCUIElementTypeStatusBar', '', el('XCUIElementTypeOther', 'name="battery" label="100%"')),
    );
    expect(screenState(withKeyboard).id).toBe(screenState(screen('100 ₴')).id);
    const alert = screenState(ios(el('XCUIElementTypeAlert', 'name="Видалити картку?" label="Видалити картку?"')));
    expect(alert.title).toBe('Видалити картку?');
  });
});

describe('screen flow: how often it looks', function () {
  it('looks every half a second for 4 s after an action, then every 1.5 s', function () {
    expect(followDelay({lastActionAt: 10_000, now: 10_300})).toBe(500);
    expect(followDelay({lastActionAt: 10_000, now: 13_900})).toBe(500);
    expect(followDelay({lastActionAt: 10_000, now: 14_100})).toBe(1500);
    expect(followDelay({lastActionAt: null, now: 14_100})).toBe(1500);
  });
});

const titled = (name) => ({key: `title:${name}`, title: name, source: 'title-tag'});
const unnamed = (n) => ({key: `layout:${n}`, title: null, source: 'structure'});
const see = (flow, screen, stateId, now, title = null) =>
  addScreen(flow, {
    screen,
    state: {id: stateId, title},
    now,
    data: {screenshot: `full-${stateId}`, reduced: `small-${stateId}`},
  }).flow;

describe('screen flow: screens and states', function () {
  it('keeps one screen per name, with its states, and a new look updates a state', function () {
    let flow = emptyFlow();
    flow = see(flow, titled('Переказ'), 'form', 1);
    flow = see(flow, titled('Переказ'), 'dialog', 2, 'Підтвердіть переказ');
    flow = see(flow, titled('Переказ'), 'form', 3);
    expect(flow.screens).toHaveLength(1);
    const [screen] = flow.screens;
    expect(screen.states.map((s) => [s.id, s.visits, s.number, s.title])).toEqual([
      ['form', 2, 1, null],
      ['dialog', 1, 2, 'Підтвердіть переказ'],
    ]);
    expect(screen.visits).toBe(1);
  });

  it('keeps the full screenshot only for the state seen last', function () {
    let flow = see(emptyFlow(), titled('Переказ'), 'form', 1);
    flow = see(flow, titled('Переказ'), 'dialog', 2);
    const states = flow.screens[0].states;
    expect(states.map((s) => [s.id, s.screenshot, s.reduced])).toEqual([
      ['form', null, 'small-form'],
      ['dialog', 'full-dialog', 'small-dialog'],
    ]);
  });

  it('lets the least seen state go past five, never the first one or the new one', function () {
    let flow = emptyFlow();
    for (const [i, id] of ['a', 'b', 'c', 'd', 'e', 'b', 'c', 'd', 'e'].entries()) {
      flow = see(flow, titled('Картки'), id, i);
    }
    flow = see(flow, titled('Картки'), 'f', 20);
    const states = flow.screens[0].states;
    expect(states.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'].filter((id) => id !== 'b'));
    expect(states.find((s) => s.id === 'f').number).toBe(6);
  });

  it('gives an unnamed screen no states and keeps ten of them at most', function () {
    let flow = see(emptyFlow(), unnamed(1), 'x', 0);
    flow = see(flow, unnamed(1), 'y', 1);
    expect(flow.screens[0].states).toHaveLength(1);
    for (let n = 2; n <= 12; n++) {
      flow = see(flow, unnamed(n), 'x', n);
    }
    flow = see(flow, titled('Головна'), 'x', 13);
    const keys = flow.screens.map((s) => s.key);
    expect(keys.filter((k) => k.startsWith('layout:'))).toHaveLength(10);
    expect(keys).not.toContain('layout:1');
    expect(keys).toContain('title:Головна');
  });

  it('says whether it is another screen or state than the last one', function () {
    const first = addScreen(emptyFlow(), {screen: titled('A'), state: {id: 's'}, now: 1, data: {}});
    expect(first.arrived).toBe(true);
    expect(addScreen(first.flow, {screen: titled('A'), state: {id: 's'}, now: 2, data: {}}).arrived).toBe(false);
    expect(addScreen(first.flow, {screen: titled('A'), state: {id: 't'}, now: 2, data: {}}).arrived).toBe(true);
  });
});

describe('screen flow: the path', function () {
  const step = (flow, key, at, action = null) => addStep(flow, {key, stateId: 's', at, action});

  it('adds a step per move, none for the same spot, and folds going back and forth', function () {
    let flow = emptyFlow();
    for (const [i, key] of ['login', 'home', 'home', 'card', 'home', 'card', 'home', 'card', 'pay'].entries()) {
      flow = step(flow, key, i);
    }
    expect(flow.path.map((s) => [s.key, s.repeat])).toEqual([
      ['login', 1],
      ['home', 1],
      ['card', 3],
      ['pay', 1],
    ]);
  });

  it('keeps the last steps and counts the ones folded away', function () {
    let flow = emptyFlow();
    for (let i = 0; i < MAX_STEPS + 15; i++) {
      flow = step(flow, `screen-${i}`, i);
    }
    expect(flow.path).toHaveLength(MAX_STEPS);
    expect(flow.pathDropped).toBe(15);
    expect(flow.path[0].key).toBe('screen-15');
  });

  it('names the action that led to a step, if it came after the last step and not long ago', function () {
    const tap = {name: 'tap', at: 10_000};
    expect(actionForStep(tap, {lastStepAt: 9_000, now: 12_000})).toBe('tap');
    expect(actionForStep(tap, {lastStepAt: 11_000, now: 12_000})).toBeNull();
    expect(actionForStep(tap, {lastStepAt: 9_000, now: 16_000})).toBeNull();
    expect(actionKind('elementClick')).toBe('tap');
    expect(actionKind('updateSettings')).toBe('command');
    expect(actionKind('executeScript', ['mobile: tap', [{x: 1, y: 2}]])).toBe('tap');
    expect(actionKind('executeScript', ['mobile: swipe', []])).toBe('gesture');
  });
});
