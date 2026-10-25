import type {UiTree} from './ui-tree.types';

export interface ScreenIdentity {
  // what the screen is called, as people read it
  title: string | null;
  // where the name came from, so the UI can say how sure it is
  source: 'title-tag' | 'navigation-bar' | 'activity' | 'structure';
  // the key decisions and filed bugs are stored under
  key: string;
}

/**
 * The screen's own title from the UI tree: the element tagged with the title
 * tag (as a resource id or label, Appbar#Title by default), or the text under it.
 * Same as screenTitle() in vision's jira-bug.ts, with the tag configurable.
 */
export function screenTitle(tree: UiTree | null, tagPattern = 'appbar#title'): string | null {
  if (!tree) {
    return null;
  }
  const tag = new RegExp(tagPattern, 'i');
  const tagged = tree.nodes.find((node) => tag.test(node.resourceId) || tag.test(node.label));
  if (!tagged) {
    return null;
  }
  const own = [tagged.text, tag.test(tagged.label) ? '' : tagged.label].find((value) => value?.trim());
  if (own) {
    return own.trim();
  }
  // the tag can sit on a container whose child holds the text
  const child = tree.nodes.find((node) => node.parent === tagged.index && (node.text || node.label));
  return child ? (child.text || child.label).trim() : null;
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
 * Which screen this is. Decisions about its issues are kept per screen, so the
 * same screen opened again (on any device, in any build) shows what was filed.
 */
export function identifyScreen(tree: UiTree, options: {titleTag?: string; activity?: string} = {}): ScreenIdentity {
  const tagged = screenTitle(tree, options.titleTag);
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
