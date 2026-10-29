import {DRIVERS} from '../../constants/common.js';
import {getComplexSuggestedLocators} from '../../utils/locator-generation/common.js';
import {getSimpleSuggestedLocators} from '../../utils/locator-generation/simple.js';
import {xmlToDOM, xmlToJSON} from '../../utils/source-parsing.js';

// Every element of a state of a screen, each with its locators and what a
// test can do with it. The station picks nothing: which elements a screen
// object keeps is decided later, in the code, by a person. The locators are
// the Inspector's own, the best one first.

// the order a test would rather use them in
const LOCATOR_ORDER = [
  'accessibility id',
  'id',
  '-android uiautomator',
  '-ios predicate string',
  '-ios class chain',
  'xpath',
];
const MAX_LOCATORS = 3;

const ANDROID_INPUT = /EditText|AutoCompleteTextView|SearchView/;
const IOS_TAP = /Button|Cell|Link|Switch|Tab|Key|MenuItem|SegmentedControl|Slider|Image|Icon|PickerWheel/;
const IOS_INPUT = /TextField|SecureTextField|SearchField|TextView/;
const IOS_SCROLL = /ScrollView|Table|CollectionView|WebView/;

const yes = (value) => value === 'true';

// the short type of an element: Button, EditText, StaticText
const shortType = (tag, attributes) =>
  String(attributes.class ?? attributes.type ?? tag ?? '')
    .split('.')
    .pop()
    .replace(/^XCUIElementType/, '');

function androidElement(attributes, type) {
  const actions = [];
  if (yes(attributes.clickable) || yes(attributes['long-clickable'])) {
    actions.push('tap');
  }
  if (ANDROID_INPUT.test(type)) {
    actions.push('type', 'clear');
  }
  if (yes(attributes.checkable)) {
    actions.push('check');
  }
  if (yes(attributes.scrollable)) {
    actions.push('scroll');
  }
  if (attributes.text || /Text/.test(type)) {
    actions.push('text');
  }
  return {
    id: attributes['resource-id'] || null,
    text: attributes.text || null,
    description: attributes['content-desc'] || null,
    enabled: attributes.enabled !== 'false',
    actions,
  };
}

function iosElement(attributes, type) {
  const actions = [];
  if (IOS_TAP.test(type)) {
    actions.push('tap');
  }
  if (IOS_INPUT.test(type)) {
    actions.push('type', 'clear');
  }
  if (/Switch|CheckBox/.test(type)) {
    actions.push('check');
  }
  if (IOS_SCROLL.test(type)) {
    actions.push('scroll');
  }
  if (attributes.label || attributes.value || /StaticText|TextView/.test(type)) {
    actions.push('text');
  }
  return {
    id: attributes.name || null,
    text: attributes.value || attributes.label || null,
    description: attributes.label || null,
    enabled: attributes.enabled !== 'false',
    actions,
  };
}

function locatorsOf(node, doc, platform) {
  const automation = platform === 'ios' ? DRIVERS.XCUITEST : DRIVERS.UIAUTOMATOR2;
  let found = {};
  try {
    found = {
      ...getSimpleSuggestedLocators({tag: node.tagName, attributes: node.attributes}, doc, true),
      ...getComplexSuggestedLocators(node.path, doc, true, automation),
    };
  } catch {
    // a node the generators cannot place keeps what it has
  }
  return LOCATOR_ORDER.filter((strategy) => found[strategy])
    .map((strategy) => [strategy, found[strategy]])
    .slice(0, MAX_LOCATORS);
}

/**
 * The elements of a page source, in the order of the tree.
 * @param {string} sourceXML
 * @param {'android' | 'ios'} platform
 * @returns {{path: string, type: string, id: string | null, text: string | null, description: string | null,
 *   enabled: boolean, actions: string[], locators: [string, string][]}[]}
 */
export function screenElements(sourceXML, platform) {
  if (!sourceXML) {
    return [];
  }
  const tree = xmlToJSON(sourceXML);
  const doc = xmlToDOM(sourceXML);
  const elements = [];
  const walk = (node) => {
    if (!node?.tagName) {
      return;
    }
    // the root of the tree is the app or the window, not an element of the screen
    if (node.path) {
      const type = shortType(node.tagName, node.attributes);
      const props = platform === 'ios' ? iosElement(node.attributes, type) : androidElement(node.attributes, type);
      elements.push({
        path: node.path,
        type,
        ...props,
        // whatever the platform, a test can wait for an element to show
        actions: [...props.actions, 'visible'],
        locators: locatorsOf(node, doc, platform),
      });
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(tree);
  return elements;
}
