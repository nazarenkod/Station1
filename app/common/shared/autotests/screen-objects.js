import {maskText} from '../agent/privacy.js';

// Screen objects from the screens of a session: a state of a screen is one
// screen object, and states of the same screen can be merged into one. Pure
// functions over plain data: the names, the merge, what the model is asked
// and how its answer is read back.

/**
 * A class name from what the screen and the state are called:
 * «com.bank.LoginActivity» → LoginActivity, «Переказ» + «діалог» → ПереказДіалог.
 * Kotlin takes letters of any alphabet; the team's rules may rename it anyway.
 */
export function objectName(screenTitle, stateTitle = null) {
  const words = (value) =>
    String(value ?? '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  // a class of the app (com.bank.LoginActivity) is named by its last part
  const screen =
    String(screenTitle ?? '')
      .split(/[./]/)
      .filter(Boolean)
      .at(-1) ?? '';
  const pascal = (list) => list.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  const name = pascal(words(screen)) + (stateTitle ? pascal(words(stateTitle)) : '');
  const clean = name || 'Screen';
  return /^\p{N}/u.test(clean) ? `Screen${clean}` : clean;
}

// the same element in two states: the same best locator, or the same place in the tree when it has none
const elementKey = (element) =>
  element.locators?.[0] ? `${element.locators[0][0]}=${element.locators[0][1]}` : `path=${element.path}`;

/**
 * One screen object from states of one screen: every element of each state,
 * once. An element missing from some of the states names the states it is in.
 * @param {{id: string, title: string, elements: object[]}[]} states
 */
export function mergeElements(states) {
  const merged = new Map();
  for (const state of states) {
    for (const element of state.elements ?? []) {
      const key = elementKey(element);
      const known = merged.get(key);
      merged.set(key, known ? {...known, states: [...known.states, state.title]} : {...element, states: [state.title]});
    }
  }
  return [...merged.values()].map(({states: inStates, ...element}) =>
    states.length > 1 && inStates.length < states.length ? {...element, states: inStates} : element,
  );
}

const ACTION_WORDS = {
  tap: 'tap',
  type: 'type text',
  clear: 'clear',
  check: 'check/uncheck',
  scroll: 'scroll',
  text: 'read text',
  visible: 'is visible',
};

const quote = (value) => JSON.stringify(value);

/** An element as one line for the model: its type, what it shows, its locators, what a test does with it. */
export function elementLine(element, masks) {
  const parts = [element.type];
  if (element.id) {
    parts.push(`id=${quote(element.id)}`);
  }
  if (element.text) {
    parts.push(`text=${quote(maskText(element.text, masks))}`);
  }
  if (element.description && element.description !== element.text) {
    parts.push(`desc=${quote(maskText(element.description, masks))}`);
  }
  if (element.enabled === false) {
    parts.push('disabled');
  }
  if (element.states?.length) {
    parts.push(`only in: ${element.states.join(', ')}`);
  }
  const locators = (element.locators ?? []).map(([strategy, selector]) => `${strategy}: ${maskText(selector, masks)}`);
  const actions = (element.actions ?? []).map((action) => ACTION_WORDS[action] ?? action);
  return `- ${parts.join(' ')}\n  locators: ${locators.join(' | ') || 'none'}\n  actions: ${actions.join(', ')}`;
}

/**
 * What the model is asked: the team's rules, where the examples are, and
 * every element of each screen object with its locators and actions. The
 * values that look personal are masked before they go.
 */
export function generationPrompt({rules, rulesPath, examplesPath, platform, app, objects, hint = '', masks}) {
  const blocks = objects.map((object) =>
    [
      `### ${object.name}`,
      `Screen: ${object.screen}${object.states.length > 1 ? `; states merged: ${object.states.map((state) => state.title).join(', ')}` : object.states[0]?.title ? `; state: ${object.states[0].title}` : ''}`,
      `Elements (${object.elements.length}):`,
      ...object.elements.map((element) => elementLine(element, masks)),
    ].join('\n'),
  );
  return [
    'You write screen objects for the mobile autotests in this repository: Kotlin, Appium and Selenide.',
    `Follow the team's rules from ${rulesPath} exactly; they are below.`,
    examplesPath
      ? `Screen objects the team already wrote are in ${examplesPath}: read a few and write in the same style.`
      : 'There are no examples; follow the rules.',
    'Do not change, create or delete any file in the repository. Give the code in your answer only.',
    'Keep every element listed below: a locator and the interaction methods its actions name. People drop what they do not need later.',
    `Platform of the session: ${platform}.${app?.id ? ` App: ${app.id}${app.version ? ` ${app.version}` : ''}.` : ''}`,
    hint ? `The person asks: ${hint}` : '',
    '',
    'Answer with each screen object as a line `=== <Name> ===` and then one ```kotlin block with the whole file. Nothing else is needed.',
    '',
    `## Rules (${rulesPath})`,
    rules.trim(),
    '',
    '## Screen objects to write',
    ...blocks,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

const KOTLIN_BLOCK = /```(?:kotlin|kt)?[^\n]*\n([\s\S]*?)```/;

/**
 * The code of each screen object from the model's answer, by name. A
 * single screen object takes the only block even without its heading.
 * @returns {Record<string, string>}
 */
export function parseGenerated(text, names) {
  const result = {};
  const answer = String(text ?? '');
  const headings = [...answer.matchAll(/^={3}\s*(.+?)\s*={3}\s*$/gm)];
  headings.forEach((heading, index) => {
    const end = headings[index + 1]?.index ?? answer.length;
    const block = KOTLIN_BLOCK.exec(answer.slice(heading.index, end));
    const name = names.find((one) => one.toLowerCase() === heading[1].toLowerCase());
    if (block && name) {
      result[name] = block[1].trimEnd();
    }
  });
  if (names.length === 1 && !result[names[0]]) {
    const block = KOTLIN_BLOCK.exec(answer);
    if (block) {
      result[names[0]] = block[1].trimEnd();
    }
  }
  return result;
}
