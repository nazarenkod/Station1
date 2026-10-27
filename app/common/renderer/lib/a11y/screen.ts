import {DEFAULT_SCREEN_TITLE_SELECTORS, screenTitle} from './problems';
import type {UiTree} from './ui-tree.types';

export {screenTitle};

export interface ScreenIdentity {
  // what the screen is called, as people read it
  title: string | null;
  // where the name came from, so the UI can say how sure it is
  source: 'title-tag' | 'navigation-bar' | 'activity' | 'structure';
  // the key decisions and filed bugs are stored under
  key: string;
}

function navigationBarTitle(tree: UiTree): string | null {
  if (tree.format !== 'appium-ios') {
    return null;
  }
  const bar = tree.nodes.find((node) => node.className === 'XCUIElementTypeNavigationBar' && node.visible);
  const title = bar && (bar.resourceId || bar.label);
  return title ? title.trim() : null;
}

// FNV-1a: short, stable and good enough to tell layouts apart
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
}

/**
 * Which screen this is: its title by the project's selectors (vision's
 * screenTitle), else, here only, the iOS navigation bar, the Android activity
 * or the layout. Problems that are not a component's are kept per screen.
 */
export function identifyScreen(
  tree: UiTree,
  options: {titleSelectors?: string[]; activity?: string} = {},
): ScreenIdentity {
  const tagged = screenTitle(tree, options.titleSelectors ?? DEFAULT_SCREEN_TITLE_SELECTORS);
  if (tagged) {
    return {title: tagged, source: 'title-tag', key: `title:${tagged.toLowerCase()}`};
  }
  const navigation = navigationBarTitle(tree);
  if (navigation) {
    return {title: navigation, source: 'navigation-bar', key: `title:${navigation.toLowerCase()}`};
  }
  const activity = options.activity || tree.activity;
  if (activity) {
    const short = activity.split('.').pop() ?? activity;
    return {title: short, source: 'activity', key: `activity:${activity}`};
  }
  // ids of the screen's elements describe its layout without its changing texts
  const ids = [...new Set(tree.nodes.map((node) => node.resourceId).filter(Boolean))].sort().join('|');
  return {title: null, source: 'structure', key: `layout:${hash(ids || tree.nodes.map((n) => n.className).join('|'))}`};
}

export interface ScreenState {
  // the same elements on the same screen give the same id
  id: string;
  // the title of a dialog or alert on screen, when there is one
  title: string | null;
}

// parts of the screen that change on their own: not a new state of the screen
const TRANSIENT_CLASSES = new Set(['XCUIElementTypeKeyboard', 'XCUIElementTypeStatusBar']);
const DIALOG_CLASSES = new Set(['XCUIElementTypeAlert', 'XCUIElementTypeSheet']);
// what scrolls: its rows count whether they are in view or not, so scrolling is not a new state
const SCROLLING_CLASSES = new Set([
  'XCUIElementTypeTable',
  'XCUIElementTypeCollectionView',
  'XCUIElementTypeScrollView',
  'androidx.recyclerview.widget.RecyclerView',
  'android.widget.ListView',
  'android.widget.GridView',
  'android.widget.ScrollView',
  'android.widget.HorizontalScrollView',
  'androidx.core.widget.NestedScrollView',
  'androidx.viewpager.widget.ViewPager',
]);

/**
 * Which state of its screen this is: a dialog, an error banner, an empty or
 * a full list give another state, while texts (inputs, sums, dates), the
 * keyboard, the status bar and scrolling do not. The state is told by the ids
 * of the visible elements, and of all the rows of a list whether scrolled into
 * view or not; an id equal to the element's text or label is a
 * text (iOS names an element by its label without an identifier) and is left
 * out. Without any id the element types tell it.
 */
export function screenState(tree: UiTree): ScreenState {
  const transient = new Set<number>();
  const scrolled = new Set<number>();
  for (const node of tree.nodes) {
    const parent = node.parent;
    if (TRANSIENT_CLASSES.has(node.className) || (parent !== null && transient.has(parent))) {
      transient.add(node.index);
    }
    if (parent !== null && (scrolled.has(parent) || SCROLLING_CLASSES.has(tree.nodes[parent]?.className))) {
      scrolled.add(node.index);
    }
  }
  const nodes = tree.nodes.filter((node) => (node.visible || scrolled.has(node.index)) && !transient.has(node.index));
  const isId = (node: (typeof nodes)[number]) =>
    !!node.resourceId && node.resourceId !== node.text && node.resourceId !== node.label;
  const ids = nodes.filter(isId).map((node) => node.resourceId);
  const parts = ids.length ? ids : nodes.map((node) => node.className);

  const dialog = nodes.find((node) => DIALOG_CLASSES.has(node.className));
  const alertTitle = nodes.find((node) => /(^|[:/])alertTitle$/.test(node.resourceId));
  const title = (dialog && (dialog.label || dialog.resourceId)) || alertTitle?.text || null;
  return {id: hash([...new Set(parts)].sort().join('|')), title: title ? title.trim() : null};
}
