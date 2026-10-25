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
