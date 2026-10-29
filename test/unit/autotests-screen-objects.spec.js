import {describe, expect, it} from 'vitest';

import {compileMasks} from '../../app/common/shared/agent/privacy.js';
import {cleanAutotestsConfig, insidePath} from '../../app/common/shared/autotests/config.js';
import {
  generationPrompt,
  mergeElements,
  objectName,
  parseGenerated,
} from '../../app/common/shared/autotests/screen-objects.js';

const button = {
  path: '0.1',
  type: 'Button',
  id: 'next',
  text: 'Далі',
  enabled: true,
  actions: ['tap', 'text', 'visible'],
  locators: [['accessibility id', 'next']],
};
const title = {
  path: '0.0',
  type: 'TextView',
  text: 'Вхід',
  actions: ['text', 'visible'],
  locators: [['id', 'ua.bank:id/title']],
};
const dialogOk = {
  path: '0.2.0',
  type: 'Button',
  text: 'OK',
  actions: ['tap', 'visible'],
  locators: [['xpath', '//android.widget.Button[@text="OK"]']],
};

describe('autotests config', () => {
  it('keeps paths inside the repository only', () => {
    expect(insidePath('./tests/screens/')).toBe('tests/screens');
    expect(insidePath('/etc/passwd')).toBeNull();
    expect(insidePath('../other')).toBeNull();
    expect(insidePath('C:\\rules.md')).toBeNull();
  });

  it('puts the default rules file in place', () => {
    expect(cleanAutotestsConfig({})).toEqual({rules: '.station/screen-objects.md', examples: ''});
    expect(cleanAutotestsConfig({rules: 'docs/so.md', examples: 'src/screens'})).toEqual({
      rules: 'docs/so.md',
      examples: 'src/screens',
    });
  });
});

describe('objectName', () => {
  it('makes a class name of the screen and the state', () => {
    expect(objectName('com.bank.LoginActivity')).toBe('LoginActivity');
    expect(objectName('Переказ', 'діалог: Підтвердіть переказ')).toBe('ПереказДіалогПідтвердітьПереказ');
    expect(objectName('my cards')).toBe('MyCards');
    expect(objectName('')).toBe('Screen');
    expect(objectName('2fa')).toBe('Screen2fa');
  });
});

describe('mergeElements', () => {
  it('takes every element of each state once, naming the states an element is only in', () => {
    const merged = mergeElements([
      {id: 'a', title: 'стан 1', elements: [title, button]},
      {id: 'b', title: 'діалог', elements: [title, button, dialogOk]},
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[0].states).toBeUndefined();
    expect(merged[2]).toMatchObject({text: 'OK', states: ['діалог']});
  });

  it('leaves a single state as it is', () => {
    expect(mergeElements([{id: 'a', title: 'стан 1', elements: [title, button]}])).toEqual([title, button]);
  });
});

describe('generationPrompt', () => {
  const prompt = generationPrompt({
    rules: '# Rules\nUse `By.id`.',
    rulesPath: '.station/screen-objects.md',
    examplesPath: 'src/test/screens',
    platform: 'android',
    app: {id: 'ua.bank', version: '5.1'},
    objects: [
      {
        name: 'LoginActivity',
        screen: 'Вхід',
        states: [{title: 'стан 1'}],
        elements: [{...title, text: 'Картка 4111 1111 1111 1111'}, button],
      },
    ],
    masks: compileMasks(),
  });

  it('carries the rules, the examples and every element with its locators and actions', () => {
    expect(prompt).toContain('# Rules\nUse `By.id`.');
    expect(prompt).toContain('src/test/screens');
    expect(prompt).toContain('### LoginActivity');
    expect(prompt).toContain('locators: accessibility id: next');
    expect(prompt).toContain('actions: tap, read text, is visible');
    expect(prompt).toContain('Elements (2)');
  });

  it('masks what looks personal', () => {
    expect(prompt).not.toContain('4111');
    expect(prompt).toContain('•••');
  });
});

describe('parseGenerated', () => {
  it('reads the code of each screen object by its heading', () => {
    const answer = [
      'Here you go.',
      '=== LoginActivity ===',
      '```kotlin',
      'class LoginActivity',
      '```',
      '=== MainActivity ===',
      '```kotlin',
      'class MainActivity',
      '```',
    ].join('\n');
    expect(parseGenerated(answer, ['LoginActivity', 'MainActivity'])).toEqual({
      LoginActivity: 'class LoginActivity',
      MainActivity: 'class MainActivity',
    });
  });

  it('takes the only block for a single screen object', () => {
    expect(parseGenerated('```kotlin\nclass A\n```', ['A'])).toEqual({A: 'class A'});
  });

  it('gives nothing for an answer without code', () => {
    expect(parseGenerated('I cannot', ['A', 'B'])).toEqual({});
  });
});

describe('units after a session', async () => {
  const {initialUnits, mergeUnits, setUnit, splitUnit, uniqueNames} =
    await import('../../app/common/shared/autotests/units.js');
  const login = {
    key: 'login',
    title: 'Вхід',
    named: true,
    states: [
      {id: 's1', title: 'стан 1'},
      {id: 's2', title: 'діалог: Помилка'},
    ],
  };
  const main = {key: 'main', title: 'com.bank.MainActivity', named: true, states: [{id: 'only', title: 'стан 1'}]};
  const layout = {key: 'x', title: null, named: false, states: [{id: 'only', title: null}]};

  it('makes a unit of every state of a named screen, none of a screen without a name', () => {
    const units = initialUnits([login, main, layout]);
    expect(units.map((unit) => unit.name)).toEqual(['ВхідСтан1', 'ВхідДіалогПомилка', 'MainActivity']);
    expect(units.every((unit) => !unit.chosen)).toBe(true);
  });

  it('merges states of one screen only, and splits them back', () => {
    const units = initialUnits([login, main]);
    const [a, b, c] = units.map((unit) => unit.key);
    expect(mergeUnits(units, [a, c], 'Вхід')).toBe(units);
    const merged = mergeUnits(units, [a, b], 'Вхід');
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({stateIds: ['s1', 's2'], name: 'Вхід', chosen: true});
    const split = splitUnit(merged, merged[0].key, login);
    expect(split.map((unit) => unit.stateIds)).toEqual([['s1'], ['s2'], ['only']]);
    expect(split.slice(0, 2).every((unit) => unit.chosen)).toBe(true);
  });

  it('gives each chosen screen object a name of its own', () => {
    let units = initialUnits([login, main]);
    units = setUnit(units, units[0].key, {chosen: true, name: 'Login'});
    units = setUnit(units, units[1].key, {chosen: true, name: 'Login'});
    expect(uniqueNames(units).map((unit) => unit.name)).toEqual(['Login', 'Login2', 'MainActivity']);
  });
});
