// Ported from vision (backend/src/ui-tree): keep in sync until both use a shared package.

import {XMLParser} from 'fast-xml-parser';

import type {Rect, UiNode, UiTree, UiTreeFormat} from './ui-tree.types';

export type {Rect, UiNode, UiTree, UiTreeFormat} from './ui-tree.types';

// Android lays out in dp, 160 dpi being 1 px per dp. Without the real density a
// phone is assumed to be ~411 dp wide on its short side, which holds for most
// current handsets and keeps dp-based thresholds roughly right.
const BASELINE_DPI = 160;
const TYPICAL_PHONE_WIDTH_DP = 411;

type XmlElement = Record<string, unknown> & {':@'?: Record<string, string>};

export interface ParseOptions {
  format?: UiTreeFormat;
  imageWidth: number;
  imageHeight: number;
  densityDpi?: number;
  activity?: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
});

export function detectFormat(xml: string): UiTreeFormat | null {
  const head = xml.slice(0, 4096);
  if (/<hierarchy[\s>]/.test(head) || /class="android\./.test(head)) {
    return 'appium-android';
  }
  if (/XCUIElementType|<AppiumAUT[\s>]/.test(head)) {
    return 'appium-ios';
  }
  return null;
}

const tagOf = (element: XmlElement): string => Object.keys(element).find((key) => key !== ':@' && key !== '#text');

const childrenOf = (element: XmlElement): XmlElement[] => {
  const tag = tagOf(element);
  const children = tag ? element[tag] : undefined;
  return Array.isArray(children) ? (children as XmlElement[]).filter((child) => !!tagOf(child)) : [];
};

const attrsOf = (element: XmlElement): Record<string, string> => element[':@'] ?? {};

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === '' ? fallback : value === 'true';

// "[0,63][1080,210]" → rect
export function parseAndroidBounds(bounds: string | undefined): Rect | null {
  const match = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(bounds ?? '');
  if (!match) {
    return null;
  }
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  return {x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1)};
}

function iosRect(attrs: Record<string, string>): Rect | null {
  const values = ['x', 'y', 'width', 'height'].map((name) => Number(attrs[name]));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [x, y, width, height] = values;
  return {x, y, width, height};
}

const scaleRect = (rect: Rect, scale: number): Rect => ({
  x: Math.round(rect.x * scale),
  y: Math.round(rect.y * scale),
  width: Math.round(rect.width * scale),
  height: Math.round(rect.height * scale),
});

const shortClass = (className: string): string => className.split('.').pop().replace('XCUIElementType', '');

interface RawNode {
  parent: number | null;
  depth: number;
  path: string;
  elementPath: string | null;
  className: string;
  resourceId: string;
  text: string;
  label: string;
  hint: string;
  clickable: boolean;
  focusable: boolean;
  enabled: boolean;
  visible: boolean;
  accessible: boolean;
  checked: boolean;
  selected: boolean;
  checkable: boolean;
  password: boolean;
  rect: Rect;
}

type ReadNode = Omit<RawNode, 'parent' | 'depth' | 'path' | 'elementPath'>;

function readAndroid(attrs: Record<string, string>, tag: string): ReadNode | null {
  const rect = parseAndroidBounds(attrs.bounds);
  if (!rect) {
    return null;
  }
  return {
    className: attrs.class || tag,
    resourceId: attrs['resource-id'] ?? '',
    text: attrs.text ?? '',
    label: attrs['content-desc'] ?? '',
    hint: attrs.hint ?? '',
    clickable: bool(attrs.clickable, false) || bool(attrs['long-clickable'], false),
    focusable: bool(attrs.focusable, false),
    enabled: bool(attrs.enabled, true),
    visible: bool(attrs.displayed, true),
    accessible: true,
    checked: bool(attrs.checked, false),
    selected: bool(attrs.selected, false),
    checkable: bool(attrs.checkable, false),
    password: bool(attrs.password, false),
    rect,
  };
}

const IOS_ACTIONABLE = new Set([
  'XCUIElementTypeButton',
  'XCUIElementTypeLink',
  'XCUIElementTypeCell',
  'XCUIElementTypeSwitch',
  'XCUIElementTypeSlider',
  'XCUIElementTypeTextField',
  'XCUIElementTypeSecureTextField',
  'XCUIElementTypeSearchField',
  'XCUIElementTypeSegmentedControl',
  'XCUIElementTypeTab',
]);

function readIos(attrs: Record<string, string>, tag: string): ReadNode | null {
  const rect = iosRect(attrs);
  if (!rect) {
    return null;
  }
  const className = attrs.type || tag;
  const label = attrs.label ?? '';
  const name = attrs.name ?? '';
  return {
    className,
    // name is the accessibilityIdentifier when one is set, otherwise it repeats the label
    resourceId: name && name !== label ? name : '',
    text: attrs.value ?? '',
    label,
    hint: attrs.placeholderValue ?? '',
    clickable: IOS_ACTIONABLE.has(className),
    focusable: bool(attrs.accessible, false),
    enabled: bool(attrs.enabled, true),
    visible: bool(attrs.visible, true),
    accessible: bool(attrs.accessible, true),
    checked: attrs.value === '1' && /Switch|CheckBox/.test(className),
    selected: bool(attrs.selected, false),
    checkable: /Switch|CheckBox/.test(className),
    password: className === 'XCUIElementTypeSecureTextField',
    rect,
  };
}

/**
 * Parses an Appium page source (UiAutomator2 or XCUITest) into a flat list of
 * nodes with bounds in screenshot pixels. Throws on unreadable XML.
 */
export function parseUiTree(xml: string, options: ParseOptions): UiTree {
  const format = options.format ?? detectFormat(xml);
  if (!format) {
    throw new Error('Unknown UI tree format: expected an Appium page source for Android or iOS');
  }
  const document = parser.parse(xml) as XmlElement[];
  const roots = document.filter((element) => !!tagOf(element) && !tagOf(element).startsWith('?'));
  if (!roots.length) {
    throw new Error('Empty UI tree');
  }

  const raw: RawNode[] = [];
  const read = format === 'appium-android' ? readAndroid : readIos;

  const walk = (
    element: XmlElement,
    parent: number | null,
    depth: number,
    parentPath: string,
    siblingIndex: number,
    // null outside the first root, which is the only one the inspector shows
    elementPath: string | null,
  ) => {
    const tag = tagOf(element);
    const attrs = attrsOf(element);
    let current = parent;
    let path = parentPath;
    // the <hierarchy> and <AppiumAUT> wrappers carry no element of their own
    const isWrapper = tag === 'hierarchy' || tag === 'AppiumAUT';
    if (!isWrapper) {
      const node = read(attrs, tag);
      if (node) {
        path = `${parentPath}/${shortClass(node.className)}[${siblingIndex}]`;
        raw.push({...node, parent, depth, path, elementPath});
        current = raw.length - 1;
      }
    }
    const seen = new Map<string, number>();
    childrenOf(element).forEach((child, childPosition) => {
      const childTag = tagOf(child);
      const childClass = attrsOf(child).class || attrsOf(child).type || childTag;
      const index = seen.get(childClass) ?? 0;
      seen.set(childClass, index + 1);
      // the inspector numbers every element child, the root itself having an empty path
      const childElementPath =
        elementPath === null ? null : elementPath ? `${elementPath}.${childPosition}` : `${childPosition}`;
      walk(child, current, isWrapper ? depth : depth + 1, path, index, childElementPath);
    });
  };
  roots.forEach((root, index) => walk(root, null, 0, '', index, index === 0 ? '' : null));

  if (!raw.length) {
    throw new Error('UI tree has no elements with bounds');
  }

  // Tree units → screenshot pixels. Android trees are already in pixels; iOS
  // trees are in points, so the screenshot is 2–3× wider than the app frame.
  const rootAttrs = attrsOf(roots[0]);
  const treeWidth = Number(rootAttrs.width) || Math.max(...raw.map((node) => node.rect.x + node.rect.width));
  const scale = treeWidth > 0 && options.imageWidth > 0 ? options.imageWidth / treeWidth : 1;

  let pixelsPerDp: number;
  let pixelsPerDpEstimated = false;
  if (format === 'appium-ios') {
    pixelsPerDp = scale;
  } else if (options.densityDpi > 0) {
    pixelsPerDp = (scale * options.densityDpi) / BASELINE_DPI;
  } else {
    pixelsPerDp = Math.min(options.imageWidth, options.imageHeight) / TYPICAL_PHONE_WIDTH_DP;
    pixelsPerDpEstimated = true;
  }

  const keyCounts = new Map<string, number>();
  const nodes: UiNode[] = raw.map((node, index) => {
    const named = node.resourceId
      ? `id:${node.resourceId}`
      : node.text || node.label
        ? `${shortClass(node.className)}:${node.text || node.label}`
        : `path:${node.path}`;
    const occurrence = keyCounts.get(named) ?? 0;
    keyCounts.set(named, occurrence + 1);
    return {
      index,
      parent: node.parent,
      depth: node.depth,
      key: occurrence ? `${named}#${occurrence}` : named,
      className: node.className,
      resourceId: node.resourceId,
      text: node.text,
      label: node.label,
      hint: node.hint,
      clickable: node.clickable,
      focusable: node.focusable,
      enabled: node.enabled,
      visible: node.visible,
      accessible: node.accessible,
      checked: node.checked,
      selected: node.selected,
      checkable: node.checkable,
      password: node.password,
      bounds: scaleRect(node.rect, scale),
      ...(node.elementPath !== null ? {elementPath: node.elementPath} : {}),
    };
  });

  return {
    format,
    scale,
    width: options.imageWidth,
    height: options.imageHeight,
    pixelsPerDp,
    pixelsPerDpEstimated,
    ...(options.activity ? {activity: options.activity} : {}),
    nodes,
  };
}

/** Text a screen reader would announce for the node itself. */
export const ownSpeakableText = (node: UiNode): string => (node.label || node.text || node.hint).trim();

/** Short human name for a node in messages: `Button "Pay" (id/btn_pay)`. */
export function describeNode(node: UiNode): string {
  const name = ownSpeakableText(node);
  const id = node.resourceId ? ` (${node.resourceId.replace(/^.*:id\//, 'id/')})` : '';
  return `${shortClass(node.className)}${name ? ` "${name.slice(0, 40)}"` : ''}${id}`;
}
